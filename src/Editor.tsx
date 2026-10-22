import { useEffect, useRef, useState } from "react";
import {
  useCreateBlockNote,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
} from "@blocknote/react";
import { filterSuggestionItems, type PartialBlock } from "@blocknote/core";
import { SyntaxHighlightingExtension } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import { ko } from "@blocknote/core/locales";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { notionExtension } from "./notion-extension";
import { editorSchema } from "./code-block";
import { parseBlockBackup, parseMarkdownDocument } from "./import-document.mjs";
import {
  downloadFile,
  markdownDocument,
  readDrafts,
  saveDraft,
} from "./drafts.mjs";
import type { Post } from "./types";
import "./editor.css";

type StoredBlock = PartialBlock<typeof editorSchema.blockSchema>;
type Draft = Post & {
  blocks: StoredBlock[];
  editorVersion: number;
  sourceId?: string;
};

const syntax = SyntaxHighlightingExtension({
  createHighlighter: async () => {
    const [{ createBundledHighlighter }, { createOnigurumaEngine }] =
      await Promise.all([
        import("shiki/core"),
        import("shiki/engine/oniguruma"),
      ]);
    const grammars = {
      javascript: () => import("@shikijs/langs/javascript"),
      typescript: () => import("@shikijs/langs/typescript"),
      python: () => import("@shikijs/langs/python"),
      go: () => import("@shikijs/langs/go"),
      bash: () => import("@shikijs/langs/shellscript"),
      json: () => import("@shikijs/langs/json"),
      html: () => import("@shikijs/langs/html"),
      css: () => import("@shikijs/langs/css"),
      sql: () => import("@shikijs/langs/sql"),
      markdown: () => import("@shikijs/langs/markdown"),
      java: () => import("@shikijs/langs/java"),
      cpp: () => import("@shikijs/langs/cpp"),
    };
    const createHighlighter = createBundledHighlighter<
      keyof typeof grammars,
      "github-light"
    >({
      langs: grammars,
      themes: { "github-light": () => import("@shikijs/themes/github-light") },
      engine: () => createOnigurumaEngine(import("shiki/wasm")),
    });
    return createHighlighter({
      themes: ["github-light"],
      langs: Object.keys(grammars) as Array<keyof typeof grammars>,
    });
  },
});

const shortcuts = [
  ["/", "블록 메뉴 열기"],
  ["# · ## · ### + Space", "제목 1 · 2 · 3"],
  ["- + Space / [] + Space", "글머리 목록 / 체크박스"],
  ['> + Space / " + Space', "토글 / 인용"],
  ["``` + Space", "코드블록"],
  ["⌘/Ctrl + B · I · U · E", "굵게 · 기울임 · 밑줄 · 코드"],
  ["⌘/Ctrl + K", "링크"],
  ["⌘⌥ + 0–8 / Ctrl⇧ + 0–8", "블록 종류 바꾸기"],
  ["Tab / Shift + Tab", "들여쓰기 / 내어쓰기"],
  ["⌘/Ctrl + D", "블록 복제"],
  ["⌘/Ctrl + Shift + ↑/↓", "블록 이동"],
  ["⌘/Ctrl + S", "이 브라우저에 초안 저장"],
];

function initialDraft(post: Post | null): Draft | null {
  if (!post?.draft) return null;
  const saved = readDrafts(localStorage).find(
    (draft: Draft) => draft.id === post.id,
  );
  return saved ?? null;
}

