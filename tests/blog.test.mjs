import { loadComponent } from "./support/load-component.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { once } from "node:events";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";

const { default: Blog } = await loadComponent("tests/support/BlogHarness.tsx");

const base = {
  id: "parent",
  title: "테스트 글",
  parentId: null,
  category: "개발",
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  markdown: "본문",
  path: "Main/notes.md",
  url: "https://example.com/original",
  excerpt: "요약",
};

function render(posts, hash = "#/") {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { hash } };
  try {
    return renderToStaticMarkup(
      React.createElement(Blog, {
        posts,
        onWrite() {},
        onEdit() {},
      }),
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test("article preserves local page links and removes executable HTML", () => {
  const image = "data:image/png;base64,iVBORw0KGgo=";
  const post = {
    ...base,
    markdown:
      '# 제목\n\n[다음](sub/child.md#section)\n\n<script>globalThis.pwned=true</script>\n\n<img src="' +
      image +
      '" onerror="alert(1)" />\n\n[위험](javascript:alert(1))\n\n<img src="data:image/svg+xml;base64,PHN2Zz4=" />',
  };
  const child = {
    ...base,
    id: "child",
    parentId: "parent",
    path: "Main/sub/child.md",
    title: "자식 글",
  };
  const html = render([post, child], "#/post/parent");
  assert.match(html, /href="#\/post\/child#section"/);
  assert.match(html, /id="heading-1"/);
  assert.ok(html.includes(image));
  assert.ok(!html.includes("globalThis.pwned"));
  assert.ok(!html.includes("onerror"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("data:image/svg"));
});

test("loading article never renders or exports its preview body", () => {
  const html = render(
    [{ ...base, markdown: "PRIVATE_PREVIEW_MARKER", bodyLoaded: false }],
    "#/post/parent",
  );
  assert.match(html, /aria-busy="true"/);
  assert.ok(!html.includes("PRIVATE_PREVIEW_MARKER"));
  assert.match(html, /disabled=""[^>]*>Markdown 내려받기/);
  assert.match(html, /disabled=""[^>]*>편집하기/);
});

test("home marks browser drafts and has a labelled search", () => {
  const html = render([{ ...base, draft: true }]);
  assert.match(html, /이 브라우저의 초안|초안/);
  assert.match(html, /제목과 요약 검색/);
  assert.match(html, /모든 기록/);
  assert.match(html, /type="search"/);
});

test("block and heading anchors stay on the current article route", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    {
      url: "https://blog.example/#/post/parent",
      pretendToBeVisual: true,
    },
  );
  const previous = Object.fromEntries(
    [
      "window",
      "document",
      "navigator",
      "HTMLElement",
      "IS_REACT_ACT_ENVIRONMENT",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const scrolled = [];
  dom.window.HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this.id);
  };
  dom.window.HTMLDialogElement.prototype.close = function () {};
  dom.window.HTMLDialogElement.prototype.showModal = function () {};
  dom.window.matchMedia = () => ({ matches: false });
  dom.window.scrollTo = () => {};
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    const post = {
      ...base,
      markdown:
        '[블록](#abc123)\n\n[제목](#한글-제목)\n\n<a id="abc123"></a>\n\n## 한글 제목',
    };
    await act(async () =>
      root.render(
        React.createElement(Blog, { posts: [post], onWrite() {}, onEdit() {} }),
      ),
    );
    const block = dom.window.document.querySelector(
      '.article-prose a[href="#abc123"]',
    );
    const heading =
      dom.window.document.querySelector(
        '.article-prose a[href="#%ED%95%9C%EA%B8%80-%EC%A0%9C%EB%AA%A9"]',
      ) ||
      [...dom.window.document.querySelectorAll(".article-prose a")].find(
        (anchor) => anchor.textContent === "제목",
      );
    assert.ok(block);
    assert.ok(heading);
    assert.equal(
      block.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
      false,
    );
    assert.equal(
      heading.dispatchEvent(
        new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }),
      ),
      false,
    );
    assert.equal(dom.window.location.hash, "#/post/parent");
    assert.ok(scrolled.includes("user-content-abc123"));
    assert.ok(scrolled.some((id) => id.startsWith("heading-")));
    scrolled.length = 0;
    await act(async () => {
      dom.window.location.hash = "#/post/parent#abc123";
      dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
      root.render(
        React.createElement(Blog, {
          posts: [{ ...post, bodyLoaded: false }],
          onWrite() {},
          onEdit() {},
        }),
      );
    });
    assert.equal(scrolled.length, 0);
    await act(async () =>
      root.render(
        React.createElement(Blog, {
          posts: [{ ...post, bodyLoaded: true }],
          onWrite() {},
          onEdit() {},
        }),
      ),
    );
    await act(
      async () => new Promise((resolve) => dom.window.setTimeout(resolve, 40)),
    );
    assert.ok(scrolled.includes("user-content-abc123"));
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("body-only Markdown keeps text between two horizontal rules", () => {
  const html = render(
    [
      {
        ...base,
        markdown: "---\n구분선 사이의 원문입니다.\n---\n\n뒤쪽 본문입니다.",
      },
    ],
    "#/post/parent",
  );
  assert.ok(html.includes("구분선 사이의 원문입니다."));
  assert.ok(html.includes("뒤쪽 본문입니다."));
});

test("large page tree only mounts expanded branches and keeps title links", async () => {
  const dom = new JSDOM(
    '<!doctype html><html><body><div id="root"></div></body></html>',
    {
      url: "https://blog.example/#/",
      pretendToBeVisual: true,
    },
  );
  const previous = Object.fromEntries(
    ["window", "document", "HTMLElement", "IS_REACT_ACT_ENVIRONMENT"].map(
      (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)],
    ),
  );
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.scrollTo = () => {};
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  }))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  const posts = Array.from({ length: 3032 }, (_, index) => ({
    ...base,
    id: "p" + index,
    title: "계층 페이지 " + index,
    parentId: index ? "p" + Math.floor((index - 1) / 5) : null,
    path: "p" + index + ".md",
  }));
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () =>
      root.render(
        React.createElement(Blog, { posts, onWrite() {}, onEdit() {} }),
      ),
    );
    const explore = [
      ...document.querySelectorAll(".header-navigation button"),
    ].find((button) => button.textContent === "페이지 탐색");
    await act(async () => explore.click());
    assert.equal(document.querySelectorAll(".page-tree li").length, 6);
    assert.equal(
      document.querySelectorAll(".page-tree details[open]").length,
      1,
    );
    const branch = document
      .querySelector('.page-tree a[href="#/post/p1"]')
      .closest("details");
    await act(async () => {
      const toggled = once(branch, "toggle");
      branch.querySelector("summary").click();
      await toggled;
    });
    assert.equal(document.querySelectorAll(".page-tree li").length, 11);
    assert.equal(branch.open, true);
    await act(async () => {
      const toggled = once(branch, "toggle");
      branch.querySelector("summary").click();
      await toggled;
    });
    assert.equal(document.querySelectorAll(".page-tree li").length, 6);
    assert.equal(branch.open, false);
    await act(async () => {
      // The URL changes before JSDOM dispatches the event that updates React.
      const navigated = once(dom.window, "hashchange");
      branch.querySelector('a[href="#/post/p1"]').click();
      await navigated;
    });
    assert.equal(dom.window.location.hash, "#/post/p1");
    assert.equal(
      document.querySelector(".article-header h1").textContent,
      "계층 페이지 1",
    );
    assert.equal(document.querySelector(".site-dialog").open, false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test("original cover has priority over the first body image", () => {
  const html = render([
    {
      ...base,
      cover: "/notion/assets/original-cover.webp",
      markdown: "![본문 그림](/notion/assets/body-image.webp)",
    },
  ]);
  assert.match(html, /src="\/notion\/assets\/original-cover\.webp"/);
  assert.ok(!html.includes("/notion/assets/body-image.webp"));
});
