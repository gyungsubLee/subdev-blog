import { loadComponent } from "../support/load-component.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
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

function render(posts, hash = "#/", categories = [], management) {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { hash } };
  try {
    return renderToStaticMarkup(
      React.createElement(Blog, {
        posts,
        categories,
        management,
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
  assert.ok(!html.includes("Markdown 내려받기"));
  assert.ok(!html.includes("편집하기"));
});

test("article editing requires a ready session and a loaded body", () => {
  for (const state of [undefined, "signed_out", "checking", "blocked", "ready"]) {
    for (const bodyLoaded of [false, true]) {
      const management = state ? {
        session: { state }, refresh() {}, logout() {},
      } : undefined;
      const dom = new JSDOM(render([{ ...base, bodyLoaded }], "#/post/parent", [], management));
      try {
        const buttons = [...dom.window.document.querySelectorAll(".article-topline button")];
        assert.equal(buttons.length, state === "ready" ? 1 : 0, `Edit visibility for ${state}`);
        if (state === "ready") {
          assert.equal(buttons[0].textContent.trim(), "편집하기");
          assert.equal(buttons[0].disabled, !bodyLoaded);
        }
        assert.ok(!dom.window.document.querySelector(".article-topline").textContent.includes("Markdown 내려받기"));
      } finally {
        dom.window.close();
      }
    }
  }
});

test("home shows article sections and keeps browser drafts in records", () => {
  const published = { ...base, id: "published" };
  const draft = { ...base, id: "draft", draft: true };
  const home = new JSDOM(render([draft, published]));
  try {
    assert.ok(home.window.document.querySelector("#latest-articles-title"));
    assert.ok(home.window.document.querySelector("#popular-articles-title"));
    assert.equal(home.window.document.querySelector('input[type="search"]'), null);
    assert.equal(home.window.document.querySelector('main a[href="#/post/draft"]'), null);
    assert.match(render([draft, published], "#/records"), /이 브라우저의 초안|초안/);
  } finally {
    home.window.close();
  }
});

test("header separates records and category routes while the wordmark opens home", () => {
  for (const [hash, pageClass, currentHref] of [
    ["#/", ".blog-intro", null],
    ["#/records", ".records-page", "#/records"],
    ["#/categories", ".categories-page", "#/categories"],
  ]) {
    const dom = new JSDOM(render([base], hash));
    const document = dom.window.document;
    assert.ok(document.querySelector(pageClass), "expected page at " + hash);
    assert.equal(document.querySelector(".wordmark").getAttribute("href"), "#/");
    assert.deepEqual(
      [...document.querySelectorAll(".header-navigation a")].map((link) => [
        link.textContent.trim(), link.getAttribute("href"),
      ]),
      [["기록 관리", "#/records"], ["카테고리 관리", "#/categories"]],
    );
    assert.equal(
      document.querySelector('.header-navigation [aria-current="page"]')?.getAttribute("href") ?? null,
      currentHref,
    );
    assert.ok(!document.querySelector(".header-navigation").textContent.includes("메인"));
    if (hash !== "#/") assert.equal(document.querySelector(".blog-intro"), null);
    dom.window.close();
  }
});

test("direct article entry returns to home", () => {
  const dom = new JSDOM(render([base], "#/post/parent"));
  assert.equal(dom.window.document.querySelector(".back-link").getAttribute("href"), "#/");
  dom.window.close();
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

test("page exploration controls and dialog are absent", () => {
  for (const hash of ["#/", "#/records", "#/post/parent", "#/categories"]) {
    const dom = new JSDOM(render([base], hash));
    try {
      const controls = [...dom.window.document.querySelectorAll("nav a, nav button")];
      assert.equal(controls.some((control) => control.textContent.includes("페이지 탐색")), false);
      assert.ok(dom.window.document.querySelector(".site-dialog") === null);
      assert.ok(dom.window.document.querySelector(".page-tree") === null);
      assert.ok(dom.window.document.querySelector('a[href="#/records"]') !== null);
    } finally {
      dom.window.close();
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

test("reader resolves category labels by canonical ID", () => {
  const id = "12345678-1234-8234-9234-123456789012";
  const post = { ...base, id, category: "canonical-id", categoryId: "canonical-id" };
  const html = render([post], "#/post/" + id, [
    { id: "canonical-id", name: "Readable category", parentId: null, order: 0, sources: ["canonical-id"] },
  ]);
  assert.match(html, /Readable category/);
  assert.doesNotMatch(new JSDOM(html).window.document.querySelector(".breadcrumbs").textContent, /canonical-id/);
});

test("reader classifies attachment URLs before resolving article IDs", async () => {
  const id = "12345678-1234-8234-9234-123456789012";
  const post = { ...base, id };
  const { pageLink } = await loadComponent("app/web/src/features/post-reader/page-links.ts");
  for (const href of [
    `/content/assets/${id}/첨부.pdf#page=2`,
    `https://example.com/files/${id}.pdf`,
    `/notion/assets/${id}.pdf`,
    `../${id}/attachment.pdf`,
    `https://notion.so/files/${id}.pdf`,
  ]) assert.equal(pageLink(href, post, [post]), href);
  assert.equal(pageLink(`https://www.notion.so/Title-${id.replaceAll("-", "")}#block`, post, [post]), "#/post/" + id + "#block");
  assert.equal(pageLink("#heading", post, [post]), "#heading");
  assert.equal(pageLink("#/post/" + id + "#block", post, [post]), "#/post/" + id + "#block");
});

test("reader resolves literal percent paths before UUIDs in ancestor folder names", async () => {
  const { pageLink } = await loadComponent("app/web/src/features/post-reader/page-links.ts");
  const id = "12345678-1234-8234-9234-123456789012";
  const current = { ...base, path: `Root ${id}/100% notes/Current.md` };
  const target = { ...base, id: "child", path: `Root ${id}/100% notes/Child.md` };
  const ancestor = { ...base, id };
  assert.equal(pageLink("Child.md#section", current, [ancestor, target]), "#/post/child#section");
  assert.equal(pageLink(`../Other%2520name.md`, { ...current, path: "Root/Sub/Current.md" }, [
    { ...target, path: "Root/Other%20name.md" },
  ]), "#/post/child");
});
