import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
} from "@blocknote/react";
import { filterSuggestionItems, type BlockNoteEditor } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import "../../styles/notebook.css";
import "./editor.css";
import { notebookSlashItem } from "./notebook-block";
import type { editorSchema } from "./code-block";

export default function EditorCanvas({
  editor,
  onChange,
  editable = true,
}: {
  editor: BlockNoteEditor<typeof editorSchema.blockSchema>;
  onChange: () => void;
  editable?: boolean;
}) {
  return (
    <div className="editor-canvas">
      <BlockNoteView
        editor={editor}
        editable={editable}
        theme="light"
        slashMenu={false}
        onChange={onChange}
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
  );
}
