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
import CategorySelectionDialog from "../post-category/CategorySelectionDialog";
import type { EditorDocument, Post } from "../../shared/post";
import {
  isEditorFilename,
  validateEditorDocument,
} from "../../shared/editor-document.mjs";
import {
  parseBlockBackup,
  parseMarkdownDocument,
} from "../../shared/document.mjs";
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
import { requestApi, sendApi, uploadAttachment } from "./api";
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
  blocks?: EditorDocument["blocks"];
  markdownHash?: string;
  blockMode?: boolean;
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
  onReady,
  upload,
  resolveFileUrl,
}: {
  draft: SourceDraft;
  disabled: boolean;
  onChange: (blocks: EditorDocument["blocks"], markdown: string) => void;
  onReady: (editor: NotebookEditor | null) => void;
  upload: (file: File) => Promise<string>;
  resolveFileUrl: (url: string) => Promise<string>;
}) {
  const ready = useRef(false);
  const callbacks = useRef({ onChange, onReady, upload, resolveFileUrl });
  callbacks.current = { onChange, onReady, upload, resolveFileUrl };
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
      const blocks = editor.tryParseMarkdownToBlocks(draft.markdown);
      if (blocks.length) editor.replaceBlocks(editor.document, blocks);
      callbacks.current.onChange(
        storedBlocks(editor),
        serializeEditorMarkdown(editor),
      );
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
}: {
  post: Post | null;
  posts?: Post[];
  session: ManagementSession;
  onClose: () => void;
  onSaved?: (contentCommit?: string) => void;
  onDraftSaved?: () => void;
}) {
  const [tagInput, setTagInput] = useState("");
  const [previewVisible, setPreviewVisible] = useState(true);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [saveDescription, setSaveDescription] = useState("");
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [generation, setGeneration] = useState(0);
  const blockEditor = useRef<NotebookEditor | null>(null);
  const previewUrls = useRef(new Map<string, string>());
  const draftKey =
    "second-brain:canonical-draft:" + (post?.recoveryKey ?? post?.id ?? "new");
  const csrfToken = session.csrfToken ?? "";
  const accepted =
    publication && !["failed", "unchanged"].includes(publication.state);
  const uploading = uploadCount > 0;
  const busy = saving || uploading || Boolean(accepted) || Boolean(draftError);
  const blockMode = Boolean(
    draft &&
    !source?.editorError &&
    (!isCanonical || draft.blocks || draft.blockMode),
  );

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
          setSource(original);
          setDraft(value);
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
        const data = await requestApi<SourceDocument>("/api/content?" + query, {
          signal: controller.signal,
        });
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
        setSaveDescription(
          "초안을 저장했습니다. 다시 게시하기 전까지 공개 내용은 유지됩니다.",
        );
        onDraftSaved?.();
      }
    } catch {
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
      publication &&
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
    setPublication(undefined);
  }

  async function publish(remove = false) {
    if (!draft || !source || busy || session.state !== "ready") return;
    setSaving(true);
    setError("");
    try {
      if (draft.revision !== source.revision) {
        throw new Error(
          "원본과 초안의 버전이 다릅니다. 초안을 내보내고 원본을 다시 여십시오.",
        );
      }
      const operationName = remove ? "delete" : "save";
      const requestId =
        draft.operation === operationName
          ? draft.requestId
          : crypto.randomUUID();
      setDraft({ ...draft, operation: operationName, requestId });
      // Capture one immutable pair before hashing or making any network request.
      const snapshot = JSON.parse(JSON.stringify(draft)) as SourceDraft;
      const editor =
        !remove && snapshot.blocks
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
      const operation = remove
        ? {
            type: "post.delete",
            id: source.document.metadata.id,
            baseRevision: source.revision,
            baseEditorRevision: source.editorRevision ?? null,
          }
        : isCanonical
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
      const next = await sendApi<Publication>(
        "/api/content",
        {
          requestId,
          baseCommit: source.contentCommit,
          operation,
        },
        csrfToken,
      );
      setPublication(next);
      setConfirmDelete(false);
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
      if (blockMode && file.type.startsWith("image/")) {
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

  async function attach(file: File | undefined) {
    if (!file || !draft) return;
    try {
      const destination = await upload(file);
      if (blockMode && blockEditor.current) {
        const editor = blockEditor.current;
        editor.insertBlocks(
          [
            file.type.startsWith("image/")
              ? { type: "image", props: { url: destination, name: file.name } }
              : { type: "file", props: { url: destination, name: file.name } },
          ],
          editor.document.at(-1)!,
          "after",
        );
      } else {
        const label = file.name.replace(/[\[\]\\]/g, "\\$&");
        const prefix = file.type.startsWith("image/") ? "!" : "";
        setDraft((current) =>
          current
            ? {
                ...current,
                markdown:
                  current.markdown +
                  `\n\n${prefix}[${label}](${destination})\n`,
                requestId: crypto.randomUUID(),
              }
            : null,
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "첨부를 추가하지 못했습니다.",
      );
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
      className={
        blockMode
          ? "editor-page notebook-writing managed-writing"
          : "managed-editor"
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void publish();
        }}
      >
        {blockMode && draft ? (
          <ManagedEditorToolbar
            title={draft.title}
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
        ) : (
          <div className="management-toolbar">
            <button className="quiet-button" type="button" onClick={onClose}>
              ← 기록으로
            </button>
            <h1>{post ? "원본 수정" : "새 글 작성"}</h1>
            <button
              className="quiet-button"
              type="button"
              disabled={!draft}
              onClick={exportMarkdown}
            >
              Markdown 내보내기
            </button>
            <button
              className="quiet-button"
              type="button"
              disabled={Boolean(
                source?.editorError && source.editorRaw === undefined,
              )}
              onClick={exportBackup}
            >
              원본 백업
            </button>
          </div>
        )}
        {!blockMode && error ? <p role="alert">{error}</p> : null}
        {!blockMode && draftError ? <p role="alert">{draftError}</p> : null}
        {needsLogin ? <a href="/api/auth/github">GitHub 다시 로그인</a> : null}
        {blockMode && draft ? (
          <header className="mock-publication-header">
            <div className="editor-category">
              분류
              <button
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
              </button>
            </div>
            <div className="mock-publication-state">
              <span
                id="editor-status"
                className={
                  "status-badge status-" +
                  (isCanonical
                    ? PostStatus.Published
                    : normalizePostStatus(draft.status))
                }
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
            <button
              type="button"
              className="mock-preview-toggle outline-button"
              aria-controls="managed-reader-preview"
              aria-expanded={previewVisible}
              onClick={() => setPreviewVisible(!previewVisible)}
            >
              {previewVisible ? "미리보기 숨기기" : "미리보기 표시"}
            </button>
            <button
              type="button"
              className="editor-save outline-button"
              disabled={busy}
              onClick={() => saveRecovery(true)}
            >
              초안 저장
            </button>
            <button
              type="submit"
              className="dark-button accent-button"
              disabled={busy || session.state !== "ready"}
            >
              게시하기 ↗
            </button>
          </header>
        ) : null}
        <div
          className={
            blockMode
              ? "mock-writing-split" +
                (previewVisible ? "" : " mock-preview-hidden")
              : undefined
          }
        >
          <main
            className={blockMode ? "editor-main" : undefined}
            id="main-content"
          >
            {!draft ? (
              <p>
                {draftError
                  ? "보관한 초안을 내보낸 뒤 최신 원본을 다시 여십시오."
                  : "원본을 불러오는 중입니다."}
              </p>
            ) : (
              <>
                <fieldset
                  disabled={busy || session.state !== "ready"}
                  className={blockMode ? "editor-fields" : undefined}
                >
                  {!blockMode ? (
                    <label>
                      제목
                      <input
                        aria-label="글 제목"
                        value={draft.title}
                        required
                        onChange={(event) =>
                          change({ title: event.target.value })
                        }
                      />
                    </label>
                  ) : null}
                  {!blockMode ? (
                    <label>
                      분류
                      <select
                        aria-label="분류"
                        value={draft.category}
                        onChange={(event) =>
                          change({ category: event.target.value })
                        }
                      >
                        <option
                          value=""
                          disabled={Boolean(
                            post && source?.document.metadata.category_id,
                          )}
                        >
                          상위 글에서 상속
                        </option>
                        {source?.categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {blockMode ? (
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
                                  })
                                }
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
                              setTagInput(event.target.value)
                            }
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
                  ) : null}
                  {blockMode ? (
                    <input
                      className="editor-title"
                      aria-label="글 제목"
                      placeholder={editorConfig.untitledTitle}
                      value={draft.title}
                      required
                      onChange={(event) =>
                        change({ title: event.target.value })
                      }
                    />
                  ) : (
                    <>
                      <label>
                        본문 Markdown
                        <textarea
                          aria-label="본문 Markdown"
                          value={draft.markdown}
                          rows={22}
                          spellCheck={false}
                          onChange={(event) =>
                            change({ markdown: event.target.value })
                          }
                        />
                      </label>
                      <button
                        className="outline-button"
                        type="button"
                        onClick={() => {
                          const confirmed = window.confirm(
                            "블록 편집으로 전환하면 지원하지 않는 Markdown 표현이 바뀔 수 있습니다. 필요한 원문을 먼저 내보내십시오. 전환하시겠습니까?",
                          );
                          if (confirmed) change({ blockMode: true });
                        }}
                      >
                        노션형 블록 편집으로 전환
                      </button>
                    </>
                  )}
                  {!blockMode ? (
                    <button className="dark-button" type="submit">
                      {saving ? "저장 요청 중" : "원본 저장"}
                    </button>
                  ) : null}
                </fieldset>
                {blockMode ? (
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
                        change({ blocks, markdown })
                      }
                      onReady={(editor) => {
                        blockEditor.current = editor;
                      }}
                      upload={upload}
                      resolveFileUrl={async (url) => resolvePreviewUrl(url)}
                    />
                  </>
                ) : null}
                <div className={blockMode ? "editor-note" : undefined}>
                  {!blockMode ? (
                    <label className="editor-attachment">
                      첨부 추가
                      <input
                        type="file"
                        disabled={busy || session.state !== "ready"}
                        onChange={(event) => {
                          void attach(event.target.files?.[0]);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                  <p>
                    {blockMode ? (
                      <>
                        초안은 이 브라우저에 저장합니다. 공개 사이트에는
                        반영하지 않습니다.
                        <br />
                        Markdown으로 내보내면 다른 곳에서 사용할 수 있습니다.
                        토글과 코드 설정은 원본 백업에 보존합니다.
                      </>
                    ) : (
                      "입력한 내용은 이 브라우저에 초안으로 저장합니다. 원본 저장을 누르면 GitHub에 저장합니다."
                    )}
                  </p>
                  {!blockMode && isCanonical ? (
                    <button
                      className="quiet-button"
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmDelete(true)}
                    >
                      글 삭제
                    </button>
                  ) : null}
                </div>
              </>
            )}
            {confirmDelete ? (
              <section
                role="alertdialog"
                aria-label="글 삭제"
                className="publish-status"
              >
                <p>
                  「{draft?.title}」 원본과 첨부를 삭제합니다. 하위 글과 참조가
                  있으면 삭제를 거부합니다.
                </p>
                <button
                  className="outline-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void publish(true)}
                >
                  삭제 확정
                </button>
                <button
                  className="quiet-button"
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                >
                  글 유지
                </button>
              </section>
            ) : null}
            {publication ? (
              <PublishStatus
                publication={publication}
                csrfToken={csrfToken}
                onChange={setPublication}
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
          {blockMode && previewVisible ? (
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
