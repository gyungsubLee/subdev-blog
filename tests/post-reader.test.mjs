import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const { default: PostReader } = await loadComponent(
  "src/features/post-reader/PostReader.tsx",
);

function tocLabels(markdown) {
  const post = {
    id: "current",
    title: "Current",
    parentId: null,
    category: "",
    createdAt: "",
    updatedAt: "",
    markdown,
    path: "current.md",
    url: "",
    excerpt: "",
  };
  const html = renderToStaticMarkup(
    createElement(PostReader, { post, posts: [post], hash: "#/post/current" }),
  );
  const document = new JSDOM(html).window.document;
  return [...document.querySelectorAll('nav[aria-label="글 목차"] button')].map(
    (button) => button.textContent,
  );
}

test("TOC labels show semantic HTML heading text without literal tags", () => {
  assert.deepEqual(tocLabels("### <code>평균(mean)</code>"), ["평균(mean)"]);
});

test("TOC labels decode exported punctuation after removing formatting", () => {
  assert.deepEqual(
    tocLabels(
      "### <strong>&#91;모집단&#93; a&#95;b&#42;c&#96; &#45; &#x1F600; &amp; &lt;T&gt; &quot;q&quot; &apos;p&apos;</strong>",
    ),
    ["[모집단] a_b*c` - 😀 & <T> \"q\" 'p'"],
  );
});

test("TOC labels keep existing Markdown emphasis behavior", () => {
  assert.deepEqual(tocLabels("## **굵게** _기울임_ `code`"), [
    "굵게 기울임 code",
  ]);
});

test("TOC labels leave malformed or invalid entities readable without throwing", () => {
  assert.deepEqual(
    tocLabels(
      "### <strong>&#999999999999999999; &#x110000; &#xD800; &#0; &#xZZ; &bogus;</strong>",
    ),
    ["&#999999999999999999; &#x110000; &#xD800; &#0; &#xZZ; &bogus;"],
  );
});
