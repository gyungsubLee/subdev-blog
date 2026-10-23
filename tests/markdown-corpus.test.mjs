import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const posts = JSON.parse(
  await readFile(new URL("../content/posts.json", import.meta.url), "utf8"),
);
const { default: MarkdownContent } = await loadComponent(
  "src/features/post-reader/MarkdownContent.tsx",
);

function renderPost(id) {
  const post = posts.find((entry) => entry.id === id);
  assert.ok(post, "Archived article must exist: " + id);
  return new JSDOM(
    renderToStaticMarkup(
      React.createElement(MarkdownContent, {
        body: post.markdown,
        post,
        posts,
      }),
    ),
  );
}

test("archived statistics article preserves combined emphasis and inline equations", () => {
  const dom = renderPost("3f2eda9b-0fe1-80db-84ad-c844a2eb9f9f");
  const document = dom.window.document;
  assert.ok(
    [...document.querySelectorAll("strong")].some(
      (element) => element.textContent === "기본",
    ),
    "Notion bold must survive the following Korean suffix",
  );
  assert.ok(
    [...document.querySelectorAll("u")].some(
      (element) => element.textContent === "기본",
    ),
    "Notion underline must remain visible",
  );
  assert.ok(document.querySelector(".katex"), "Inline equations must render");
  assert.ok(document.querySelector("img"), "Existing equation images must remain");
  dom.window.close();
});

test("archived reinforcement article preserves bold ending in parentheses", () => {
  const dom = renderPost("340eda9b-0fe1-805d-bdc1-f3398c2eaf4e");
  assert.ok(
    [...dom.window.document.querySelectorAll("strong")].some(
      (element) => element.textContent === "확률변수(random variable)",
    ),
    "Punctuation before a Korean suffix must not expose Markdown delimiters",
  );
  dom.window.close();
});

test("archived Spring toggle title renders bold rather than literal markers", () => {
  const dom = renderPost("1c3eda9b-0fe1-81ae-909e-cd1f71740107");
  const summary = [...dom.window.document.querySelectorAll("summary")].find(
    (element) => element.textContent.includes("시작 전"),
  );
  assert.ok(summary);
  assert.equal(summary.textContent, "시작 전");
  assert.equal(summary.querySelector("strong")?.textContent, "시작 전");
  dom.window.close();
});

test("archived generic table preserves adjacent code runs without added backticks", () => {
  const dom = renderPost("1c3eda9b-0fe1-81c5-bd64-e851c8bea51f");
  const cells = [...dom.window.document.querySelectorAll("td")];
  const typeCell = cells.find((element) => element.textContent.trim() === "List<T>");
  assert.ok(typeCell, "The table must contain the original generic type");
  assert.equal(
    typeCell.querySelectorAll("code").length,
    1,
    "One source code expression must use one continuous code background",
  );
  assert.ok(
    !cells.some((element) => element.textContent.includes("List<``T``>")),
    "Separate Notion code runs must not add delimiter text",
  );
  dom.window.close();
});

test("archived transaction table renders code line breaks instead of br text", () => {
  const dom = renderPost("27deda9b-0fe1-80a8-9ce6-e40aa81c398c");
  const code = [...dom.window.document.querySelectorAll("td code")].find(
    (element) =>
      element.parentElement.textContent.includes("Read") &&
      element.parentElement.textContent.includes("Uncommitted"),
  );
  assert.ok(code, "The isolation level must remain in the table");
  assert.ok(code.querySelector("br"), "The original newline must remain visible");
  assert.ok(!code.textContent.includes("<br>"));
  dom.window.close();
});
