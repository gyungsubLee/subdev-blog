import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM('<div id="root"></div>', {
  url: "https://blog.example/#/records",
  pretendToBeVisual: true,
});
for (const name of ["window", "document", "navigator", "HTMLElement"]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.scrollTo = () => {};
dom.window.matchMedia = () => ({ matches: false });
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };

const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Blog } = await loadComponent("tests/support/BlogHarness.tsx");

test("records filters and visible count survive article and home roundtrips", { timeout: 15_000 }, async () => {
  const root = createRoot(document.getElementById("root"));
  const posts = Array.from({ length: 36 }, (_, index) => ({
    id: "p" + index,
    title: "공통 기록 " + index,
    parentId: null,
    category: index < 24 ? "리액트" : "Docker",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    markdown: "기록 본문",
    excerpt: "기록 요약",
    path: "p" + index + ".md",
    url: "",
  }));
  const cards = () => document.querySelectorAll(".post-grid .post-card").length;
  const button = (text) => [...document.querySelectorAll("button")].find(
    (element) => element.textContent.trim().startsWith(text),
  );
  async function click(element) {
    assert.ok(element, "expected control");
    await act(async () => element.click());
  }
  async function navigate(anchor) {
    assert.ok(anchor, "expected route link");
    await act(async () => {
      const changed = once(dom.window, "hashchange", { signal: AbortSignal.timeout(5_000) });
      anchor.click();
      await changed;
    });
  }
  function searchShortcut() {
    const main = document.querySelector("main");
    main.focus();
    return main.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
      key: "/", bubbles: true, cancelable: true,
    }));
  }
  try {
    await act(async () => root.render(React.createElement(Blog, {
      posts, onWrite() {}, onEdit() {},
    })));
    assert.ok(document.querySelector(".records-page"));
    assert.equal(document.title, "기록 — Second Brain");
    assert.equal(searchShortcut(), false);
    assert.ok(
      document.activeElement === document.querySelector('input[type="search"]'),
      "the search shortcut focuses the search field",
    );
    await click(button("프론트엔드"));
    await click(document.querySelector('button[aria-label="리액트"]'));
    const input = document.querySelector('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")
        .set.call(input, "공통");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await click(button("더 보기"));
    assert.equal(cards(), 24);
    await navigate(document.querySelector(".post-card"));
    assert.equal(document.querySelector(".back-link").getAttribute("href"), "#/records");
    assert.equal(document.querySelector(".article-header h1").textContent, "공통 기록 0");
    assert.equal(searchShortcut(), true, "article disables list search shortcuts");
    await navigate(document.querySelector(".back-link"));
    assert.equal(document.querySelector('input[type="search"]').value, "공통");
    assert.equal(document.querySelector('button[aria-label="리액트"]').getAttribute("aria-pressed"), "true");
    assert.equal(cards(), 24);

    await click(button("페이지 탐색"));
    assert.equal(document.querySelector(".site-dialog").open, true);
    assert.equal(searchShortcut(), true, "an open dialog disables list search shortcuts");
    await click(document.querySelector('[aria-label="창 닫기"]'));
    assert.equal(searchShortcut(), false);
    await navigate(document.querySelector('.header-navigation a[href="#/categories"]'));
    assert.ok(document.querySelector(".categories-page"));
    assert.equal(document.title, "카테고리 관리 — Second Brain");
    assert.equal(searchShortcut(), true, "category manager has no list search shortcut");
    await navigate(document.querySelector(".wordmark"));
    assert.ok(document.querySelector(".blog-intro"));
    assert.ok(!document.querySelector('input[type="search"]'));
    assert.equal(searchShortcut(), true, "home has no list search shortcut");
    await navigate(document.querySelector(".home-article-card"));
    assert.equal(document.querySelector(".back-link").getAttribute("href"), "#/");
    await navigate(document.querySelector(".back-link"));
    await navigate(document.querySelector('.header-navigation a[href="#/records"]'));
    assert.equal(document.querySelector('input[type="search"]').value, "공통");
    assert.equal(document.querySelector('button[aria-label="리액트"]').getAttribute("aria-pressed"), "true");
    assert.equal(cards(), 24);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
