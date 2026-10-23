import {
  createBlockSpec,
  insertOrUpdateBlockForSlashMenu,
  type BlockNoteEditor,
} from "@blocknote/core";
import type { editorSchema } from "./code-block";

type NotebookEditor = BlockNoteEditor<
  typeof editorSchema.blockSchema,
  typeof editorSchema.inlineContentSchema,
  typeof editorSchema.styleSchema
>;

export const notebookBlockSpec = createBlockSpec(
  {
    type: "notebook",
    propSchema: {},
    content: "none",
    layoutOnly: true,
  },
  {
    parse(element) {
      if (element.matches('section[data-ivory-notebook="true"]')) return {};
      return undefined;
    },
    renderFrame() {
      const dom = document.createElement("section");
      dom.className = "ivory-notebook";
      dom.dataset.ivoryNotebook = "true";

      const holes = document.createElement("span");
      holes.className = "notebook-holes";
      holes.contentEditable = "false";
      holes.setAttribute("aria-hidden", "true");
      holes.append(...Array.from({ length: 3 }, () => document.createElement("i")));

      const slot = document.createElement("div");
      slot.className = "ivory-notebook-content";
      dom.append(holes, slot);
      return { dom, slot };
    },
  },
)();

export function insertNotebook(editor: NotebookEditor) {
  const notebook = insertOrUpdateBlockForSlashMenu(editor, {
    type: "notebook",
    children: [{ type: "paragraph" }],
  });
  editor.setTextCursorPosition(notebook.children[0], "start");
  editor.focus();
  return notebook;
}

export function notebookSlashItem(editor: NotebookEditor) {
  return {
    key: "ivory-notebook",
    title: "아이보리 줄노트",
    subtext: "줄노트 안에 글과 블록을 입력합니다.",
    aliases: ["노트", "줄노트", "아이보리", "notebook", "note", "ivory", "paper"],
    group: "노트",
    onItemClick: () => insertNotebook(editor),
  };
}
