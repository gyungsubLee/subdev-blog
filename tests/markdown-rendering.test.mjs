import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const { default: MarkdownContent } = await loadComponent(
  "src/features/post-reader/MarkdownContent.tsx",
);
const post = {
  id: "current",
  title: "Current",
  parentId: null,
  category: "",
  createdAt: "",
  updatedAt: "",
  markdown: "",
  path: "current.md",
  url: "",
  excerpt: "",
};

function render(body) {
  return new JSDOM(
    renderToStaticMarkup(
      createElement(MarkdownContent, { body, post, posts: [post] }),
    ),
  ).window.document;
}

test("underlined Notion text retains its semantic underline", () => {
  const document = render("A <u>marked phrase</u>.");
  assert.equal(document.querySelector("u")?.textContent, "marked phrase");
});

test("toggle summaries preserve nested semantic formatting and safe links", () => {
  const document = render(
    '<details><summary><strong>Bold <em>italic</em></strong> <u>underline</u> <del>deleted</del> <code>a_b*c</code> <a href="https://example.com/guide">guide</a></summary><p>Body</p></details>',
  );
  const summary = document.querySelector("details > summary");
  assert.equal(summary.querySelector("strong > em")?.textContent, "italic");
  assert.equal(summary.querySelector("u")?.textContent, "underline");
  assert.equal(summary.querySelector("del")?.textContent, "deleted");
  assert.equal(summary.querySelector("code")?.textContent, "a_b*c");
  const link = summary.querySelector("a");
  assert.equal(link?.getAttribute("href"), "https://example.com/guide");
  assert.equal(link?.getAttribute("target"), "_blank");
  assert.equal(link?.getAttribute("rel"), "noreferrer");
});

test("inline Markdown formulas render accessible math beside surrounding text", () => {
  const document = render(String.raw`Before $x^2 + y^2$ after.`);
  assert.equal(document.querySelectorAll(".katex").length, 1);
  assert.equal(document.querySelector(".katex-display"), null);
  assert.equal(document.querySelector("math annotation")?.textContent, "x^2 + y^2");
  assert.match(document.body.textContent, /^Before .* after\.$/);
});

test("block Markdown formulas render display math outside code blocks", () => {
  const document = render("$$\n\\frac{1}{2}\n$$");
  assert.equal(document.querySelectorAll(".katex-display .katex").length, 1);
  assert.equal(document.querySelector("math annotation")?.textContent, "\\frac{1}{2}");
  assert.equal(document.querySelector(".article-code"), null);
});

test("formulas exported inside an HTML summary render inline", () => {
  const document = render(
    '<details><summary>Formula <code class="language-math">x^2</code></summary><p>Body</p></details>',
  );
  assert.equal(document.querySelectorAll("summary .katex").length, 1);
  assert.equal(document.querySelector("summary .katex-display"), null);
});

test("table inline code preserves explicit line breaks and literal punctuation", () => {
  const document = render("| Code |\n| --- |\n| <code>a_b<br>c*d</code> |");
  const code = document.querySelector(".table-scroll td code");
  assert.equal(code?.innerHTML, "a_b<br>c*d");
  assert.equal(code?.querySelectorAll("br").length, 1);
});

test("untrusted HTML and URLs remain sanitized while safe content survives", () => {
  const document = render(
    '<script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>\n\n<u style="color:red" onclick="alert(1)">safe</u> <a href="javascript:alert(1)">bad link</a> <img src="javascript:alert(1)" onerror="alert(1)" alt="missing"> <svg onload="alert(1)"></svg> <span class="katex" style="position:fixed">text</span>',
  );
  assert.equal(
    document.querySelector(
      "script, iframe, svg, [onclick], [onerror], [onload], [style], .katex",
    ),
    null,
  );
  assert.equal(document.querySelector("a")?.hasAttribute("href"), false);
  assert.equal(document.querySelector("img"), null);
  assert.equal(document.querySelector(".missing-image")?.textContent, "missing");
  assert.match(document.body.textContent, /safe/);
});

test("math rendering does not trust URL or HTML macros", () => {
  const document = render(
    String.raw`$\href{javascript:alert(1)}{click}$ $\htmlStyle{color:red}{text}$`,
  );
  assert.equal(document.querySelector("a, .enclosing"), null);
  assert.equal(document.querySelectorAll(".katex").length, 2);
});
