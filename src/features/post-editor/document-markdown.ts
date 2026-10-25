import { COLORS_DEFAULT, type Block, type BlockNoteEditor } from "@blocknote/core";
import type { editorSchema } from "./code-block";

type EditorBlock = Block<typeof editorSchema.blockSchema>;

function hasFormatting(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasFormatting);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([name, setting]) => {
    if (name === "underline" && setting === true) return true;
    if ((name === "textColor" || name === "backgroundColor") &&
        typeof setting === "string" && setting !== "default") return true;
    if (name === "textAlignment" && typeof setting === "string" && setting !== "left") return true;
    return hasFormatting(setting);
  });
}

function preserveFormatting(html: string): string {
  const container = document.createElement("div");
  container.innerHTML = html;
  const sample = document.createElement("span");
  const textColors = new Map<string, string>();
  const backgroundColors = new Map<string, string>();
  for (const [name, colors] of Object.entries(COLORS_DEFAULT)) {
    sample.style.color = colors.text;
    textColors.set(sample.style.color, name);
    sample.style.backgroundColor = colors.background;
    backgroundColors.set(sample.style.backgroundColor, name);
  }
  for (const element of container.querySelectorAll<HTMLElement>("[style]")) {
    const textColor = textColors.get(element.style.color);
    const backgroundColor = backgroundColors.get(element.style.backgroundColor);
    if (textColor) element.dataset.textColor = textColor;
    if (backgroundColor) element.dataset.backgroundColor = backgroundColor;
    const alignment = element.style.textAlign;
    if (["left", "center", "right", "justify"].includes(alignment)) {
      element.dataset.textAlignment = alignment;
    }
    // Only fixed palette names and supported alignments cross the HTML boundary.
    element.removeAttribute("style");
  }
  return container.innerHTML;
}

function requiresHTML(block: EditorBlock): boolean {
  return (
    block.type === "notebook" ||
    block.type === "toggleListItem" ||
    (block.type === "heading" && block.props.isToggleable) ||
    (block.type === "codeBlock" && Boolean(block.props.caption || block.props.wrap)) ||
    hasFormatting(block.props) ||
    ("content" in block && hasFormatting(block.content)) ||
    block.children.some(requiresHTML)
  );
}

function listTag(block: EditorBlock) {
  if (block.type === "numberedListItem") return "OL";
  if (["bulletListItem", "checkListItem", "toggleListItem"].includes(block.type))
    return "UL";
  return undefined;
}

function preservedHTML(
  editor: BlockNoteEditor<typeof editorSchema.blockSchema>,
  blocks: EditorBlock[],
): string {
  if (!blocks.some(requiresHTML)) return editor.blocksToHTMLLossy(blocks);

  const result = document.createElement("div");
  for (const block of blocks) {
    const part = document.createElement("div");
    if (requiresHTML(block)) {
      part.innerHTML = editor.blocksToHTMLLossy([{ ...block, children: [] }]);
      // Native lossy export lifts non-list children out of list items. Keep
      // notebook children in their original list item or paper slot instead.
      const slot =
        block.type === "notebook"
          ? part.querySelector<HTMLElement>(".ivory-notebook-content")!
          : part.querySelector<HTMLElement>("details") ??
            part.querySelector<HTMLElement>("li") ??
            part;
      slot.insertAdjacentHTML("beforeend", preservedHTML(editor, block.children));
    } else {
      part.innerHTML = editor.blocksToHTMLLossy([block]);
    }

    if (block.type === "codeBlock") {
      const pre = part.querySelector("pre");
      // The reader renders the caption from the pre attribute; drop its fallback.
      if (pre) part.replaceChildren(pre);
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
  if (!editor.document.some(requiresHTML)) {
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
    if (!group.some(requiresHTML)) {
      ordinaryBlocks.push(...group);
      continue;
    }
    flushOrdinaryBlocks();
    // HTML preserves notebook, toggle and code settings. Encoded line breaks keep blank code
    // lines inside one Markdown HTML block when the document is imported again.
    const html = preserveFormatting(preservedHTML(editor, group)).replaceAll("\n", "&#10;");
    // Separate heading source lines keep the reader's line-based anchors unique.
    parts.push(html.replace(/<h([1-3])\b/g, "\n<h$1"));
  }
  flushOrdinaryBlocks();
  return parts.join("\n\n");
}
