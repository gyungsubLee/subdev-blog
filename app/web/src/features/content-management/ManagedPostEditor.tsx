import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useCreateBlockNote } from "@blocknote/react";
import type { BlockNoteEditor, PartialBlock } from "@blocknote/core";
import { ko } from "@blocknote/core/locales";
import HeaderAction from "../../components/header-action/HeaderAction";
import CategorySelectionDialog from "../post-category/CategorySelectionDialog";
import type { EditorDocument, Post, PublicCategory } from "../../shared/post";
import {
  isEditorFilename,
  validateEditorDocument,
} from "../../../../shared/editor-document.mjs";
import {
  parseBlockBackup,
  parseMarkdownDocument,
} from "../../../../shared/document.mjs";
import EditorCanvas from "../post-editor/EditorCanvas";
import { ManagedEditorToolbar, ReaderPreview } from "./ManagedEditorChrome";
import {
  PostStatus,
  normalizePostStatus,
  postStatusLabel,
} from "../../shared/post-status";
import { readDrafts } from "../../shared/drafts.mjs";
import { editorSchema } from "../post-editor/code-block";
import { editorConfig } from "../post-editor/config";
import { serializeEditorMarkdown } from "../post-editor/document-markdown";
import { notionExtension } from "../post-editor/notion-extension";
import { syntaxHighlighting } from "../post-editor/syntax-highlighting";
import { downloadFile } from "../../shared/download-file.mjs";
import { enqueueContentSync, retryContentSync, discardContentConflict, SYNC_EVENT, syncScope } from "./background-sync.mjs";
import { requestApi, uploadAttachment } from "./api";
import PublishStatus from "./PublishStatus";
import type { ManagementSession, Publication, SourceDocument } from "./types";
import "./management.css";

type SourceDraft = {
  revision: string | null;
  title: string;
  tags?: string[];
  status?: PostStatus;
  updatedAt?: string;
  canonicalId?: string;
  markdown: string;
  category: string;
  assets: SourceDocument["assets"];
  requestId: string;
  operation: "save" | "delete";
  sourceDocument?: SourceDocument;
  publication?: Publication;
  syncVersion?: number;
  blocks?: EditorDocument["blocks"];
  markdownHash?: string;
};

type NotebookEditor = BlockNoteEditor<typeof editorSchema.blockSchema>;
type StoredBlock = PartialBlock<typeof editorSchema.blockSchema>;
const EMPTY_POSTS: Post[] = [];

