import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const { default: MarkdownContent } = await loadComponent(
  "src/features/post-reader/MarkdownContent.tsx",
);
const post = { id: "current", path: "current.md" };

function render(t, markdown, current = post) {
  const dom = new JSDOM(
    renderToStaticMarkup(
      createElement(MarkdownContent, {
        body: markdown,
        post: current,
        posts: [current],
      }),
    ),
  );
  t.after(() => dom.window.close());
  return dom.window.document;
}

test("fragment TOC quotes gain presentation styling without flattening nested lists", (t) => {
  const document = render(
    t,
    '> <a id="toc-label"></a>\n>\n> **목차**\n>\n> - [Parent](#parent)\n>   - [Child](#child)',
  );
  const toc = document.querySelector("blockquote.article-toc");
  assert.ok(toc, "The exported TOC quote needs its presentation class");
  assert.equal(toc.querySelectorAll("ul li").length, 2);
  assert.equal(toc.querySelector("ul ul a")?.getAttribute("href"), "#child");
  assert.ok(toc.querySelector("a#user-content-toc-label"));
});

test("a 목차 quote with nonfragment or route links keeps ordinary quote styling", (t) => {
  for (const destination of [
    "https://example.com/guide#section",
    "other.md#section",
    "#/post/other",
  ]) {
    const document = render(
      t,
      "> **목차**\n>\n> - [Local](#section)\n> - [Other](" + destination + ")",
    );
    assert.equal(document.querySelector(".article-toc"), null, destination);
    assert.equal(document.querySelectorAll("blockquote li").length, 2);
  }
});

test("ordinary quote lists require the first meaningful paragraph to be 목차", (t) => {
  const document = render(
    t,
    "> 설명\n>\n> **목차**\n>\n> - [Section](#section)",
  );
  assert.equal(document.querySelector(".article-toc"), null);
  assert.equal(document.querySelector("blockquote li a")?.textContent, "Section");
});

test("a 목차 paragraph without linked list items remains an ordinary quote", (t) => {
  const document = render(t, "> **목차**\n>\n> - plain item");
  assert.equal(document.querySelector(".article-toc"), null);
});

test("mixed TOC and ordinary nested quotes retain normal list presentation", (t) => {
  const document = render(
    t,
    "> 목차\n>\n> - [Section](#section)\n>\n> > Note\n> >\n> > - Parent\n> >   - Child",
  );
  assert.equal(document.querySelector(".article-toc"), null);
  assert.equal(document.querySelectorAll("blockquote blockquote li").length, 2);
  assert.equal(
    document.querySelector("blockquote blockquote ul ul li")?.textContent,
    "Child",
  );
});

test("authored quote anchors remain reachable after applying reader styling", (t) => {
  const document = render(
    t,
    '<blockquote id="note"><p>Note</p></blockquote>\n\n[Jump](#note)',
  );
  assert.ok(document.querySelector("blockquote#user-content-note"));
  assert.equal(document.querySelector('a[href="#note"]')?.textContent, "Jump");
});

test("the actual statistics TOC preserves every original fragment target", async (t) => {
  const posts = JSON.parse(
    await readFile(new URL("../content/posts.json", import.meta.url), "utf8"),
  );
  const current = posts.find(
    (entry) => entry.id === "3f2eda9b-0fe1-80db-84ad-c844a2eb9f9f",
  );
  assert.ok(current);
  const document = render(t, current.markdown, current);
  const toc = document.querySelector("blockquote.article-toc");
  assert.ok(toc);
  assert.equal(document.querySelectorAll(".article-toc").length, 1);
  const links = [...toc.querySelectorAll("li a")];
  assert.equal(links.length, 6);
  for (const link of links) {
    const fragment = link.getAttribute("href").slice(1);
    assert.ok(
      document.getElementById("user-content-" + fragment),
      "The original TOC target must remain: " + fragment,
    );
  }
  assert.equal(document.querySelectorAll("blockquote:not(.article-toc)").length, 7);
});
