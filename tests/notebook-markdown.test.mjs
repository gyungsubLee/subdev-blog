import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const name of [
  "window", "document", "navigator", "Node", "Element", "HTMLElement",
  "MutationObserver", "DOMParser",
]) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}
const { BlockNoteEditor } = await import("@blocknote/core");
const { editorSchema } = await loadComponent("src/features/post-editor/code-block.ts");
const { serializeEditorMarkdown } = await loadComponent("src/features/post-editor/document-markdown.ts");
const { default: MarkdownContent } = await loadComponent("src/features/post-reader/MarkdownContent.tsx");
const { default: PostReader } = await loadComponent("src/features/post-reader/PostReader.tsx");

const blocks = [
  { type: "paragraph", content: "노트 밖 본문" },
  { type: "numberedListItem", content: "첫 번째" },
  { type: "numberedListItem", content: "두 번째" },
  {
    type: "notebook",
    children: [
      { type: "heading", props: { level: 3 }, content: "✏️ 산술 평균" },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "조화 평균: ", styles: {} },
          { type: "text", text: "recall", styles: { code: true } },
          { type: "text", text: ", precision", styles: { bold: true } },
        ],
      },
      { type: "bulletListItem", content: "상위", children: [{ type: "bulletListItem", content: "하위" }] },
      { type: "codeBlock", props: { language: "javascript" }, content: "const n = 1;\n\nconsole.log(n);" },
    ],
  },
  { type: "paragraph", content: "노트 다음 본문" },
];

function renderBody(body) {
  const post = { id: "draft-test", markdown: body, path: "", title: "검사" };
  return new JSDOM(renderToStaticMarkup(createElement(MarkdownContent, { body, post, posts: [post] })))
    .window.document;
}

test("Markdown preserves notebook content, nested lists, inline formatting and code line breaks", () => {
  const editor = BlockNoteEditor.create({ schema: editorSchema, initialContent: blocks });
  try {
    const markdown = serializeEditorMarkdown(editor);
    assert.match(markdown, /^노트 밖 본문\n/);
    assert.match(markdown, /1\. 첫 번째\n2\. 두 번째/);
    assert.match(markdown, /<section[^>]*data-ivory-notebook="true"/);
    assert.ok(markdown.trimEnd().endsWith("노트 다음 본문"));
    const restored = editor.tryParseMarkdownToBlocks(markdown);
    const notebook = restored.find((block) => block.type === "notebook");
    assert.ok(notebook, "Markdown restores the notebook container");
    assert.equal(notebook.children[0].type, "heading");
    assert.equal(notebook.children[1].content[1].styles.code, true);
    assert.equal(notebook.children[1].content[2].styles.bold, true);
    const list = notebook.children.find((block) => block.type === "bulletListItem");
    assert.equal(list.children[0].content[0].text, "하위");
    const code = notebook.children.find((block) => block.type === "codeBlock");
    assert.equal(code.props.language, "javascript");
    assert.equal(code.content[0].text, "const n = 1;\n\nconsole.log(n);");
    const rendered = renderBody(markdown);
    const paper = rendered.querySelector(".ivory-notebook");
    assert.ok(paper, "Saved draft preview uses the same notebook paper");
    assert.equal(paper.querySelectorAll(".notebook-holes i").length, 3);
    assert.ok(paper.querySelector(".ivory-notebook-content h3"));
    assert.equal(paper.querySelector(".ivory-notebook-content p code")?.textContent, "recall");
    assert.match(paper.textContent, /precision/);
    assert.equal(paper.querySelector("pre code")?.textContent, "const n = 1;\n\nconsole.log(n);");
  } finally {
    editor._tiptapEditor.destroy();
  }
});

