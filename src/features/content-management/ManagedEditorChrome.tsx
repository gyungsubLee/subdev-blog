import { memo, useRef, useState } from "react";
import { site } from "../../config/site";
import { editorConfig } from "../post-editor/config";
import EditorShortcuts from "../post-editor/EditorShortcuts";
import MarkdownContent from "../post-reader/MarkdownContent";
import type { Post } from "../../shared/post";
import "../post-reader/post-reader.css";
import "../post-editor/editor.css";
import "./managed-writing.css";

export type Category = {
  id: string;
  name: string;
  parentId?: string | null;
  count?: number;
};
export type PreviewSnapshot = {
  title: string;
  body: string;
  categoryId: string | null;
  tags: string[];
};
type Snapshot = PreviewSnapshot;

export function ManagedEditorToolbar({
  title,
  error,
  onClose,
  onImport,
  onExportMarkdown,
  onExportBackup,
  disabled,
}: {
  disabled: boolean;
  title: string;
  error: string;
  onClose: () => void;
  onImport: (file: File | undefined) => Promise<void>;
  onExportMarkdown: () => void;
  onExportBackup: () => void;
}) {
  const [help, setHelp] = useState(false);
  const fileMenu = useRef<HTMLDetailsElement | null>(null);
  function closeMenu() {
    if (fileMenu.current) fileMenu.current.open = false;
  }
  return (
    <>
      <header className="editor-header">
        <button type="button" className="editor-back" onClick={onClose}>
          ← 기록으로
        </button>
        <span className="editor-breadcrumb">
          {site.name} <span>/</span> {title || editorConfig.untitledTitle}
        </span>
        <div className="mock-header-actions">
          <details ref={fileMenu} className="mock-file-menu">
            <summary>저장·내보내기</summary>
            <div
              className="mock-file-actions"
              role="group"
              aria-label="파일 작업"
            >
              <label className="editor-file">
                불러오기
                <input
                  type="file"
                  disabled={disabled}
                  accept=".md,.markdown,.json"
                  onChange={(event) => {
                    void onImport(event.target.files?.[0]);
                    event.target.value = "";
                    closeMenu();
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => {
                  onExportMarkdown();
                  closeMenu();
                }}
              >
                .md 내보내기
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportBackup();
                  closeMenu();
                }}
              >
                원본 백업
              </button>
            </div>
          </details>
          <button
            type="button"
            className="editor-help"
            aria-expanded={help}
            onClick={() => setHelp(!help)}
          >
            단축키
          </button>
        </div>
      </header>
      {error && (
        <p className="editor-error" role="alert">
          {error}
        </p>
      )}
      {help && <EditorShortcuts onClose={() => setHelp(false)} />}
    </>
  );
}

export const ReaderPreview = memo(function ReaderPreview({
  id,
  snapshot,
  categories,
  resolveImageUrl,
}: {
  id: string;
  snapshot: Snapshot;
  categories: Category[];
  resolveImageUrl: (url: string) => string;
}) {
  const [mode, setMode] = useState("desktop");
  return (
    <aside
      id={id}
      className="mock-reader-preview"
      aria-label="독자 화면 미리보기"
    >
      <div
        className="mock-preview-controls"
        role="group"
        aria-label="미리보기 화면 크기"
      >
        <button
          type="button"
          aria-label="데스크톱"
          title="데스크톱"
          aria-pressed={mode === "desktop"}
          onClick={() => setMode("desktop")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="13" rx="2" />
            <path d="M8 21h8M12 17v4" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="모바일"
          title="모바일"
          aria-pressed={mode === "mobile"}
          onClick={() => setMode("mobile")}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <rect x="6" y="2" width="12" height="20" rx="2.5" />
            <path d="M10 5h4M11 19h2" />
          </svg>
        </button>
      </div>
      <div className={"mock-preview-sheet mock-preview-" + mode}>
        <p className="mock-preview-category">
          {categories.find((category) => category.id === snapshot.categoryId)
            ?.name || "분류 없음"}
        </p>
        <h1>{snapshot.title || "제목 없음"}</h1>
        {snapshot.tags.length > 0 && (
          <ul className="mock-preview-tags" aria-label="태그">
            {snapshot.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        <p className="mock-preview-byline">경섭의 기록 · Second Brain</p>
        <hr className="mock-preview-divider" />
        <div className="article-prose">
          <PreviewBody body={snapshot.body} resolveImageUrl={resolveImageUrl} />
        </div>
      </div>
    </aside>
  );
});

const PreviewBody = memo(function PreviewBody({ body, resolveImageUrl }: { body: string; resolveImageUrl: (url: string) => string }) {
  const post: Post = {
    id: "reader-preview",
    title: "",
    markdown: body,
    path: "",
    url: "",
    draft: true,
    category: "",
    parentId: null,
    createdAt: "",
    updatedAt: "",
    excerpt: "",
  };
  return <MarkdownContent body={body} post={post} posts={[post]} resolveImageUrl={resolveImageUrl} />;
});
