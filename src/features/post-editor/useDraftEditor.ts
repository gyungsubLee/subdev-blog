import { useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import type { Block, PartialBlock } from "@blocknote/core";
import { ko } from "@blocknote/core/locales";
import { draftAssetUrl, draftDisplayMarkdown, readDrafts, saveDraft } from "../../shared/drafts.mjs";
import {
  attachmentName, dataUrlBytes, markdownDocument, parseBlockBackup,
  parseMarkdownDocument, validateDocumentAttachments,
} from "../../shared/document.mjs";
import { rewriteContentLinks } from "../../shared/content-links.mjs";
import { downloadFile } from "../../shared/download-file.mjs";
import type { JsonValue, Post, PublicCategory } from "../../shared/post";
import { editorSchema } from "./code-block";
import { editorConfig } from "./config";
import { serializeEditorMarkdown } from "./document-markdown";
import { notionExtension } from "./notion-extension";
import { syntaxHighlighting } from "./syntax-highlighting";

type StoredBlock = PartialBlock<typeof editorSchema.blockSchema>;
type Draft = Post & {
  blocks: StoredBlock[];
  editorVersion: number;
  sourceId?: string;
  documentId: string;
  documentMode: "full" | "patch" | "legacy";
  editorMode: "blocks" | "markdown";
  metadata: Record<string, JsonValue | undefined>;
  baseRevision?: string;
  originalMarkdown: string;
  attachments: { name: string; dataUrl: string; }[];
  changes: { title?: string; category_id?: string; };
  categoryChanged?: boolean;
};

export type DraftEditorProps = {
  post: Post | null;
  categories?: PublicCategory[];
  onClose: () => void;
  onSaved: (drafts: Post[]) => void;
};
const emptyCategories: PublicCategory[] = [];
// JSON duplicates bodies/blocks and expands bytes; keep a separate bounded container ceiling.
const maxBackupContainerBytes = editorConfig.maxDocumentBytes * 16;
const validId = (id: string | undefined) => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id ?? "");

function initialDraft(post: Post | null): Draft {
  const saved = post?.draft
    ? readDrafts(localStorage).find((draft: Post) => draft.id === post.id)
    : undefined;
  const sourceId = saved?.sourceId ?? (post && !post.draft ? post.id : undefined);
  let documentId = saved?.documentId;
  if (!documentId) {
    if (validId(sourceId)) documentId = sourceId!.toLowerCase();
    else if (validId(saved?.id.slice(6))) documentId = saved.id.slice(6);
    else documentId = crypto.randomUUID();
  }
  const createdAt = saved?.createdAt ?? post?.createdAt ?? new Date().toISOString();
  let documentMode = saved?.documentMode;
  if (!documentMode) {
    if (post && !post.draft) documentMode = "patch";
    else documentMode = saved ? "legacy" : "full";
  }
  const metadata = saved?.metadata ?? (documentMode === "full" ? {
    schema_version: 1,
    id: documentId,
    title: editorConfig.untitledTitle,
    parent_id: null,
    created: createdAt,
    updated: createdAt,
  } : {});
  return {
    id: saved?.id ?? "draft-" + crypto.randomUUID(),
    title: saved?.title ?? post?.title ?? "",
    category: saved?.category ?? post?.categoryId ?? post?.category ?? "",
    parentId: saved?.parentId ?? post?.parentId ?? null,
    createdAt,
    updatedAt: saved?.updatedAt ?? createdAt,
    markdown: saved?.markdown ?? post?.markdown ?? "",
    path: "",
    url: "",
    excerpt: "",
    draft: true,
    blocks: saved?.blocks ?? [],
    editorVersion: 1,
    sourceId,
    documentId,
    documentMode,
    editorMode: saved?.editorMode ?? (saved || !post ? "blocks" : "markdown"),
    metadata,
    baseRevision: saved?.baseRevision ?? (post && !post.draft ? post.revision : undefined),
    originalMarkdown: saved?.originalMarkdown ?? saved?.markdown ?? post?.markdown ?? "",
    attachments: saved?.attachments ?? [],
    changes: saved?.changes ?? {},
    categoryChanged: saved?.categoryChanged ?? false,
  };
}