test("ordinary documents retain native Markdown and notebook HTML remains sanitized", () => {
  const editor = BlockNoteEditor.create({ schema: editorSchema, initialContent: blocks.slice(0, 3) });
  try {
    assert.equal(serializeEditorMarkdown(editor), editor.blocksToMarkdownLossy(editor.document));
    const rendered = renderBody(
      '<section data-ivory-notebook="true" onclick="alert(1)"><p>안전한 내용</p>' +
      '<script>alert(1)</script><img src="x" onerror="alert(1)"></section>' +
      '<section data-ivory-notebook="false">일반 영역</section>',
    );
    assert.equal(rendered.querySelectorAll(".ivory-notebook").length, 1);
    assert.equal(rendered.querySelectorAll("script, [onclick], [onerror]").length, 0);
    assert.match(rendered.body.textContent, /일반 영역/);
  } finally {
    editor._tiptapEditor.destroy();
  }
});

test("a notebook nested in an ordered list preserves numbering and its parent on import", () => {
  const editor = BlockNoteEditor.create({ schema: editorSchema, initialContent: [
    { type: "numberedListItem", content: "One" },
    {
      type: "numberedListItem", content: "Two", children: [{
        type: "notebook", children: [{ type: "paragraph", content: "Nested note" }],
      }],
    },
    { type: "numberedListItem", content: "Three" },
  ] });
  try {
    const markdown = serializeEditorMarkdown(editor);
    const rendered = renderBody(markdown);
    assert.equal(rendered.querySelectorAll("body > ol").length, 1);
    assert.equal(rendered.querySelectorAll("body > ol > li").length, 3);
    assert.ok(rendered.querySelector("body > ol > li:nth-child(2) .ivory-notebook"));
    const restored = editor.tryParseMarkdownToBlocks(markdown);
    assert.equal(restored.length, 3);
    assert.equal(restored[1].children[0].type, "notebook");
    assert.equal(restored[1].children[0].children[0].content[0].text, "Nested note");
  } finally {
    editor._tiptapEditor.destroy();
  }
});

test("notebook headings have distinct reader anchors and matching TOC entries", () => {
  const editor = BlockNoteEditor.create({ schema: editorSchema, initialContent: [{
    type: "notebook", children: [
      { type: "heading", props: { level: 2 }, content: "첫 제목" },
      { type: "paragraph", content: "본문" },
      { type: "heading", props: { level: 3 }, content: "다음 제목" },
    ],
  }] });
  try {
    const post = { id: "draft-toc", title: "검사", markdown: serializeEditorMarkdown(editor), path: "" };
    const rendered = new JSDOM(renderToStaticMarkup(createElement(PostReader, {
      post, posts: [post], hash: "#/post/draft-toc",
    }))).window.document;
    const headings = [...rendered.querySelectorAll(".ivory-notebook h2, .ivory-notebook h3")];
    assert.equal(new Set(headings.map((heading) => heading.id)).size, 2);
    const items = [...rendered.querySelectorAll('nav[aria-label="글 목차"] button')];
    assert.deepEqual(items.map((item) => item.textContent), ["첫 제목", "다음 제목"]);
    const lines = post.markdown.split("\n");
    for (const heading of headings) {
      const line = Number(heading.id.replace("heading-", ""));
      assert.ok(lines[line - 1].includes(heading.textContent));
    }
  } finally {
    editor._tiptapEditor.destroy();
  }
});

test("a toggle keeps its notebook and preceding text after Markdown import", () => {
  const editor = BlockNoteEditor.create({ schema: editorSchema, initialContent: [{
    type: "toggleListItem", content: "Parent", children: [
      { type: "paragraph", content: "intro" },
      { type: "notebook", children: [{ type: "paragraph", content: "Nested note" }] },
    ],
  }] });
  try {
    const restored = editor.tryParseMarkdownToBlocks(serializeEditorMarkdown(editor));
    assert.equal(restored[0].type, "toggleListItem");
    assert.equal(restored[0].children[0]?.content[0].text, "intro");
    assert.equal(restored[0].children[1]?.type, "notebook");
    assert.equal(restored[0].children[1]?.children[0].content[0].text, "Nested note");
  } finally {
    editor._tiptapEditor.destroy();
  }
});
