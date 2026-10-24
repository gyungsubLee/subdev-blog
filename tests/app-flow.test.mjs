import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM('<div id="root"></div>', {
  url: "https://blog.example/#/",
  pretendToBeVisual: true,
});
for (const name of [
  "window", "document", "navigator", "Node", "Element", "HTMLElement",
  "MutationObserver", "DOMParser", "DocumentFragment", "Text", "NodeFilter",
]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
  });
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.scrollTo = () => {};
dom.window.matchMedia = () => ({ matches: false });
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.HTMLDialogElement.prototype.close = function () {};
dom.window.HTMLDialogElement.prototype.showModal = function () {};

const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App } = await loadComponent("src/app/App.tsx");

test("App loads summaries then the selected body and handles an invalid index", async () => {
  const nativeFetch = globalThis.fetch;
  const requests = [];
  const contentRequests = () => requests.filter(({ url }) => url.startsWith("/content/")).map(({ url }) => url);
  const pending = new Map();
  globalThis.fetch = (url, options) => {
    requests.push({ url, signal: options.signal });
    return new Promise((resolve) => pending.set(url, resolve));
  };
  let root = createRoot(document.getElementById("root"));
  const post = {
    id: "parent", title: "본문 검사", parentId: null, category: "canonical", categoryId: "canonical",
    createdAt: "2026-10-22T00:00:00.000Z",
    updatedAt: "2026-10-22T00:00:00.000Z",
    markdown: "PREVIEW_ONLY", excerpt: "요약", path: "parent.md", url: "",
    bodyLoaded: false,
  };
  async function respond(url, data) {
    assert.ok(pending.has(url), "expected request: " + url);
    await act(async () => pending.get(url)({ ok: true, json: async () => data }));
    pending.delete(url);
  }
  try {
    await act(async () => root.render(React.createElement(App)));
    assert.match(document.querySelector(".app-state").textContent, /불러오는 중/);
    assert.deepEqual(contentRequests(), ["/content/index.json", "/content/categories.json"]);
    assert.ok(requests.some(({ url }) => url === "/api/session"));
    await respond("/content/categories.json", [{
      id: "canonical", name: "정식 분류", parentId: null,
      order: 0, sources: ["canonical", "개발"],
    }]);
    await respond("/content/index.json", [post]);
    assert.equal(document.querySelectorAll(".home-article-card").length, 1);
    for (const [selector, pageClass] of [
      ['.header-navigation a[href="#/records"]', ".records-page"],
      ['.wordmark', ".blog-intro"],
    ]) {
      const link = document.querySelector(selector);
      assert.ok(link !== null, "expected navigation link: " + selector);
      await act(async () => {
        const changed = once(dom.window, "hashchange");
        link.click();
        await changed;
      });
      assert.ok(document.querySelector(pageClass) !== null);
      assert.deepEqual(contentRequests(), ["/content/index.json", "/content/categories.json"]);
    }
    await act(async () => {
      const changed = once(dom.window, "hashchange");
      dom.window.location.hash = "#/post/parent";
      await changed;
    });
    assert.deepEqual(contentRequests(), [
      "/content/index.json", "/content/categories.json", "/content/posts/parent.json",
    ]);
    assert.equal(document.querySelector(".article-prose").getAttribute("aria-busy"), "true");
    assert.ok(!document.querySelector(".article-prose").textContent.includes("PREVIEW_ONLY"));
    assert.ok([...document.querySelectorAll(".article-actions button")].every((button) => button.disabled));
    await respond("/content/posts/parent.json", {
      ...post, markdown: "# 본문 검사\n\nFULL_BODY", bodyLoaded: true,
    });
    assert.match(document.querySelector(".article-prose").textContent, /FULL_BODY/);
    assert.match(document.querySelector(".breadcrumbs").textContent, /정식 분류/);
    assert.equal(document.querySelector(".article-prose").getAttribute("aria-busy"), "false");
    const actions = [...document.querySelectorAll(".article-actions button")];
    assert.equal(actions.find((button) => button.textContent.includes("내려받기")).disabled, false);
    assert.equal(actions.find((button) => button.textContent.includes("편집하기")).disabled, true);

    await act(async () => root.unmount());
    dom.window.history.replaceState(null, "", "/#/");
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(React.createElement(App)));
    await respond("/content/categories.json", []);
    await respond("/content/index.json", { invalid: true });
    assert.match(document.querySelector('[role="alert"]').textContent, /글 파일 형식/);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});

test("App loads distinct canonical categories sharing a display name", async () => {
  const nativeFetch = globalThis.fetch;
  const categories = [
    { id: "notes-a", name: "Notes", parentId: null, order: 0, sources: ["notes-a"] },
    { id: "notes-b", name: "Notes", parentId: null, order: 1, sources: ["notes-b"] },
  ];
  const posts = categories.map((category, index) => ({
    id: "post-" + index, title: "Post " + index, parentId: null,
    category: category.id, categoryId: category.id,
    createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z",
    markdown: "Body", excerpt: "Summary", path: "post-" + index + ".md", url: "",
  }));
  const responses = new Map([
    ["/content/index.json", posts], ["/content/categories.json", categories],
    ["/api/session", { state: "signed_out" }],
  ]);
  globalThis.fetch = async (url) => {
    assert.ok(responses.has(url), "expected public loader request: " + url);
    return { ok: true, json: async () => responses.get(url) };
  };
  dom.window.history.replaceState(null, "", "/#/records");
  dom.window.localStorage.clear();
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(App)));
    assert.equal(document.querySelector('[role="alert"]')?.textContent ?? "", "");
    assert.deepEqual(
      [...document.querySelectorAll(".post-meta span")].map((node) => node.textContent),
      ["Notes", "Notes"],
    );
    assert.equal(dom.window.localStorage.getItem("second-brain:categories:v2"), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = nativeFetch;
  }
});

after(() => dom.window.close());
