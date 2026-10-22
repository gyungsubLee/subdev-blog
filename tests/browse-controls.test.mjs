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

test("search, category and visible count compose and survive article navigation", async () => {
  const root = createRoot(document.getElementById("root"));
  const posts = Array.from({ length: 36 }, (_, index) => ({
    id: "p" + index,
    title: "공통 기록 " + index,
    parentId: null,
    category: index < 24 ? "개발" : "일상",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    markdown: index === 20 ? "본문전용 단어" : "기록 본문",
    excerpt: index === 0 ? "TypeScript 요약" : "기록 요약",
    path: "p" + index + ".md",
    url: "",
  }));
  const cards = () => document.querySelectorAll(".post-grid .post-card").length;
  const button = (text) => [...document.querySelectorAll("button")].find(
    (element) => element.textContent.trim().startsWith(text),
  );
  async function click(element) {
    await act(async () => element.click());
  }
  async function search(value) {
    const input = document.querySelector('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")
        .set.call(input, value);
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
  }
  async function navigate(anchor) {
    await act(async () => {
      const changed = once(dom.window, "hashchange");
      anchor.click();
      await changed;
    });
  }
  try {
    await act(async () => root.render(React.createElement(Blog, {
      posts, onWrite() {}, onEdit() {},
    })));
    assert.equal(cards(), 12);
    await click(button("더 보기"));
    assert.equal(cards(), 24);
    await click(button("개발"));
    assert.equal(cards(), 12, "category change resets the visible count");
    assert.match(document.querySelector(".result-count").textContent, /24개의 기록/);
    await click(button("더 보기"));
    assert.equal(cards(), 24);
    await search("공통");
    assert.equal(cards(), 12, "search change resets the visible count");
    await click(button("더 보기"));
    assert.equal(cards(), 24);
    await navigate(document.querySelector(".post-card"));
    assert.equal(document.querySelector(".article-header h1").textContent, "공통 기록 0");
    await navigate(document.querySelector(".back-link"));
    assert.equal(document.querySelector('input[type="search"]').value, "공통");
    assert.equal(button("개발").getAttribute("aria-pressed"), "true");
    assert.equal(cards(), 24, "article roundtrip preserves the visible count");
    const input = document.querySelector('input[type="search"]');
    input.focus();
    await act(async () => input.dispatchEvent(new dom.window.KeyboardEvent(
      "keydown", { key: "Escape", bubbles: true },
    )));
    assert.equal(input.value, "");
    assert.equal(cards(), 24, "Escape clears search without resetting the visible count");
    assert.notEqual(document.activeElement, input);
    await search("본문전용");
    assert.equal(cards(), 1, "search includes article Markdown");
    await search("  typescript  ");
    assert.equal(cards(), 1, "search trims and ignores case in excerpts");
    await search("일치하지않는검색어");
    assert.equal(cards(), 0);
    assert.ok(document.querySelector(".empty-results"));
    await click(button("전체 글 보기"));
    assert.equal(document.querySelector('input[type="search"]').value, "");
    assert.equal(button("전체").getAttribute("aria-pressed"), "true");
    assert.equal(cards(), 12);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
  }
});
