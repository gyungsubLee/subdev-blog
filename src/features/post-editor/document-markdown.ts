import type { Block, BlockNoteEditor } from "@blocknote/core";
import type { editorSchema } from "./code-block";

type EditorBlock = Block<typeof editorSchema.blockSchema>;

function containsNotebook(block: EditorBlock): boolean {
  return block.type === "notebook" || block.children.some(containsNotebook);
}

function listTag(block: EditorBlock) {
  if (block.type === "numberedListItem") return "OL";
  if (["bulletListItem", "checkListItem", "toggleListItem"].includes(block.type))
    return "UL";
  return undefined;
}

function notebookHTML(
  editor: BlockNoteEditor<typeof editorSchema.blockSchema>,
  blocks: EditorBlock[],
): string {
  if (!blocks.some(containsNotebook)) return editor.blocksToHTMLLossy(blocks);

  const result = document.createElement("div");
  for (const block of blocks) {
    const part = document.createElement("div");
    if (containsNotebook(block)) {
      part.innerHTML = editor.blocksToHTMLLossy([{ ...block, children: [] }]);
      // Native lossy export lifts non-list children out of list items. Keep
      // notebook children in their original list item or paper slot instead.
      const slot =
        block.type === "notebook"
          ? part.querySelector<HTMLElement>(".ivory-notebook-content")!
          : part.querySelector<HTMLElement>("details") ??
            part.querySelector<HTMLElement>("li") ??
            part;
      slot.insertAdjacentHTML("beforeend", notebookHTML(editor, block.children));
    } else {
      part.innerHTML = editor.blocksToHTMLLossy([block]);
    }

    const previous = result.lastElementChild;
    const current = part.firstElementChild;
    if (
      listTag(block) &&
      part.childNodes.length === 1 &&
      previous &&
      current &&
      previous.tagName === current.tagName
    ) {
      previous.append(...current.childNodes);
    } else {
      result.append(...part.childNodes);
    }
  }
  return result.innerHTML;
}

export function serializeEditorMarkdown(
  editor: BlockNoteEditor<typeof editorSchema.blockSchema>,
): string {
  if (!editor.document.some(containsNotebook)) {
    return editor.blocksToMarkdownLossy(editor.document);
  }

  const parts: string[] = [];
  let ordinaryBlocks: EditorBlock[] = [];
  function flushOrdinaryBlocks() {
    if (!ordinaryBlocks.length) return;
    parts.push(editor.blocksToMarkdownLossy(ordinaryBlocks));
    ordinaryBlocks = [];
  }

  const blocks = editor.document;
  for (let index = 0; index < blocks.length; index++) {
    const group = [blocks[index]];
    const tag = listTag(blocks[index]);
    while (tag && index + 1 < blocks.length && listTag(blocks[index + 1]) === tag) {
      group.push(blocks[++index]);
    }
    if (!group.some(containsNotebook)) {
      ordinaryBlocks.push(...group);
      continue;
    }
    flushOrdinaryBlocks();
    // Raw HTML preserves the note wrapper. Encoded line breaks keep blank code
    // lines inside one Markdown HTML block when the document is imported again.
    const html = notebookHTML(editor, group).replaceAll("\n", "&#10;");
    // Separate heading source lines keep the reader's line-based anchors unique.
    parts.push(html.replace(/<h([1-3])\b/g, "\n<h$1"));
  }
  flushOrdinaryBlocks();
  return parts.join("\n\n");
}