export default function Editor({
  post,
  onClose,
  onSaved,
}: {
  post: Post | null;
  onClose: () => void;
  onSaved: (drafts: Post[]) => void;
}) {
  const [existing] = useState(() => initialDraft(post));
  const [id] = useState(() => existing?.id ?? "draft-" + crypto.randomUUID());
  const [createdAt, setCreatedAt] = useState(
    () => existing?.createdAt ?? post?.createdAt ?? new Date().toISOString(),
  );
  const [sourceId, setSourceId] = useState(
    existing?.sourceId ?? (post && !post.draft ? post.id : undefined),
  );
  const [title, setTitle] = useState(post?.title ?? "");
  const [category, setCategory] = useState(post?.category ?? "기록");
  const [status, setStatus] = useState("변경하면 초안을 자동 저장합니다.");
  const [error, setError] = useState("");
  const [help, setHelp] = useState(false);
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modified = useRef(false);
  const latest = useRef({ title, category });
  latest.current = { title, category };

  const editor = useCreateBlockNote({
    schema: editorSchema,
    dictionary: ko,
    initialContent: existing?.blocks.length ? existing.blocks : undefined,
    extensions: [notionExtension, syntax],
    uploadFile: async (file) => {
      if (file.size > 5 * 1024 * 1024)
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
      title: latest.current.title.trim() || "제목 없음",
      parentId: post?.parentId ?? null,
      category: latest.current.category.trim() || "기록",
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
    timer.current = setTimeout(() => saveRef.current(), 650);
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
      if (file.size > 10 * 1024 * 1024)
        throw new Error("문서는 10MB 이하로 선택하십시오.");
      const text = await file.text();
      if (file.name.endsWith(".json")) {
        const draft = parseBlockBackup(text);
        editor.replaceBlocks(editor.document, draft.blocks);
        latest.current = {
          title: draft.title,
          category: draft.category || "기록",
        };
        setTitle(draft.title);
        setCategory(draft.category || "기록");
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

  return (
    <div className="editor-page">
      <header className="editor-header">
        <button className="editor-back" onClick={close}>
          ← 기록으로
        </button>
        <span className="editor-breadcrumb">
          Second Brain <span>/</span> {title || "제목 없음"}
        </span>
        <button
          className="editor-help"
          onClick={() => setHelp(!help)}
          aria-expanded={help}
        >
          단축키
        </button>
      </header>
      <div className="editor-actions">
        <span role="status">{status}</span>
        <label className="editor-file">
          불러오기
          <input
            type="file"
            accept=".md,.markdown,.json"
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </label>
        <button
          onClick={() =>
            downloadFile(
              (title || "제목 없음") + ".md",
              markdownDocument(snapshot()),
            )
          }
        >
          .md 내보내기
        </button>
        <button
          onClick={() =>
            downloadFile(
              (title || "제목 없음") + ".json",
              JSON.stringify(snapshot(), null, 2),
              "application/json",
            )
          }
        >
          원본 백업
        </button>
        <button className="editor-save" onClick={persist}>
          초안 저장
        </button>
      </div>
      {error ? (
        <p className="editor-error" role="alert">
          {error}
        </p>
      ) : null}
      {help ? (
        <aside className="editor-shortcuts" aria-label="작성 단축키">
          <div className="editor-shortcuts-heading">
            <strong>익숙한 방식으로 쓰세요.</strong>
            <button onClick={() => setHelp(false)} aria-label="단축키 닫기">
              ×
            </button>
          </div>
          <dl>
            {shortcuts.map(([key, value]) => (
              <div key={key}>
                <dt>
                  <kbd>{key}</kbd>
                </dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <a
            href="https://www.notion.com/help/keyboard-shortcuts"
            target="_blank"
            rel="noreferrer"
          >
            Notion 공식 단축키 ↗
          </a>
        </aside>
      ) : null}
      <main className="editor-main">
        <p className="editor-eyebrow">WRITE A LITTLE. CONNECT A LOT.</p>
        <label className="editor-category">
          분류
          <input
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              scheduleSave();
            }}
          />
        </label>
        <input
          className="editor-title"
          aria-label="글 제목"
          placeholder="제목 없음"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            scheduleSave();
          }}
        />
        <p className="editor-tip">
          빈 줄에서 / 를 입력하세요. 블록을 끌어 순서를 바꿀 수 있습니다.
        </p>
        <div className="editor-canvas">
          <BlockNoteView
            editor={editor}
            theme="light"
            slashMenu={false}
            onChange={scheduleSave}
          >
            <SuggestionMenuController
              triggerCharacter="/"
              getItems={async (query) =>
                filterSuggestionItems(
                  getDefaultReactSlashMenuItems(editor),
                  query,
                )
              }
            />
          </BlockNoteView>
        </div>
        <footer className="editor-note">
          초안은 이 브라우저에 저장합니다. 공개 사이트에는 반영하지 않습니다.
          <br />
          Markdown으로 내보내면 다른 곳에서 사용할 수 있습니다. 토글과 코드
          설정은 원본 백업에 보존합니다.
        </footer>
      </main>
    </div>
  );
}
