import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
} from "@blocknote/react";
import { filterSuggestionItems } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../styles/notebook.css";
import { notebookSlashItem } from "../../features/post-editor/notebook-block";
import EditorToolbar from "../../features/post-editor/EditorToolbar";
import { editorConfig } from "../../features/post-editor/config";
import {
  useDraftEditor,
  type DraftEditorProps,
} from "../../features/post-editor/useDraftEditor";

export default function WritePage(props: DraftEditorProps) {
  const {
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
  } = useDraftEditor(props);

  return (
    <div className="editor-page notebook-writing">
      <EditorToolbar
        title={title}
        status={status}
        error={error}
        onClose={close}
        onImport={importFile}
        onExportMarkdown={exportMarkdown}
        onExportBackup={exportBackup}
        onSave={persist}
      />
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
          placeholder={editorConfig.untitledTitle}
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
                  [
                    {
                      ...notebookSlashItem(editor),
                      icon: (
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          aria-hidden="true"
                        >
                          <rect x="5" y="3" width="15" height="18" rx="2" />
                          <path d="M3 7h4M3 12h4M3 17h4M10 8h6M10 12h6M10 16h4" />
                        </svg>
                      ),
                    },
                    ...getDefaultReactSlashMenuItems(editor),
                  ],
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
