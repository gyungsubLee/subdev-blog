import { bulkResponse } from '../support/bulk-response.mjs';
import assert from "node:assert/strict";
import { once } from "node:events";
import test, { after, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "../support/load-component.mjs";

const dom = new JSDOM('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content"><div id="root"></div>', {
  url: "https://blog.example/#/",
  pretendToBeVisual: true,
});
for (const name of [
  "window", "document", "navigator", "Node", "Element", "HTMLElement",
  "MutationObserver", "DOMParser", "DocumentFragment", "Text", "NodeFilter",
  "HTMLDivElement", "HTMLParagraphElement", "HTMLInputElement", "HTMLAnchorElement",
  "DOMRect", "Range", "KeyboardEvent", "InputEvent", "MouseEvent", "Event",
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
dom.window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.ResizeObserver = dom.window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IntersectionObserver = dom.window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.Element.prototype.getBoundingClientRect = () => new dom.window.DOMRect(0, 0, 100, 30);
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
dom.window.Range.prototype.getClientRects = () => [];
dom.window.document.elementFromPoint = () => dom.window.document.body;
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.HTMLDialogElement.prototype.close = function () {};
dom.window.HTMLDialogElement.prototype.showModal = function () {};

beforeEach(()=>localStorage.clear());
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App } = await loadComponent("app/web/src/site/App.tsx");

test("App loads summaries then the selected body and handles an invalid index", async () => {
  const nativeFetch = globalThis.fetch;
  const requests = [];
  const contentRequests = () => requests.filter(({ url }) => url.startsWith("/api/public?")).map(({ url }) => url);
  const pending = new Map();
  globalThis.fetch = (url, options) => {
    requests.push({ url, signal: options?.signal });
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
    assert.deepEqual(contentRequests(), ["/api/public?kind=index"]);
    assert.ok(requests.some(({ url }) => url === "/api/session"));
    await respond("/api/public?kind=index", { posts: [post], categories: [{
      id: "canonical", name: "정식 분류", parentId: null,
      order: 0, sources: ["canonical", "개발"],
    }], contentCommit: "a".repeat(40) });
    assert.equal(document.querySelectorAll(".home-article-card").length, 1);
    for (const [selector, pageClass] of [
      ['.header-navigation a[href="#/records"]', ".records-page"],
      ['.wordmark', ".blog-intro"],
    ]) {
      const link = document.querySelector(selector);
      assert.ok(link !== null, "expected navigation link: " + selector);
      await act(async () => {
        const changed = once(dom.window, "hashchange", { signal: AbortSignal.timeout(2000) });
        link.click();
        await changed;
      });
      assert.ok(document.querySelector(pageClass) !== null);
      assert.deepEqual(contentRequests(), ["/api/public?kind=index"]);
    }
    await act(async () => {
      const changed = once(dom.window, "hashchange", { signal: AbortSignal.timeout(2000) });
      dom.window.location.hash = "#/post/parent";
      await changed;
    });
    assert.deepEqual(contentRequests(), [
      "/api/public?kind=index", "/api/public?kind=post&id=parent&commit=" + "a".repeat(40),
    ]);
    assert.equal(document.querySelector(".article-prose").getAttribute("aria-busy"), "true");
    assert.ok(!document.querySelector(".article-prose").textContent.includes("PREVIEW_ONLY"));
    assert.ok(document.querySelector(".article-edit") === null);
    await respond("/api/public?kind=post&id=parent&commit=" + "a".repeat(40), {
      ...post, markdown: "# 본문 검사\n\nFULL_BODY", bodyLoaded: true,
    });
    assert.match(document.querySelector(".article-prose").textContent, /FULL_BODY/);
    assert.match(document.querySelector(".breadcrumbs").textContent, /정식 분류/);
    assert.equal(document.querySelector(".article-prose").getAttribute("aria-busy"), "false");
    assert.ok(document.querySelector(".article-edit") === null);
    await respond("/api/session", readySession);
    const editButton = document.querySelector(".article-edit");
    assert.ok(editButton !== null, "Verified authentication must reveal article editing");
    assert.equal(editButton.disabled, false);
    await act(async () => document.querySelector(".header-logout").click());
    await respond("/api/logout", {});
    assert.ok(document.querySelector(".article-edit") === null, "Signing out must hide article editing");

    await act(async () => root.unmount());
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    localStorage.clear();
    dom.window.history.replaceState(null, "", "/#/");
    root = createRoot(document.getElementById("root"));
    await act(async () => root.render(React.createElement(App)));
    await respond("/api/public?kind=index", { posts: { invalid: true }, categories: [], contentCommit: "a".repeat(40) });
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
    ["/api/public?kind=index", { posts, categories, contentCommit: "a".repeat(40) }],
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

const managedId = "12345678-1234-8234-9234-123456789012";
const managedPost = {
  id: managedId, title: "저장 전 글", parentId: null, category: "notes", categoryId: "notes",
  createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z",
  markdown: "저장 전 본문", excerpt: "요약", path: "posts/" + managedId + "/글.md", url: "",
};
const managedCategories = [{ id: "notes", name: "기록", parentId: null, order: 0, sources: ["notes"] }];
const canonicalCategories = [{ id: "notes", name: "기록", parent_id: null, order: 0, sources: ["notes"] }];
const readySession = { state: "ready", user: { id: 12, login: "owner" }, csrfToken: "csrf" };
const reply = (data) => ({ ok: true, json: async () => data });

async function waitFor(predicate, message) {
  const deadline = Date.now() + 8000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail(message);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

for (const operation of ["update", "create", "delete"]) {
  test(`App refreshes the public index after post ${operation} and reads the saved body after closing`, { timeout: 15000 }, async () => {
    const previous = globalThis.fetch;
    const requests = [];
    const savedCommit = "c".repeat(40);
    let saved = false;
    globalThis.fetch = async (url, options = {}) => {
      requests.push(url);
      if (url === "/api/session") return reply(readySession);
      if (url.startsWith("/api/public?kind=index")) return reply({
        posts: saved
          ? operation === "delete" ? [] : [{ ...managedPost, title: "저장한 글", markdown: "SUMMARY", bodyLoaded: false }]
          : operation === "create" ? [] : [managedPost],
        categories: managedCategories,
        contentCommit: saved ? savedCommit : "b".repeat(40),
      });
      if (url.startsWith("/api/public?kind=post")) {
        assert.equal(new URL(url, "https://blog.example").searchParams.get("commit"), savedCommit);
        return reply({ ...managedPost, title: "저장한 글", markdown: "저장한 전체 본문", bodyLoaded: true });
      }
      if (url.startsWith("/api/content?")) return reply({
        document: { metadata: { id: managedId, title: "저장한 글", category_id: "notes" }, markdown: "저장한 전체 본문" },
        revision: operation === "create" ? null : "a".repeat(64), contentCommit: "b".repeat(40),
        categories: canonicalCategories, assets: [],
      });
      assert.equal(url, "/api/content");
      const input=JSON.parse(options.body);
      assert.equal((input.operations?.[0]??input.operation).type, "post." + operation);
      saved = true;
      const result={requestId:input.requestId,candidateCommit:savedCommit,contentCommit:savedCommit,state:"published"};
      return reply(input.operations?bulkResponse(input,result,{document:{metadata:{id:managedId,title:"저장한 글",category_id:"notes"},markdown:"저장한 전체 본문"},revision:"d".repeat(64),assets:[],categories:canonicalCategories}):result);
    };
    dom.window.history.replaceState(null, "", operation === "create" ? "/#/" : "/#/post/" + managedId);
    const root = createRoot(document.getElementById("root"));
    try {
      await act(async () => root.render(React.createElement(App)));
      if (operation === "delete") {
        await act(async () => {
          const changed = once(dom.window, "hashchange", { signal: AbortSignal.timeout(2000) });
          dom.window.location.hash = "#/content";
          await changed;
        });
      }
      const edit = operation === "create" ? document.querySelector("button.header-write")
        : operation === "delete" ? [...document.querySelectorAll('button')].find(button=>button.getAttribute('aria-label')===managedPost.title+' 삭제')
        : document.querySelector(".article-topline button");
      assert.ok(edit !== null && edit !== undefined, "An authenticated reader can open the editor");
      await act(async () => edit.click());
      const editorSelector = ".editor-page.notebook-writing";
      if (operation === "delete") {
        await act(async () => document.querySelector('#confirm-post-delete').click());
        await waitFor(()=>document.querySelector('dialog')===null&&requests.includes('/api/public?kind=index&after='+savedCommit),'Deleting from the workspace must refresh its index');
      } else {
        await waitFor(() => document.querySelector(editorSelector) !== null && document.querySelector('.bn-editor[contenteditable="true"]') !== null, "The authenticated block editor must open");
        if (operation === "create") {
          await act(async () => {
            const input = document.querySelector('[aria-label="글 제목"]');
            Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "저장한 글");
            input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
          });
        }
        await act(async () => document.querySelector('button[type="submit"]').click());
      }
      if(operation!=="delete")await waitFor(
        () => document.querySelector('.publish-status [role="status"]')?.textContent === "게시 완료",
        "The saved post must reach published status",
      );
      assert.ok(requests.includes("/api/public?kind=index&after=" + savedCommit), "The refresh must bypass an older cached index");
      if(operation!=="delete")await act(async () => document.querySelector('.editor-back').click());
      assert.ok(document.querySelector(editorSelector) === null, "Closing returns to the public view");
      if (operation !== "delete") {
        assert.match(document.querySelector("main").textContent, /저장한 글/);
        await act(async () => {
          const changed = once(dom.window, "hashchange", { signal: AbortSignal.timeout(2000) });
          dom.window.location.hash = "#/post/" + managedId;
          await changed;
        });
      }
      if (operation === "delete") {
        assert.ok(document.querySelector(".article-prose") === null, "A deleted article must disappear immediately");
        assert.doesNotMatch(document.querySelector("main").textContent, /저장 전 본문/);
      } else {
        assert.match(document.querySelector(".article-prose").textContent, /저장한 전체 본문/);
        assert.doesNotMatch(document.querySelector(".article-prose").textContent, /SUMMARY|저장 전 본문/);
      }
      assert.equal(requests.some((url) => url.startsWith("/api/publish")), false, "Direct saves need no publication polling");
    } finally {
      await act(async () => root.unmount());
      localStorage.clear();
      dom.window.history.replaceState(null, "", "/#/");
      globalThis.fetch = previous;
    }
  });
}

test("App refreshes public category names after saving canonical categories", { timeout: 15000 }, async () => {
  const previous = globalThis.fetch;
  const requests = [];
  let saved = false;
  globalThis.fetch = async (url, options = {}) => {
    requests.push(url);
    if (url === "/api/session") return reply(readySession);
    if (url.startsWith("/api/public?kind=index")) return reply({
      posts: [managedPost],
      categories: saved ? [{ ...managedCategories[0], name: "새 분류" }] : managedCategories,
      contentCommit: (saved ? "c" : "b").repeat(40),
    });
    if (url === "/api/content?kind=categories") return reply({ categories: canonicalCategories, revision: "a".repeat(64), contentCommit: "b".repeat(40) });
    assert.equal(url, "/api/content");
    saved = true;
    return reply(bulkResponse(JSON.parse(options.body),{state:"published",contentCommit:"c".repeat(40)}));
  };
  dom.window.history.replaceState(null, "", "/#/categories");
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(App)));
    await act(async () => document.querySelector('button[aria-label="기록 수정"]').click());
    const input = document.querySelector("#inline-name");
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "새 분류");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await act(async () => document.querySelector("#inline-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => document.querySelector("#save-all").click());
    await waitFor(()=>requests.includes("/api/public?kind=index&after=" + "c".repeat(40)),"Category bulk save must refresh the index");
    await act(async () => {
      const changed = once(dom.window, "hashchange", { signal: AbortSignal.timeout(2000) });
      document.querySelector('.header-navigation a[href="#/records"]').click();
      await changed;
    });
    assert.match(document.querySelector(".records-category-nav").textContent, /새 분류/);
    assert.equal(document.querySelector(".post-meta span").textContent, "새 분류");
  } finally {
    await act(async () => root.unmount());
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    localStorage.clear();
    dom.window.history.replaceState(null, "", "/#/");
    globalThis.fetch = previous;
  }
});

for (const local of [false, true]) {
  test(`category context menu opens a new writer with its ${local ? "local" : "canonical"} nested category selected`, { timeout: 15000 }, async () => {
    const previous = globalThis.fetch;
    const requests = [];
    const categories = [
      { id: "root", name: "Root", parentId: null, order: 0, sources: ["root"] },
      { id: "child", name: "Child", parentId: "root", order: 1, sources: ["child"] },
    ];
    globalThis.fetch = async (url) => {
      requests.push(url);
      if (url === "/api/session") return reply(readySession);
      assert.equal(url, "/api/public?kind=index");
      return reply({ posts: [], categories: local ? [categories[0]] : categories, contentCommit: "b".repeat(40) });
    };
    localStorage.clear();
    if (local) {
      localStorage.setItem("second-brain:records-categories:v1", JSON.stringify({
        version: 1,
        baseNodes: [categories[0]],
        nodes: categories.map(category => ({ ...category, sources: category.id === "child" ? [] : category.sources })),
      }));
    }
    dom.window.history.replaceState(null, "", "/#/records");
    const root = createRoot(document.getElementById("root"));
    try {
      await act(async () => root.render(React.createElement(App)));
      await act(async () => document.querySelector('[aria-label="Root"]').click());
      const child = document.querySelector('[aria-label="Child"]');
      assert.ok(child !== null, "nested category is available");
      await act(async () => child.dispatchEvent(new dom.window.MouseEvent("contextmenu", {
        bubbles: true, cancelable: true, clientX: 100, clientY: 100,
      })));
      const add = [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent === "글 추가");
      assert.ok(add !== undefined, "category menu offers writing");
      await act(async () => add.click());
      await waitFor(() => document.querySelector(".editor-page.notebook-writing") !== null, "category menu must open the writer");
      assert.match(document.querySelector(".mock-category-button").textContent, /^Child\s*⌄?$/);
      assert.equal(requests.some(url => url.startsWith("/api/content?")), false, "new writing reuses the loaded catalog");
    } finally {
      await act(async () => root.unmount());
      localStorage.clear();
      dom.window.history.replaceState(null, "", "/#/");
      globalThis.fetch = previous;
    }
  });
}

test("new writing loads an authenticated base when the public index is unavailable", { timeout: 15000 }, async () => {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url) => {
    requests.push(url);
    if (url === "/api/session") return reply(readySession);
    if (url === "/api/public?kind=index") return {
      ok: false, json: async () => ({ error: "Public content is not ready for this commit" }),
    };
    assert.equal(url, "/api/content?kind=new");
    return reply({
      document: { metadata: { id: managedId, title: "" }, markdown: "" },
      revision: null, contentCommit: "b".repeat(40), categories: canonicalCategories, assets: [],
    });
  };
  localStorage.clear();
  localStorage.setItem("second-brain:records-categories:v1", JSON.stringify({
    version: 1, baseNodes: [], nodes: [
      { id: "local-notes", name: "새 분류", parentId: null, sources: [] },
    ],
  }));
  dom.window.history.replaceState(null, "", "/#/records");
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(App)));
    await act(async () => document.querySelector('[aria-label="새 분류"]').dispatchEvent(new dom.window.MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, clientX: 100, clientY: 100,
    })));
    const add = [...document.querySelectorAll('[role="menuitem"]')].find(node => node.textContent === "글 추가");
    assert.ok(add !== undefined, "local category menu offers writing");
    await act(async () => add.click());
    await waitFor(() => document.querySelector(".mock-category-button") !== null, "writer must load");
    assert.equal(requests.filter(url => url === "/api/content?kind=new").length, 1, "failed public loading must not become an empty save base");
    assert.match(document.querySelector(".mock-category-button").textContent, /새 분류/);
    const saveDraft = [...document.querySelectorAll("button")].find(node => node.textContent === "초안 저장");
    assert.ok(saveDraft !== undefined, "draft save is available");
    await act(async () => saveDraft.click());
    const draftKey = Object.keys(localStorage).find(key => key.startsWith("second-brain:canonical-draft:"));
    assert.ok(draftKey !== undefined, "draft recovery is stored");
    const draft = JSON.parse(localStorage.getItem(draftKey));
    assert.equal(draft.category, "local-notes");
    assert.equal(draft.sourceDocument.contentCommit, "b".repeat(40));
    assert.equal(draft.sourceDocument.pendingCategories[0].id, "local-notes");
  } finally {
    await act(async () => root.unmount());
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    localStorage.clear();
    globalThis.fetch = previous;
  }
});

after(() => dom.window.close());