function draftText(blocks: Block<typeof editorSchema.blockSchema>[]): string {
  return blocks.map((block) => {
    const content = "content" in block && Array.isArray(block.content)
      ? block.content.map((part) => "text" in part ? part.text : "").join("") : "";
    return [content, draftText(block.children ?? [])].filter(Boolean).join(" ");
  }).filter(Boolean).join(" ");
}

function previewBlocks(blocks: StoredBlock[], draft: Draft): StoredBlock[] {
  return blocks.map((block) => {
    const projected = structuredClone(block);
    const props = projected.props;
    if (props && "url" in props && typeof props.url === "string")
      Object.assign(props, { url: draftAssetUrl(draft, props.url) });
    if (projected.children) projected.children = previewBlocks(projected.children, draft);
    return projected;
  });
}

function readDataFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

async function originalFileRevision(file: File): Promise<string> {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new Error("원본 파일을 읽지 못했습니다."));
    reader.readAsArrayBuffer(file);
  });
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function validateSelectedAttachments(draft: Draft) {
  const names = new Set(draft.attachments.map((item) => item.name));
  rewriteContentLinks(draft.markdown, (url: string) => {
    if (url.startsWith("data:")) {
      dataUrlBytes(url);
      return url;
    }
    if (!url || url.startsWith("#") || /^(?:https?:)?\/\//i.test(url)) return url;
    if (/^[a-z][a-z\d+.-]*:/i.test(url)) throw new Error("첨부 주소 형식을 확인하십시오.");
    const pathname = url.split(/[?#]/)[0];
    const owned = pathname.match(/^\/content\/assets\/([^/]+)\/([^/]+)$/);
    const legacy = pathname.match(/^\/notion\/assets\/([^/]+)$/);
    if (owned) {
      if (owned[1] !== draft.documentId) throw new Error("첨부의 원본 ID가 다릅니다.");
      attachmentName(decodeURIComponent(owned[2]));
      return url;
    }
    if (legacy) {
      if (!validId(draft.sourceId)) throw new Error("첨부의 원본 ID가 없습니다.");
      attachmentName(decodeURIComponent(legacy[1]));
      return url;
    }
    if (/\.md$/i.test(pathname)) return url;
    const name = attachmentName(decodeURIComponent(pathname.replace(/^\.\//, "")));
    if (!names.has(name)) throw new Error("형제 첨부를 함께 선택하십시오: " + name);
    return url;
  });
}

export function useDraftEditor({ post, categories = emptyCategories, onClose, onSaved }: DraftEditorProps) {
  const [draft, setDraft] = useState(() => initialDraft(post));
  const latest = useRef(draft);
  latest.current = draft;
  const [status, setStatus] = useState("변경하면 초안을 자동 저장합니다.");
  const [error, setError] = useState("");
  const ready = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modified = useRef(false);
  const blocksChanged = useRef(false);
  const editor = useCreateBlockNote({
    schema: editorSchema,
    dictionary: ko,
    initialContent: draft.blocks.length ? previewBlocks(draft.blocks, draft) : undefined,
    extensions: [notionExtension, syntaxHighlighting],
    uploadFile: async (file) => {
      if (file.size > editorConfig.maxImageBytes) throw new Error("파일은 5MB 이하로 선택하십시오.");
      return readDataFile(file);
    },
  });

  function update(fields: Partial<Draft>) {
    latest.current = { ...latest.current, ...fields };
    setDraft(latest.current);
  }

  function snapshot(): Draft {
    const current = latest.current;
    let markdown = current.markdown;
    let blocks: StoredBlock[] = [];
    if (current.editorMode === "blocks") {
      blocks = !blocksChanged.current && current.blocks.length ? current.blocks : editor.document;
      if (blocksChanged.current || !current.blocks.length) markdown = serializeEditorMarkdown(editor);
    }
    const title = current.title || (current.metadata.title === "" ? "" : editorConfig.untitledTitle);
    const metadata = { ...current.metadata };
    const now = new Date().toISOString();
    if (current.documentMode !== "patch") {
      const changed = metadata.title !== title || current.originalMarkdown !== markdown || current.categoryChanged;
      metadata.title = title;
      if (current.categoryChanged) {
        if (current.category) metadata.category_id = current.category;
        else delete metadata.category_id;
      }
      if (current.originalMarkdown !== markdown) metadata.review_status = "needs_review";
      if (changed) metadata.updated = now;
    }
    return {
      ...current,
      title,
      metadata,
      markdown,
      updatedAt: now,
      category: current.category || editorConfig.defaultCategory,
      excerpt: (current.editorMode === "blocks" ? draftText(editor.document) : markdown.replace(/<[^>]*>/g, " ")).slice(0, 180),
      blocks,
    };
  }

  function persist() {
    try {
      const next = saveDraft(localStorage, snapshot());
      onSaved(next);
      modified.current = false;
      setError("");
      setStatus("이 브라우저에 저장했습니다.");
    } catch (reason) {
      setError("초안을 저장하지 못했습니다. 파일로 내보내십시오. " + (reason instanceof Error ? reason.message : ""));
      setStatus("저장 실패. 편집 내용은 화면에 남아 있습니다.");
    }
  }
  const saveRef = useRef(persist);
  saveRef.current = persist;
  function scheduleSave() {
    if (!ready.current) return;
    modified.current = true;
    setStatus("저장 중");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => saveRef.current(), editorConfig.autosaveDelayMs);
  }
  useEffect(() => {
    ready.current = true;
  }, []);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveRef.current();
      }
    }
    function beforeUnload(event: BeforeUnloadEvent) {
      if (modified.current) event.preventDefault();
    }
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("beforeunload", beforeUnload);
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function importFile(selection: File | File[] | undefined) {
    if (!selection) return;
    const files = Array.isArray(selection) ? selection : [selection];
    try {
      const documents = files.filter((file) => /\.(md|markdown)$/i.test(file.name));
      const backups = files.filter((file) => /\.json$/i.test(file.name));
      let file: File | undefined;
      if (documents.length === 1) file = documents[0];
      else if (documents.length === 0 && backups.length === 1) file = backups[0];
      if (!file) throw new Error("본문 문서 하나와 형제 첨부를 선택하십시오.");
      const isBackup = /\.json$/i.test(file.name);
      if (isBackup && file.size > maxBackupContainerBytes)
        throw new Error("백업 파일은 160MiB 이하로 선택하십시오.");
      if (!isBackup && file.size > editorConfig.maxDocumentBytes)
        throw new Error("문서는 10MB 이하로 선택하십시오.");
      if (!isBackup && files.reduce((total, selected) => total + selected.size, 0) > editorConfig.maxDocumentBytes)
        throw new Error("본문과 첨부의 입력 합계는 10MiB 이하로 선택하십시오. 큰 첨부는 로컬 CLI로 가져오십시오.");
      const text = await file.text();
      let candidate: Draft;
      if (/\.json$/i.test(file.name)) {
        const backup = parseBlockBackup(text);
        const seed = initialDraft(null);
        candidate = {
          ...seed,
          ...backup,
          id: latest.current.id,
          documentId: backup.documentId ?? (validId(backup.sourceId) ? backup.sourceId : seed.documentId),
          documentMode: backup.documentMode ?? "legacy",
          editorMode: backup.editorMode ?? "blocks",
          originalMarkdown: backup.originalMarkdown ?? backup.markdown ?? "",
          attachments: backup.attachments ?? [],
          changes: backup.changes ?? {},
          metadata: backup.metadata ?? {},
        };
      } else {
        const imported = parseMarkdownDocument(text);
        const sourceId = imported.documentMode === "patch" ? imported.patch.id : imported.id;
        const categoryId = imported.documentMode === "patch" ? imported.patch.changes.category_id : imported.metadata.category_id;
        const category = typeof categoryId === "string" ? categoryId : imported.category ?? "";
        candidate = {
          ...initialDraft(null),
          id: latest.current.id,
          documentId: sourceId ?? crypto.randomUUID(),
          sourceId,
          title: imported.title ?? file.name.replace(/\.(?:md|markdown)$/i, ""),
          category,
          documentMode: imported.documentMode,
          editorMode: "markdown",
          metadata: imported.documentMode === "patch" ? {} : imported.metadata,
          baseRevision: undefined,
          markdown: imported.markdown,
          originalMarkdown: imported.markdown,
          blocks: [],
          changes: imported.documentMode === "patch" ? imported.patch.changes : {},
          createdAt: imported.createdAt ?? new Date().toISOString(),
          parentId: imported.documentMode === "full" ? imported.metadata.parent_id : null,
        };
        if (imported.documentMode === "patch") candidate.baseRevision = imported.patch.baseRevision;
        else if (imported.documentMode === "full")
          candidate.baseRevision = imported.baseRevision ?? await originalFileRevision(file);
      }
      const siblings = files.filter((sibling) => sibling !== file);
      const attachments = await Promise.all(siblings.map(async (sibling) => {
        if (sibling.size > editorConfig.maxDocumentBytes) throw new Error("첨부는 10MB 이하로 선택하십시오.");
        return { name: attachmentName(sibling.name), dataUrl: await readDataFile(sibling) };
      }));
      candidate.attachments = validateDocumentAttachments([...candidate.attachments, ...attachments]);
      if (isBackup) {
        // Count the current body and decoded siblings once, excluding JSON/base64 duplication.
        const bodyBytes = new TextEncoder().encode(candidate.markdown).byteLength;
        const attachmentBytes = candidate.attachments.reduce(
          (total, attachment) => total + dataUrlBytes(attachment.dataUrl).bytes.byteLength, 0,
        );
        if (bodyBytes + attachmentBytes > editorConfig.maxDocumentBytes)
          throw new Error("본문과 첨부의 입력 합계는 10MiB 이하로 선택하십시오. 큰 첨부는 로컬 CLI로 가져오십시오.");
      }
      if (candidate.editorMode === "markdown") validateSelectedAttachments(candidate);
      if (candidate.editorMode === "blocks") {
        const blocks = candidate.blocks.length ? previewBlocks(candidate.blocks, candidate) : [{ type: "paragraph" as const }];
        editor.replaceBlocks(editor.document, blocks);
      }
      blocksChanged.current = candidate.editorMode === "blocks" && !candidate.markdown;
      update(candidate);
      scheduleSave();
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "문서를 읽지 못했습니다.");
    }
  }

  function exportMarkdown() {
    try {
      downloadFile((draft.title || editorConfig.untitledTitle) + ".md", markdownDocument(snapshot()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "문서를 내보내지 못했습니다.");
    }
  }

  function exportBackup() {
    try {
      const backup = JSON.stringify(snapshot(), null, 2);
      if (new TextEncoder().encode(backup).byteLength > maxBackupContainerBytes)
        throw new Error("백업 파일이 160MiB를 넘었습니다. Markdown으로 내보내십시오.");
      downloadFile((draft.title || editorConfig.untitledTitle) + ".json", backup, "application/json");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "백업을 내보내지 못했습니다.");
    }
  }

  function close() {
    if (modified.current) {
      try {
        onSaved(saveDraft(localStorage, snapshot()));
      } catch {
        setError("초안을 저장하지 못했습니다. 파일로 내보낸 뒤 다시 닫으십시오.");
        return;
      }
    }
    onClose();
  }

  function setTitle(title: string) {
    const current = latest.current;
    const changes = current.documentMode === "patch" ? { ...current.changes, title } : current.changes;
    update({ title, changes });
  }

  function setCategory(category: string) {
    const current = latest.current;
    const changes = { ...current.changes };
    if (current.documentMode === "patch") {
      if (category) changes.category_id = category;
      else delete changes.category_id;
    }
    update({ category, categoryChanged: true, changes });
  }

  return {
    editor,
    title: draft.title,
    setTitle,
    category: categories.some((category) => category.id === draft.category) ? draft.category : "",
    categoryPlaceholder: draft.category ? "기존 분류 유지" : "상위 분류 상속",
    setCategory,
    editorMode: draft.editorMode,
    markdown: draft.markdown,
    setMarkdown: (markdown: string) => update({ markdown }),
    previewMarkdown: draftDisplayMarkdown(draft),
    previewPost: draft,
    onBlocksChange: () => {
      blocksChanged.current = true;
      scheduleSave();
    },
    status,
    error,
    scheduleSave,
    persist,
    importFile,
    exportMarkdown,
    exportBackup,
    close,
  };
}