function validateAttachmentName(name: unknown): string {
  if (typeof name !== "string" || !name || new TextEncoder().encode(name).length > 200) {
    throw new Error("첨부 파일명을 확인하십시오.");
  }
  let decoded = name;
  try {
    for (let count = 0; count < 5; count++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
      if (!/%[a-f0-9]{2}/i.test(decoded)) break;
      if (count === 4) throw new Error("Repeated encoding");
    }
  } catch {
    throw new Error("첨부 파일명의 인코딩을 확인하십시오.");
  }
  if (/[\\/<>:"|?*\u0000-\u001f\u007f]/.test(decoded) ||
      decoded === "." || decoded === ".." || /[. ]$/.test(decoded) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(decoded) ||
      /\.md$/i.test(decoded) || isEditorFilename(name)) {
    throw new Error("첨부에는 경로나 예약 파일명을 사용할 수 없습니다.");
  }
  return name;
}

function recoveryAssets(value: unknown): SourceDocument["assets"] {
  if (!Array.isArray(value)) throw new Error("첨부 목록을 확인하십시오.");
  return value.map((asset) => {
    const name = validateAttachmentName(asset?.name);
    if (!/^[a-f0-9]{40}$/.test(asset?.sha ?? "") ||
        !Number.isSafeInteger(asset?.size) || asset.size <= 0 || asset.size > 5 * 1024 * 1024) {
      throw new Error("첨부의 Git SHA와 크기를 확인하십시오.");
    }
    return { name, sha: asset.sha, size: asset.size };
  });
}

function storedBlocks(editor: NotebookEditor): EditorDocument["blocks"] {
  // BlockNote includes optional undefined properties; persist the exact JSON shape.
  return JSON.parse(JSON.stringify(editor.document));
}

async function markdownHash(markdown: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(markdown),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function editorDocument(
  documentId: string,
  markdown: string,
  blocks: EditorDocument["blocks"],
) {
  const hash = await markdownHash(markdown);
  return validateEditorDocument(
    { schemaVersion: 1, documentId, markdownHash: hash, blocks },
    { documentId, markdownHash: hash },
  );
}

function ManagedBlocks({
  draft,
  disabled,
  onChange,
  onInitialize,
  onError,
  onReady,
  upload,
  resolveFileUrl,
}: {
  draft: SourceDraft;
  disabled: boolean;
  onChange: (blocks: EditorDocument["blocks"], markdown: string) => void;
  onInitialize: (blocks: EditorDocument["blocks"]) => void;
  onError: () => void;
  onReady: (editor: NotebookEditor | null) => void;
  upload: (file: File) => Promise<string>;
  resolveFileUrl: (url: string) => Promise<string>;
}) {
  const ready = useRef(false);
  const callbacks = useRef({ onChange, onInitialize, onError, onReady, upload, resolveFileUrl });
  callbacks.current = { onChange, onInitialize, onError, onReady, upload, resolveFileUrl };
  const editor = useCreateBlockNote({
    schema: editorSchema,
    dictionary: ko,
    initialContent: draft.blocks as StoredBlock[] | undefined,
    extensions: [notionExtension, syntaxHighlighting],
    uploadFile: (file) => callbacks.current.upload(file),
    resolveFileUrl: (url) => callbacks.current.resolveFileUrl(url),
  });
  useEffect(() => {
    if (!draft.blocks) {
      try {
        const blocks = editor.tryParseMarkdownToBlocks(draft.markdown);
        if (blocks.length) editor.replaceBlocks(editor.document, blocks);
        // Preparing the block view must not rewrite the original Markdown.
        callbacks.current.onInitialize(storedBlocks(editor));
      } catch {
        callbacks.current.onError();
        return;
      }
    }
    ready.current = true;
    callbacks.current.onReady(editor);
    return () => {
      ready.current = false;
      callbacks.current.onReady(null);
    };
  }, [editor]);
  return (
    <EditorCanvas
      editor={editor}
      editable={!disabled}
      onChange={() => {
        if (ready.current) {
          callbacks.current.onChange(
            storedBlocks(editor),
            serializeEditorMarkdown(editor),
          );
        }
      }}
    />
  );
}

export default function ManagedPostEditor({
  post,
  session,
  onClose,
  onSaved,
  onDraftSaved,
  posts = EMPTY_POSTS,
  newPostContext,
}: {
  post: Post | null;
  posts?: Post[];
  newPostContext?: {
    categories: PublicCategory[];
    contentCommit: string;
    pendingCategories?: PublicCategory[];
  };
  session: ManagementSession;
  onClose: () => void;
  onSaved?: (contentCommit?: string) => void;
  onDraftSaved?: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const [previewVisible, setPreviewVisible] = useState(true);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [saveDescription, setSaveDescription] = useState("");
  const [saveState, setSaveState] = useState<"unsaved" | "saved">();
  const [publishedId, setPublishedId] = useState<string | null>(null);
  const isCanonical = Boolean((post && !post.draft) || publishedId);
  const [source, setSource] = useState<SourceDocument | null>(null);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [publication, setPublication] = useState<Publication>();
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadCount, setUploadCount] = useState(0);
  const reservedUploadNames = useRef(new Set<string>());
  const restoredRecovery = useRef<SourceDraft | null>(null);
  const [generation, setGeneration] = useState(0);
  const blockEditor = useRef<NotebookEditor | null>(null);
  const previewUrls = useRef(new Map<string, string>());
  const draftKey =
    "second-brain:canonical-draft:" + (post?.recoveryKey ?? post?.id ?? "new");
  const csrfToken = session.csrfToken ?? "";
  const accepted =
    publication && !["failed", "unchanged"].includes(publication.state);
  const uploading = uploadCount > 0;
  const busy = saving || uploading || Boolean(draftError) || Boolean(draft && !draft.blocks) || Boolean(accepted && !publication?.background);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      let saved: SourceDraft | undefined;
      try {
        const bytes = localStorage.getItem(draftKey);
        if (bytes) {
          const value = JSON.parse(bytes);
          const original = value.sourceDocument;
          if (
            typeof value.title !== "string" ||
            typeof value.markdown !== "string" ||
            typeof value.category !== "string" ||
            typeof value.requestId !== "string" ||
            !Array.isArray(value.assets) ||
            !original?.document?.metadata?.id ||
            typeof original.document.markdown !== "string" ||
            (isCanonical &&
              original.document.metadata.id !== (publishedId ?? post?.id)) ||
            value.revision !== original.revision
          ) {
            throw new Error("Invalid draft");
          }
          recoveryAssets(value.assets);
          if (value.blocks !== undefined) {
            const hash = await markdownHash(value.markdown);
            validateEditorDocument(
              {
                schemaVersion: 1,
                documentId: original.document.metadata.id,
                markdownHash: value.markdownHash ?? hash,
                blocks: value.blocks,
              },
              { documentId: original.document.metadata.id, markdownHash: hash },
            );
          } else if (original.editor) {
            throw new Error("Missing recovery blocks");
          }
          if (
            value.tags !== undefined &&
            (!Array.isArray(value.tags) ||
              value.tags.some((tag: unknown) => typeof tag !== "string"))
          ) {
            throw new Error("Invalid draft tags");
          }
          value.tags ??= original.document.metadata.tags ?? [];
          value.status = normalizePostStatus(value.status);
          saved = value;
          if (controller.signal.aborted) return;
          restoredRecovery.current = value;
          setSource(original);
          setDraft(value);
          setSaveState("saved");
          setPublication(value.publication);
          if (original.editorError) {
            setDraftError(
              "편집 원본을 읽지 못했습니다. Markdown과 원본 백업을 내보내십시오. " +
                original.editorError,
            );
          }
        }
      } catch {
        if (!controller.signal.aborted) {
          setDraftError(
            "보관한 초안을 읽지 못했습니다. 기존 데이터를 유지합니다. 원본 백업을 내보낸 뒤 다시 시작하십시오.",
          );
        }
        return;
      }
      const query =
        isCanonical && post
          ? "kind=post&id=" + encodeURIComponent(publishedId ?? post.id)
          : "kind=new";
      try {
        // New drafts reuse the loaded index; GitHub still validates the base on publish.
        if (saved && generation === 0) return;
        const date = new Date().toISOString();
        const data: SourceDocument = !isCanonical && newPostContext?.contentCommit
          ? {
              document: {
                metadata: {
                  schema_version: 1,
                  id: crypto.randomUUID(),
                  title: "",
                  category_id: post?.categoryId ?? undefined,
                  parent_id: null,
                  created: date,
                  updated: date,
                  order: 0,
                  kind: "article",
                  summary: "",
                  tags: [],
                  aliases: [],
                  related_ids: [],
                  source_ids: [],
                  review_status: "unreviewed",
                },
                markdown: "",
              },
              editor: null,
              editorRevision: null,
              revision: null,
              contentCommit: newPostContext.contentCommit,
              categories: newPostContext.categories.map(({ parentId, ...category }) => ({
                ...category,
                parent_id: parentId,
              })),
              assets: [],
              pendingCategories: newPostContext.pendingCategories?.map(
                ({ parentId, ...category }) => ({ ...category, parent_id: parentId }),
              ),
            }
          : await requestApi<SourceDocument>("/api/content?" + query, {
              signal: controller.signal,
            });
        if (!isCanonical && !newPostContext?.contentCommit) {
          data.document.metadata.category_id = post?.categoryId;
          data.pendingCategories = newPostContext?.pendingCategories?.map(
            ({ parentId, ...category }) => ({ ...category, parent_id: parentId }),
          );
          for (const category of data.pendingCategories ?? []) {
            if (!data.categories.some(item => item.id === category.id)) {
              data.categories.push(category);
            }
          }
        }
        if (controller.signal.aborted) return;
        if (data.editorError) {
          if (saved) {
            setDraftError(
              "GitHub 편집 원본을 읽지 못했습니다. 보관한 초안을 유지합니다. 초안을 내보낸 뒤 원본을 확인하십시오. " +
                data.editorError,
            );
            return;
          }
          setSource(data);
          setDraft({
            revision: data.revision,
            title: data.document.metadata.title,
            tags: data.document.metadata.tags ?? [],
            status: isCanonical ? PostStatus.Published : PostStatus.Draft,
            markdown: data.document.markdown,
            category: data.document.metadata.category_id ?? "",
            assets: [],
            requestId: crypto.randomUUID(),
            operation: "save",
            sourceDocument: data,
          });
          setDraftError(
            "편집 원본을 읽지 못했습니다. Markdown과 원본 백업을 내보내십시오. " +
              data.editorError,
          );
          return;
        }
        if (saved) {
          if (
            isCanonical &&
            (saved.revision !== data.revision ||
              (saved.sourceDocument?.editorRevision ?? null) !==
                (data.editorRevision ?? null))
          ) {
            setError(
              "원본이 바뀌었습니다. 같은 요청의 결과를 다시 확인하거나, 초안을 내보내고 최신 원본으로 다시 시작하십시오.",
            );
          }
          return;
        }
        if (data.editor) {
          validateEditorDocument(data.editor, {
            documentId: data.document.metadata.id,
            markdownHash: await markdownHash(data.document.markdown),
          });
          if (controller.signal.aborted) return;
        }
        const legacy = post?.draft
          ? readDrafts(localStorage).find((item: Post) => item.id === post.id)
          : undefined;
        setSource(data);
        setDraft({
          revision: data.revision,
          title: data.document.metadata.title,
          tags: data.document.metadata.tags ?? [],
          status: isCanonical ? PostStatus.Published : PostStatus.Draft,
          markdown: data.document.markdown,
          category: data.document.metadata.category_id ?? "",
          assets: [],
          requestId: crypto.randomUUID(),
          operation: "save",
          sourceDocument: data,
          ...(data.editor
            ? {
                blocks: data.editor.blocks,
                markdownHash: data.editor.markdownHash,
              }
            : {}),
          ...(legacy
            ? {
                title: legacy.title,
                markdown: legacy.markdown,
                category:
                  data.categories.find(
                    (category) =>
                      category.id === legacy.categoryId ||
                      category.name === legacy.category,
                  )?.id ?? "",
                blocks: legacy.blocks,
              }
            : {}),
        });
      } catch (reason) {
        if (!controller.signal.aborted) {
          setNeedsLogin(
            reason instanceof Error &&
              "status" in reason &&
              reason.status === 401,
          );
          setError(
            reason instanceof Error
              ? reason.message
              : "원본을 읽지 못했습니다. 다시 여십시오.",
          );
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [post?.id, draftKey, generation]);

  function saveRecovery(explicit = false) {
    if (!draft || draftError || session.state !== "ready") return;
    if (!explicit && draft === restoredRecovery.current && publication === draft.publication) return;
    try {
      // The paired recovery payload is one synchronous write, including before close.
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          ...draft,
          ...(isCanonical && source
            ? { canonicalId: source.document.metadata.id }
            : {}),
          status: isCanonical
            ? PostStatus.Published
            : normalizePostStatus(draft.status),
          publication,
        }),
      );
      if (explicit) {
        setSaveState("saved");
        setSaveDescription(
          "초안을 저장했습니다. 다시 게시하기 전까지 공개 내용은 유지됩니다.",
        );
        onDraftSaved?.();
      }
    } catch {
      setSaveState("unsaved");
      setDraftError(
        "초안을 저장하지 못했습니다. Markdown과 원본 백업을 내보내십시오.",
      );
    }
  }

  useEffect(() => {
    saveRecovery();
  }, [draft, publication, draftKey, draftError, isCanonical, source]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (
        event.isComposing ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "s"
      )
        return;
      event.preventDefault();
      saveRecovery(true);
    }
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [draft, publication, draftKey, draftError, isCanonical, source]);

  useEffect(() => {
    if (
      publication && !publication.background &&
      ["published", "superseded", "unchanged"].includes(publication.state)
    ) {
      if (source) setPublishedId(source.document.metadata.id);
      setSaveDescription("게시했습니다. 공개 글에서 확인할 수 있습니다.");
      onSaved?.(publication.contentCommit ?? publication.candidateCommit);
    }
  }, [
    publication?.state,
    publication?.contentCommit,
    publication?.candidateCommit,
    onSaved,
  ]);

  function change(
    values:
      Partial<SourceDraft> | ((current: SourceDraft) => Partial<SourceDraft>),
  ) {
    setDraft((current) => {
      if (!current) return null;
      const updates = typeof values === "function" ? values(current) : values;
      return {
        ...current,
        ...updates,
        ...("blocks" in updates || "markdown" in updates
          ? { markdownHash: undefined }
          : {}),
        operation: "save",
        updatedAt: new Date().toISOString(),
        requestId: crypto.randomUUID(),
      };
    });
    setSaveDescription("저장하지 않은 변경 사항이 있습니다.");
    setSaveState("unsaved");
    setPublication(undefined);
  }

  async function publish() {
    if (!draft || !source || busy || session.state !== "ready") return;
    setSaving(true);
    setError("");
    try {
      if (draft.revision !== source.revision) {
        throw new Error(
          "원본과 초안의 버전이 다릅니다. 초안을 내보내고 원본을 다시 여십시오.",
        );
      }
      const operationName = "save";
      const requestId =
        draft.operation === operationName
          ? draft.requestId
          : crypto.randomUUID();
      setDraft({ ...draft, operation: operationName, requestId });
      // Capture one immutable pair before hashing or making any network request.
      const snapshot = JSON.parse(JSON.stringify(draft)) as SourceDraft;
      const editor =
        snapshot.blocks
          ? await editorDocument(
              source.document.metadata.id,
              snapshot.markdown,
              snapshot.blocks,
            )
          : undefined;
      // A response can be lost after GitHub accepted it. Keep its exact request locally.
      localStorage.setItem(
        draftKey,
        JSON.stringify({
          ...snapshot,
          operation: operationName,
          requestId,
          markdownHash: editor?.markdownHash,
          publication,
        }),
      );
      const editorChanges = {
        baseEditorRevision: source.editorRevision ?? null,
        ...(editor ? { editor } : {}),
      };
      const operation = isCanonical
          ? {
              type: "post.update",
              ...editorChanges,
              id: source.document.metadata.id,
              baseRevision: source.revision,
              changes: {
                title: snapshot.title,
                tags: snapshot.tags ?? [],
                ...(snapshot.category
                  ? { category_id: snapshot.category }
                  : {}),
              },
              markdown: snapshot.markdown,
              assets: snapshot.assets,
            }
          : {
              type: "post.create",
              ...editorChanges,
              document: {
                metadata: {
                  ...source.document.metadata,
                  title: snapshot.title,
                  tags: snapshot.tags ?? [],
                  ...(snapshot.category
                    ? { category_id: snapshot.category }
                    : {}),
                },
                markdown: snapshot.markdown,
              },
              assets: snapshot.assets,
            };
      await enqueueContentSync({baseCommit:source.contentCommit,operation,
        pendingCategories:source.pendingCategories},session,draftKey,requestId);
      setPublication({state:"validating",requestId,background:true});
      onDraftSaved?.();
    } catch (reason) {
      setNeedsLogin(
        reason instanceof Error && "status" in reason && reason.status === 401,
      );
      setError(
        reason instanceof Error
          ? reason.message
          : "저장하지 못했습니다. 초안은 유지합니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function changed(event: Event) {
      const detail = (event as CustomEvent).detail;
      if(detail?.scope!==syncScope(session) || !detail.batch?.items.some((item:{draftKey:string})=>item.draftKey===draftKey))return;
      if(detail.state==="confirmed") {
        const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null") as SourceDraft | null;
        const id = detail.batch.items.find((item:{draftKey:string})=>item.draftKey===draftKey).target;
        const nextSource = detail.result.sources?.[id] ?? saved?.sourceDocument;
        if(nextSource) {
          setSource(nextSource);
          setPublishedId(id);
          setDraft(current=>current?{...current,revision:nextSource.revision,contentCommit:nextSource.contentCommit,sourceDocument:nextSource,syncVersion:saved?.syncVersion}:current);
        }
        if(detail.batch.items.some((item:{clientRequestId:string})=>item.clientRequestId===saved?.requestId)) {
          setPublication({...detail.result,background:true});setError("");
        }
        if(detail.result.state!=="saved"&&!detail.result.publicationPending)onSaved?.(detail.result.contentCommit);
      } else if(detail.state==="publication") {
        const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null") as SourceDraft | null;
        if(detail.batch.items.some((item:{clientRequestId:string})=>item.clientRequestId===saved?.requestId))setPublication({...detail.result,background:true});
      } else if(detail.state==="failed") {
        setNeedsLogin(detail.error?.status===401);
        setError(detail.error?.message ?? "저장하지 못했습니다. 초안은 유지합니다.");
      }
    }
    window.addEventListener(SYNC_EVENT,changed);
    return ()=>window.removeEventListener(SYNC_EVENT,changed);
  },[draftKey,session.user?.id,onSaved]);

  function reopenSource() {
    if (saving || uploading) return;
    if (
      !["published", "superseded", "unchanged"].includes(
        publication?.state ?? "",
      ) &&
      !window.confirm(
        "보관한 초안을 지우고 최신 원본을 엽니다. 필요한 내용은 먼저 Markdown과 원본 백업으로 내보내십시오.",
      )
    )
      return;
    try {
      void discardContentConflict(session,source?.document.metadata.id).catch(reason=>setError(reason.message));
      localStorage.removeItem(draftKey);
    } catch {
      setDraftError(
        "보관한 초안을 지우지 못했습니다. Markdown으로 내보내십시오.",
      );
      return;
    }
    previewUrls.current.clear();
    reservedUploadNames.current.clear();
    setSource(null);
    setDraft(null);
    setPublication(undefined);
    setError("");
    setDraftError("");
    setGeneration((current) => current + 1);
  }

  function attachmentPath(name: string) {
    return (
      "./" +
      encodeURIComponent(name).replace(
        /[()]/g,
        (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
      )
    );
  }

  async function upload(file: File) {
    if (!draft || saving || accepted || draftError)
      throw new Error("첨부를 저장할 수 없습니다.");
    const name = validateAttachmentName(file.name);
    const key = name.normalize("NFC").toLowerCase();
    if (
      reservedUploadNames.current.has(key) ||
      [...(source?.assets ?? []), ...draft.assets].some(
        (asset) => asset.name.normalize("NFC").toLowerCase() === key,
      )
    ) {
      throw new Error("같은 이름의 첨부가 있습니다. 파일명을 바꾸십시오.");
    }
    reservedUploadNames.current.add(key);
    setUploadCount((count) => count + 1);
    setError("");
    try {
      const asset = await uploadAttachment(file, csrfToken);
      const destination = attachmentPath(name);
      if (file.type.startsWith("image/")) {
        const preview = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () =>
            reject(new Error("첨부 미리보기를 읽지 못했습니다."));
          reader.readAsDataURL(file);
        });
        previewUrls.current.set(destination, preview);
      }
      change((current) => ({ assets: [...current.assets, asset] }));
      return destination;
    } catch (reason) {
      reservedUploadNames.current.delete(key);
      setNeedsLogin(
        reason instanceof Error && "status" in reason && reason.status === 401,
      );
      setError(
        reason instanceof Error
          ? reason.message
          : "첨부를 저장하지 못했습니다.",
      );
      throw reason;
    } finally {
      setUploadCount((count) => count - 1);
    }
  }

  const resolvePreviewUrl = useCallback(
    (url: string) => {
      const preview = previewUrls.current.get(url);
      if (preview) return preview;
      if (!source || !session.connection?.repository) return url;
      const relative = url.startsWith("./") ? url.slice(2) : url;
      let name: string;
      try {
        name = decodeURIComponent(relative);
      } catch {
        return url;
      }
      const asset = [...source.assets, ...(draft?.assets ?? [])].find(
        (item) => item.name === name,
      );
      if (!url.startsWith("./") && !asset) return url;
      const path = asset ? attachmentPath(asset.name).slice(2) : relative;
      const localPreview = previewUrls.current.get("./" + path);
      if (localPreview) return localPreview;
      return `https://raw.githubusercontent.com/${session.connection.repository}/${source.contentCommit}/posts/${source.document.metadata.id}/${path}`;
    },
    [source, session.connection?.repository, draft?.assets],
  );

  async function importFile(file: File | undefined) {
    if (!file || !blockEditor.current || !draft || !source || busy) return;
    try {
      if (file.size > editorConfig.maxDocumentBytes) {
        throw new Error("문서는 10MB 이하로 선택하십시오.");
      }
      const text = await file.text();
      const editor = blockEditor.current;
      if (file.name.endsWith(".json")) {
        const parsed = JSON.parse(text);
        const isEditorDocument =
          parsed.schemaVersion === 1 && parsed.documentId;
        const backup = isEditorDocument
          ? {
              blocks: validateEditorDocument(parsed, {
                documentId: parsed.documentId,
                markdownHash: parsed.markdownHash,
              }).blocks,
              title: draft.title,
              category: draft.category,
            }
          : parseBlockBackup(text);
        const markdown =
          typeof parsed.markdown === "string" ? parsed.markdown : undefined;
        if (!isEditorDocument) {
          const hash = await markdownHash(markdown ?? "");
          validateEditorDocument(
            {
              schemaVersion: 1,
              documentId: source.document.metadata.id,
              markdownHash: parsed.markdownHash ?? hash,
              blocks: backup.blocks,
            },
            { documentId: source.document.metadata.id, markdownHash: hash },
          );
        }
        let category = backup.category;
        if (
          category &&
          !source.categories.some((item) => item.id === category)
        ) {
          const matches = source.categories.filter(
            (item) => item.name === category,
          );
          if (matches.length !== 1)
            throw new Error("백업의 분류를 현재 저장소에서 찾지 못했습니다.");
          category = matches[0].id;
        }
        const incoming = [
          ...recoveryAssets(parsed.sourceDocument?.assets ?? []),
          ...recoveryAssets(parsed.assets ?? []),
        ];
        const assets = [...draft.assets];
        const known = new Map(
          [...source.assets, ...assets].map((asset) => [
            asset.name.normalize("NFC").toLowerCase(),
            asset,
          ]),
        );
        for (const asset of incoming) {
          const key = asset.name.normalize("NFC").toLowerCase();
          const existing = known.get(key);
          if (existing) {
            if (
              existing.name !== asset.name ||
              existing.sha !== asset.sha ||
              existing.size !== asset.size
            ) {
              throw new Error("백업의 첨부 파일명이 현재 첨부와 충돌합니다.");
            }
            continue;
          }
          known.set(key, asset);
          assets.push(asset);
        }
        if (
          parsed.tags !== undefined &&
          (!Array.isArray(parsed.tags) ||
            parsed.tags.some((tag: unknown) => typeof tag !== "string"))
        ) {
          throw new Error("태그 목록을 확인하십시오.");
        }
        editor.replaceBlocks(editor.document, backup.blocks as StoredBlock[]);
        change({
          tags: parsed.tags ?? draft.tags,
          title: backup.title,
          category,
          assets,
          blocks: storedBlocks(editor),
          markdown: markdown ?? serializeEditorMarkdown(editor),
        });
      } else {
        const imported = parseMarkdownDocument(text);
        const metadata = imported.documentMode === "patch" ? imported.patch.changes : imported.metadata;
        const importedTags = metadata.tags;
        if (importedTags !== undefined && (!Array.isArray(importedTags) || importedTags.some(tag => typeof tag !== "string"))) {
          throw new Error("태그 목록을 확인하십시오.");
        }
        const categoryName = metadata.category_id ?? imported.category;
        let category = draft.category;
        if (categoryName) {
          const match = source.categories.find(
            (item) => item.id === categoryName || item.name === categoryName,
          );
          if (!match)
            throw new Error("문서의 분류를 현재 저장소에서 찾지 못했습니다.");
          category = match.id;
        }
        const blocks = editor.tryParseMarkdownToBlocks(imported.markdown);
        editor.replaceBlocks(
          editor.document,
          blocks.length ? blocks : [{ type: "paragraph" }],
        );
        change({
          ...(imported.title ? { title: imported.title } : {}),
          ...(Array.isArray(importedTags) ? { tags: importedTags as string[] } : {}),
          category,
          blocks: storedBlocks(editor),
          markdown: serializeEditorMarkdown(editor),
        });
      }
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "문서를 읽지 못했습니다.",
      );
    }
  }

  function exportMarkdown() {
    if (draft) {
      downloadFile(
        draft.title + ".md",
        draft.markdown,
        "text/markdown;charset=utf-8",
      );
    }
  }

  function exportBackup() {
    if (source?.editorError) {
      if (source.editorRaw !== undefined)
        downloadFile("editor.json", source.editorRaw, "application/json");
      return;
    }
    const bytes = draft
      ? JSON.stringify(draft, null, 2)
      : localStorage.getItem(draftKey);
    if (bytes !== null && bytes !== undefined)
      downloadFile(
        (draft?.title || "recovery") + ".json",
        bytes,
        "application/json",
      );
  }

  const [previewMarkdown, setPreviewMarkdown] = useState("");
  useEffect(() => {
    // Coalesce reader rendering during typing; recovery remains synchronous.
    const timer = setTimeout(() => setPreviewMarkdown(draft?.markdown ?? ""), 200);
    return () => clearTimeout(timer);
  }, [draft?.markdown]);

  const preview = useDeferredValue(
    useMemo(
      () => ({
        title: draft?.title ?? "",
        body: previewMarkdown,
        categoryId: draft?.category || null,
        tags: draft?.tags ?? [],
      }),
      [draft?.title, previewMarkdown, draft?.category, draft?.tags],
    ),
  );
  const categories = useMemo(() => {
    const items = source?.categories ?? [];
    const counts = new Map<string, number>();
    for (const post of posts) {
      let id = post.categoryId;
      const visited = new Set<string>();
      while (id && !visited.has(id)) {
        visited.add(id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
        id =
          items.find((category) => category.id === id)?.parent_id ?? undefined;
      }
    }
    return items.map((category) => ({
      ...category,
      parentId: category.parent_id,
      count: counts.get(category.id) ?? 0,
    }));
  }, [source?.categories, posts]);

  function addTags() {
    const additions = tagInput
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (additions.length)
      change({ tags: [...new Set([...(draft?.tags ?? []), ...additions])] });
    setTagInput("");
  }

  return (
    <div
      className="editor-page notebook-writing managed-writing"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void publish();
        }}
      >
        <ManagedEditorToolbar
          title={draft?.title ?? post?.title ?? ""}
          error={error || draftError}
          onClose={() => {
            saveRecovery();
            onDraftSaved?.();
            onClose();
          }}
          onImport={importFile}
          onExportMarkdown={exportMarkdown}
          onExportBackup={exportBackup}
          disabled={busy || session.state !== "ready"}
        />

        {needsLogin ? <a href="/api/auth/github">GitHub 다시 로그인</a> : null}
        {draft && !draftError ? (
          <header className="mock-publication-header">
            <div className="mock-publication-state">
              <span
                id="editor-status"
                data-save-state={isCanonical ? undefined : saveState}
                className={"status-badge status-" +
                  (isCanonical
                    ? PostStatus.Published
                    : normalizePostStatus(draft.status))}
              >
                {postStatusLabel(
                  isCanonical ? PostStatus.Published : draft.status,
                )}
              </span>
              <span id="save-description" role="status">
                {saveDescription ||
                  (isCanonical
                    ? "다시 게시하기 전까지 공개 내용은 유지됩니다."
                    : "게시하기 전에는 공개되지 않습니다.")}
              </span>
            </div>
            <div className="editor-category">
              분류
              <HeaderAction
                type="button"
                className="mock-category-button"
                aria-label="글 분류"
                aria-haspopup="dialog"
                disabled={busy}
                aria-expanded={categoryOpen}
                aria-controls="editor-category-selection"
                onClick={() => setCategoryOpen(true)}
              >
                {categories.find((category) => category.id === draft.category)
                  ?.name || "분류 없음"}{" "}
                <span aria-hidden="true">⌄</span>
              </HeaderAction>
            </div>
            <HeaderAction
              type="button"
              className="mock-preview-toggle outline-button"
              aria-controls="managed-reader-preview"
              aria-expanded={previewVisible}
              onClick={() => setPreviewVisible(!previewVisible)}
            >
              {previewVisible ? "미리보기 숨기기" : "미리보기 표시"}
            </HeaderAction>
            <HeaderAction
              type="button"
              className="editor-save outline-button"
              data-save-state={saveState}
              disabled={busy}
              onClick={() => saveRecovery(true)}
            >
              초안 저장
            </HeaderAction>
            <HeaderAction
              type="submit"
              className="dark-button accent-button"
              disabled={busy || session.state !== "ready"}
            >
              게시하기 ↗
            </HeaderAction>
          </header>
        ) : null}
        <div
          className={"mock-writing-split" +
            (previewVisible ? "" : " mock-preview-hidden")}
        >
          <main
            className="editor-main"
            id="main-content"
          >
            {!draft || draftError ? (
              <p>
                {draftError
                  ? "보관한 초안을 내보낸 뒤 최신 원본을 다시 여십시오."
                  : isCanonical
                    ? "원본을 불러오는 중입니다."
                    : "편집기를 여는 중입니다."}
              </p>
            ) : (
              <>
                <fieldset
                  disabled={busy || session.state !== "ready"}
                  className="editor-fields"
                >

                  <div className="mock-editor-metadata">
                    <div className="mock-tag-field">
                      <div className="mock-tag-values">
                        {(draft.tags ?? []).map((tag) => (
                          <span className="mock-tag-chip" key={tag}>
                            {tag}
                            <button
                              type="button"
                              aria-label={tag + " 태그 삭제"}
                              onClick={() =>
                                change({
                                  tags: draft.tags?.filter(
                                    (value) => value !== tag,
                                  ),
                                })}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          aria-label="태그 입력"
                          placeholder="태그를 입력하세요"
                          value={tagInput}
                          onChange={(event) =>
                            setTagInput(event.target.value)}
                          onBlur={addTags}
                          onKeyDown={(event) => {
                            if (
                              !event.nativeEvent.isComposing &&
                              (event.key === "Enter" || event.key === ",")
                            ) {
                              event.preventDefault();
                              addTags();
                            }
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <input
                    className="editor-title"
                    aria-label="글 제목"
                    placeholder={editorConfig.untitledTitle}
                    value={draft.title}
                    required
                    onChange={(event) =>
                      change({ title: event.target.value })}
                  />

                </fieldset>
                <>
                  <p className="editor-tip">
                    빈 줄에서 / 를 입력하세요. 블록을 끌어 순서를 바꿀 수
                    있습니다.
                  </p>
                  <ManagedBlocks
                    key={generation}
                    draft={draft}
                    disabled={busy || session.state !== "ready"}
                    onChange={(blocks, markdown) =>
                      change({ blocks, markdown })}
                    onInitialize={(blocks) => {
                      setDraft(current => current && !current.blocks ? { ...current, blocks } : current);
                    }}
                    onError={() => setDraftError("편집 원본을 읽지 못했습니다. Markdown과 원본 백업을 내보내십시오.")}
                    onReady={(editor) => {
                      blockEditor.current = editor;
                    }}
                    upload={upload}
                    resolveFileUrl={async (url) => resolvePreviewUrl(url)}
                  />
                </>
                <div className="editor-note">

                  <p>
                    <>
                      초안은 이 브라우저에 저장합니다. 공개 사이트에는
                      반영하지 않습니다.
                      <br />
                      Markdown으로 내보내면 다른 곳에서 사용할 수 있습니다.
                      토글과 코드 설정은 원본 백업에 보존합니다.
                    </>
                  </p>

                </div>
              </>
            )}

            {publication ? (
              <PublishStatus
                publication={publication}
                csrfToken={csrfToken}
                onChange={setPublication}
                onRetry={() => retryContentSync(session)}
              />
            ) : null}
            {!saving &&
              (draftError ||
                (draft &&
                  (error ||
                    ["published", "superseded", "unchanged"].includes(
                      publication?.state ?? "",
                    )))) ? (
              <button
                className="outline-button"
                type="button"
                onClick={reopenSource}
              >
                {isCanonical ? "최신 원본으로 다시 시작" : "다음 글 작성"}
              </button>
            ) : null}
          </main>
          {draft && previewVisible ? (
            <ReaderPreview
              id="managed-reader-preview"
              snapshot={preview}
              categories={categories}
              resolveImageUrl={resolvePreviewUrl}
            />
          ) : null}
        </div>
      </form>
      {categoryOpen && draft && !draftError ? (
        <CategorySelectionDialog
          id="editor-category-selection"
          categories={categories}
          value={draft.category}
          allowEmpty={!isCanonical || !source?.document.metadata.category_id}
          onConfirm={category => {
            change({ category });
            setCategoryOpen(false);
          }}
          onClose={() => setCategoryOpen(false)}
        />
      ) : null}

    </div>
  );
}
