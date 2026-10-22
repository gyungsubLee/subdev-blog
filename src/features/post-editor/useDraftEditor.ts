import { useEffect, useRef, useState } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import type { PartialBlock } from "@blocknote/core";
import { ko } from "@blocknote/core/locales";
import { readDrafts, saveDraft } from "../../shared/drafts.mjs";
import {
  markdownDocument,
  parseBlockBackup,
  parseMarkdownDocument,
} from "../../shared/document.mjs";
import { downloadFile } from "../../shared/download-file.mjs";
import type { Post } from "../../shared/post";
import { editorSchema } from "./code-block";
import { editorConfig } from "./config";
import { notionExtension } from "./notion-extension";
import { syntaxHighlighting } from "./syntax-highlighting";

type StoredBlock = PartialBlock<typeof editorSchema.blockSchema>;
type Draft = Post & {
  blocks: StoredBlock[];
  editorVersion: number;
  sourceId?: string;
};

export type DraftEditorProps = {
  post: Post | null;
  onClose: () => void;
  onSaved: (drafts: Post[]) => void;
};

function initialDraft(post: Post | null): Draft | null {
  if (!post?.draft) return null;
  const saved = readDrafts(localStorage).find(
    (draft: Draft) => draft.id === post.id,
  );
  return saved ?? null;
}

export function useDraftEditor({ post, onClose, onSaved }: DraftEditorProps) {
  const [existing] = useState(() => initialDraft(post));
  const [id] = useState(() => existing?.id ?? "draft-" + crypto.randomUUID());
  const [createdAt, setCreatedAt] = useState(
    () => existing?.createdAt ?? post?.createdAt ?? new Date().toISOString(),
  );
  const [sourceId, setSourceId] = useState(
    existing?.sourceId ?? (post && !post.draft ? post.id : undefined),
  );
  const [title, setTitle] = useState(post?.title ?? "");
  const [category, setCategory] = useState(
    post?.category ?? editorConfig.defaultCategory,
  );
  const [status, setStatus] = useState("변경하면 초안을 자동 저장합니다.");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modified = useRef(false);
  const latest = useRef({ title, category });
  latest.current = { title, category };

  const editor = useCreateBlockNote({
    schema: editorSchema,
    dictionary: ko,
    initialContent: existing?.blocks.length ? existing.blocks : undefined,
    extensions: [notionExtension, syntaxHighlighting],
    uploadFile: async (file) => {
      if (file.size > editorConfig.maxImageBytes)
        throw new Error("파일은 5MB 이하로 선택하십시오.");
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
        reader.readAsDataURL(file);
      });
    },
  });

  function snapshot(): Draft {
    const now = new Date().toISOString();
    return {
      id,
      title: latest.current.title.trim() || editorConfig.untitledTitle,
      parentId: post?.parentId ?? null,
      category: latest.current.category.trim() || editorConfig.defaultCategory,
      createdAt,
      updatedAt: now,
      markdown: editor.blocksToMarkdownLossy(editor.document),
      path: "",
      url: "",
      excerpt: editor.document
        .map((block) =>
          "content" in block && Array.isArray(block.content)
            ? block.content
                .map((part) => ("text" in part ? part.text : ""))
                .join("")
            : "",
        )
        .join(" ")
        .slice(0, 180),
      draft: true,
      blocks: editor.document,
      editorVersion: 1,
      sourceId,
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
      setError(
        "초안을 저장하지 못했습니다. Markdown 또는 원본 백업으로 내보내십시오. " +
          (reason instanceof Error ? reason.message : ""),
      );
      setStatus("저장 실패. 편집 내용은 화면에 남아 있습니다.");
    }
  }
  const saveRef = useRef(persist);
  saveRef.current = persist;

  function scheduleSave() {
    if (!ready) return;
    modified.current = true;
    setStatus("저장 중");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => saveRef.current(),
      editorConfig.autosaveDelayMs,
    );
  }

  useEffect(() => {
    if (post && !existing) {
      const blocks = editor.tryParseMarkdownToBlocks(post.markdown);
      if (blocks.length) editor.replaceBlocks(editor.document, blocks);
    }
    setReady(true);
  }, [editor, existing, post]);

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

  async function importFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > editorConfig.maxDocumentBytes)
        throw new Error("문서는 10MB 이하로 선택하십시오.");
      const text = await file.text();
      if (file.name.endsWith(".json")) {
        const draft = parseBlockBackup(text);
        editor.replaceBlocks(editor.document, draft.blocks);
        latest.current = {
          title: draft.title,
          category: draft.category || editorConfig.defaultCategory,
        };
        setTitle(draft.title);
        setCategory(draft.category || editorConfig.defaultCategory);
        setSourceId(draft.sourceId);
        if (draft.createdAt && !Number.isNaN(Date.parse(draft.createdAt)))
          setCreatedAt(draft.createdAt);
      } else {
        const imported = parseMarkdownDocument(text);
        const blocks = editor.tryParseMarkdownToBlocks(imported.markdown);
        editor.replaceBlocks(
          editor.document,
          blocks.length ? blocks : [{ type: "paragraph" }],
        );
        if (imported.title) setTitle(imported.title);
        if (imported.category) setCategory(imported.category);
        setSourceId(imported.sourceId);
        if (imported.createdAt && !Number.isNaN(Date.parse(imported.createdAt)))
          setCreatedAt(imported.createdAt);
        latest.current = {
          title: imported.title ?? latest.current.title,
          category: imported.category ?? latest.current.category,
        };
      }
      scheduleSave();
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "문서를 읽지 못했습니다.",
      );
    }
  }

  function exportMarkdown() {
    downloadFile(
      (title || editorConfig.untitledTitle) + ".md",
      markdownDocument(snapshot()),
    );
  }

  function exportBackup() {
    downloadFile(
      (title || editorConfig.untitledTitle) + ".json",
      JSON.stringify(snapshot(), null, 2),
      "application/json",
    );
  }

  function close() {
    if (modified.current) {
      try {
        onSaved(saveDraft(localStorage, snapshot()));
      } catch (reason) {
        setError(
          "초안을 저장하지 못했습니다. 파일로 내보낸 뒤 다시 닫으십시오.",
        );
        return;
      }
    }
    onClose();
  }

  return {
    editor,
    title,
    setTitle,
    category,
    setCategory,
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
