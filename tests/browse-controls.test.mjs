import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM('<div id="root"></div>', {
  url: "https://blog.example/#/",
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

test("home leaves browsing controls and search shortcuts to records", async () => {
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
  async function click(element) {
    assert.ok(element, "expected control");
    await act(async () => element.click());
  }
  async function navigate(anchor) {
    assert.ok(anchor, "expected route link");
    await act(async () => {
      const changed = once(dom.window, "hashchange");
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
  function assertHomeControls() {
    const main = document.querySelector("main");
    assert.ok(!main.querySelector("input"), "home has no search field");
    assert.ok(!main.querySelector('[aria-label="카테고리"]'));
    assert.ok(!main.querySelector(".load-more"));
    assert.equal(searchShortcut(), true, "home does not intercept the search shortcut");
  }
  try {
    await act(async () => root.render(React.createElement(Blog, {
      posts, onWrite() {}, onEdit() {},
    })));
    assertHomeControls();
    await navigate(document.querySelector('.header-navigation a[href="#/records"]'));
    assert.ok(document.querySelector(".records-page"));
    assert.ok(document.querySelector('input[type="search"]'));
    assert.ok(document.querySelector('.records-sidebar[aria-label="카테고리"]'));
    assert.equal(searchShortcut(), false);
    assert.ok(
      document.activeElement === document.querySelector('input[type="search"]'),
      "the search shortcut focuses the search field",
    );
    assert.equal(cards(), 12);
    await click(document.querySelector(".load-more button"));
    assert.equal(cards(), 24);
    await click(document.querySelector('button[aria-label="리액트"]'));
    assert.equal(document.querySelector('button[aria-label="리액트"]').getAttribute("aria-pressed"), "true");
    assert.equal(cards(), 12, "records category selection resets pagination");
    await navigate(document.querySelector(".wordmark"));
    assertHomeControls();
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
