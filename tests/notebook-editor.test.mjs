import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});
for (const name of [
  "window", "document", "navigator", "Node", "Element", "HTMLElement",
  "HTMLDivElement", "HTMLParagraphElement", "HTMLInputElement",
  "MutationObserver", "DOMParser", "DOMRect", "KeyboardEvent",
]) {
  Object.defineProperty(globalThis, name, {
    value: dom.window[name],
    configurable: true,
  });
}
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { BlockNoteEditor } = await import("@blocknote/core");
const { editorSchema } = await loadComponent("src/features/post-editor/code-block.ts");
const { notionExtension } = await import("../src/features/post-editor/notion-extension.ts");

function typeText(editor, text) {
  const view = editor.prosemirrorView;
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (handler) =>
      handler(view, from, to, character, () => view.state.tr.insertText(character)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

function enter(editor) {
  const view = editor.prosemirrorView;
  view.someProp("handleKeyDown", (handler) => handler(view, new KeyboardEvent("keydown", {
    key: "Enter", code: "Enter", keyCode: 13, bubbles: true, cancelable: true,
  })));
}

test("notebook slash insertion keeps editing and saved formatting inside its frame", async (t) => {
  assert.ok(editorSchema.blockSpecs.notebook, "The writing editor must support notebook blocks");
  const { notebookSlashItem } = await loadComponent("src/features/post-editor/notebook-block.ts");
  const editor = BlockNoteEditor.create({
    schema: editorSchema,
    extensions: [notionExtension],
    initialContent: [{ id: "empty", type: "paragraph" }],
  });
  const mount = document.createElement("div");
  document.body.append(mount);
  editor.mount(mount);
  t.after(() => {
    editor.unmount();
    editor._tiptapEditor.destroy();
    mount.remove();
  });
  editor.setTextCursorPosition("empty");
  notebookSlashItem(editor).onItemClick();
  const notebook = editor.document.find((block) => block.type === "notebook");
  assert.ok(notebook);
  assert.equal(notebook.children[0].type, "paragraph");
  assert.equal(editor.getTextCursorPosition().block.id, notebook.children[0].id);
  assert.equal(editor.getTextCursorPosition().parentBlock.id, notebook.id);
  assert.equal(editor.prosemirrorView.hasFocus(), true);
  assert.equal(mount.querySelectorAll(".ivory-notebook .notebook-holes i").length, 3);
  assert.ok(mount.querySelector('section[data-ivory-notebook="true"] .ivory-notebook-content .bn-block-content'));

  typeText(editor, "한글과 English");
  enter(editor);
  typeText(editor, "## ");
  assert.equal(editor.getTextCursorPosition().block.type, "heading");
  typeText(editor, "노트 안 제목");
  enter(editor);
  typeText(editor, "- ");
  assert.equal(editor.getTextCursorPosition().block.type, "bulletListItem");
  assert.equal(editor.getTextCursorPosition().parentBlock.id, notebook.id);
  typeText(editor, "노트 안 목록");
  editor.insertBlocks([
    { type: "checkListItem", props: { checked: true }, content: "확인한 항목" },
    { type: "codeBlock", props: { language: "javascript", caption: "예제", wrap: true }, content: "const n = 1;" },
  ], notebook.id, "last-child");
  const children = editor.getBlock(notebook.id).children;
  assert.deepEqual(children.map((block) => block.type), [
    "paragraph", "heading", "bulletListItem", "checkListItem", "codeBlock",
  ]);
  editor.setTextCursorPosition(children[0], "start");
  editor.toggleStyles({ bold: true });
  typeText(editor, "강조 ");
  assert.equal(editor.getBlock(children[0].id).content[0].styles.bold, true);
  editor.updateBlock(children[0], {
    content: [
      { type: "text", text: "강조 ", styles: { bold: true } },
      { type: "text", text: "recall", styles: { code: true } },
      { type: "text", text: ", ", styles: {} },
      { type: "text", text: "precision", styles: { code: true } },
    ],
  });
  assert.deepEqual(
    [...mount.querySelectorAll(".ivory-notebook .bn-inline-content code")].map((node) => node.textContent),
    ["recall", "precision"],
  );
  const nativeCss = await readFile(new URL("../node_modules/@blocknote/core/src/editor/Block.css", import.meta.url), "utf8");
  const notebookCss = await readFile(new URL("../src/styles/notebook.css", import.meta.url), "utf8");
  const style = document.createElement("style");
  style.textContent = nativeCss.match(/\.bn-inline-content code\s*\{[^}]*\}/)[0] + notebookCss;
  document.head.append(style);
  mount.classList.add("editor-canvas");
  t.after(() => style.remove());
  const paragraph = mount.querySelector('.ivory-notebook [data-content-type="paragraph"]');
  assert.match(getComputedStyle(paragraph).fontFamily, /Hi Melody/);
  for (const code of paragraph.querySelectorAll("code")) {
    assert.equal(getComputedStyle(code).fontFamily, "inherit");
  }
  const codeBlock = mount.querySelector(".ivory-notebook .notion-code .bn-inline-content");
  assert.match(getComputedStyle(codeBlock).fontFamily, /monospace/);

  const saved = JSON.parse(JSON.stringify(editor.document));
  const restored = BlockNoteEditor.create({ schema: editorSchema, initialContent: saved });
  t.after(() => restored._tiptapEditor.destroy());
  assert.deepEqual(JSON.parse(JSON.stringify(restored.document)), saved);
});
