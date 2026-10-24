import assert from "node:assert/strict";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://blog.example/#/",
  pretendToBeVisual: true,
});
for (const name of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "MutationObserver", "FileReader"]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
  });
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.scrollTo = () => {};
dom.window.matchMedia = () => ({ matches: false });
dom.window.HTMLDialogElement.prototype.close = function () {};
dom.window.HTMLDialogElement.prototype.showModal = function () {};
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App } = await loadComponent("src/app/App.tsx");

const id = "12345678-1234-8234-9234-123456789012";
const post = {
  id, title: "공개 글", parentId: null, category: "notes", categoryId: "notes",
  createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z",
  markdown: "공개 본문", excerpt: "공개 요약", path: "posts/" + id + "/공개 글.md", url: "",
};
const categories = [{ id: "notes", name: "기록", parentId: null, order: 0, sources: ["notes"] }];
const ready = { state: "ready", user: { id: 12, login: "owner" }, csrfToken: "test-csrf" };
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

async function mounted(render, run) {
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(render));
    await run(root);
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
    dom.window.history.replaceState(null, "", "/#/");
  }
}

test("public articles render while authentication is pending and writing requires login", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "/api/session") return new Promise(() => {});
    return reply(url === "/content/index.json" ? [post] : categories);
  };
  try {
    await mounted(React.createElement(App), async () => {
      assert.match(document.querySelector("main").textContent, /공개 글/);
      const login = document.querySelector('a.header-write[href="/api/auth/github"]');
      assert.ok(login !== null, "login replaces the writing action");
      assert.equal(login.textContent.trim(), "로그인");
      assert.ok(login.classList.contains("dark-button"));
      assert.ok(login.querySelector('svg[aria-hidden="true"]') !== null);
      assert.ok(document.querySelector("button.header-write") === null, "the writing button is hidden");
      assert.ok(
        document.querySelector('.header-navigation a[href="#/categories"]') === null,
        "category management navigation is hidden",
      );
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("category management is hidden when authentication is unavailable, including direct entry", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "/api/session") throw new Error("offline");
    return reply(url === "/content/index.json" ? [post] : categories);
  };
  dom.window.history.replaceState(null, "", "/#/categories");
  try {
    await mounted(React.createElement(App), async () => {
      assert.match(document.querySelector("main").textContent, /로그인/);
      assert.ok(document.querySelector(".categories-page") === null, "the category manager is hidden");
      assert.ok(document.querySelector('button[type="submit"]') === null, "submit controls are hidden");
      assert.ok(
        document.querySelector('.header-navigation a[href="#/categories"]') === null,
        "category management navigation is hidden",
      );
      assert.doesNotMatch(document.querySelector("header").textContent, /연결 재확인|configuration|GitHub 연결을 확인/);
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("public records keep category filters and hide management links without login", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "/api/session") return reply({ state: "signed_out" });
    return reply(url === "/content/index.json" ? [post] : categories);
  };
  dom.window.history.replaceState(null, "", "/#/records");
  try {
    await mounted(React.createElement(App), async () => {
      assert.ok(document.querySelector('.records-sidebar[aria-label="카테고리"]') !== null);
      assert.equal(document.querySelectorAll('a[href="#/categories"]').length, 0);
      assert.ok(document.querySelector('a.header-write[href="/api/auth/github"]') !== null);
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("logging out an expired session restores public controls and login", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "/api/session") return reply(ready);
    if (url === "/api/logout") return reply({ error: "Session expired" }, 401);
    return reply(url === "/content/index.json" ? [post] : categories);
  };
  try {
    await mounted(React.createElement(App), async () => {
      const logout = [...document.querySelectorAll("button")].find((button) => button.textContent === "로그아웃");
      assert.ok(logout !== undefined);
      await act(async () => logout.click());
      assert.ok(document.querySelector('a[href="/api/auth/github"]') !== null);
      assert.ok(document.querySelector("button.header-write") === null, "the writing button is hidden");
      assert.match(document.querySelector("main").textContent, /공개 글/);
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("fresh publication responses clear stale alerts and retain current errors", { timeout: 5000 }, async (t) => {
  const { default: PublishStatus } = await loadComponent("src/features/content-management/PublishStatus.tsx");
  const previous = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    if (options.method === "POST") return reply({ state: "saved", runId: 2 });
    polls++;
    return reply(polls === 1
      ? { state: "published" }
      : { state: "pending", error: "Current workflow warning" });
  };
  const initial = {
    requestId: "request", candidateCommit: "c".repeat(40), runId: 1,
    state: "pending", error: "Publication did not complete; resume this request.",
  };
  function PublicationStatus({ initial }) {
    const [publication, setPublication] = React.useState(initial);
    return React.createElement(PublishStatus, { publication, csrfToken: "test-csrf", onChange: setPublication });
  }
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await mounted(React.createElement(PublicationStatus, { initial }), async (root) => {
      assert.equal(document.querySelector('[role="alert"]').textContent, initial.error);
      await act(async () => document.querySelector(".publish-status button").click());
      assert.equal(document.querySelector('[role="status"]').textContent, "원본 저장 완료");
      assert.ok(document.querySelector('[role="alert"]') === null, "A successful retry must clear the previous error");
      await act(async () => root.render(React.createElement(PublicationStatus, {
        key: "poll", initial: { ...initial, state: "saved" },
      })));
      assert.equal(document.querySelector('[role="alert"]').textContent, initial.error);
      await act(async () => t.mock.timers.tick(1500));
      assert.equal(polls, 1);
      assert.equal(document.querySelector('[role="status"]').textContent, "게시 완료");
      assert.ok(document.querySelector('[role="alert"]') === null, "A successful poll must clear the previous error");
      await act(async () => root.render(React.createElement(PublicationStatus, {
        key: "new-error", initial: { ...initial, state: "saved" },
      })));
      await act(async () => t.mock.timers.tick(1500));
      assert.equal(polls, 2);
      assert.equal(document.querySelector('[role="alert"]').textContent, "Current workflow warning");
    });
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = previous;
  }
});

test("publication polling preserves the first check, waits thirty seconds and stops after publication", { timeout: 5000 }, async (t) => {
  const { default: PublishStatus } = await loadComponent("src/features/content-management/PublishStatus.tsx");
  const previous = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = async (url) => {
    assert.ok(url.startsWith("/api/publish?"), "Polling must read publication status");
    polls++;
    return reply({ state: polls === 1 ? "saved" : "published" });
  };
  function PublicationStatus() {
    const [publication, setPublication] = React.useState({
      requestId: "request", candidateCommit: "c".repeat(40), runId: 1, state: "saved",
    });
    return React.createElement(PublishStatus, { publication, csrfToken: "test-csrf", onChange: setPublication });
  }
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await mounted(React.createElement(PublicationStatus), async () => {
      await act(async () => t.mock.timers.tick(1499));
      assert.equal(polls, 0, "The first poll must wait 1.5 seconds");
      await act(async () => t.mock.timers.tick(1));
      assert.equal(polls, 1);
      await act(async () => t.mock.timers.tick(5000));
      assert.equal(polls, 1, "Five seconds must not trigger another GitHub status check");
      await act(async () => t.mock.timers.tick(24999));
      assert.equal(polls, 1, "Recurring polls must wait the full thirty seconds");
      await act(async () => t.mock.timers.tick(1));
      assert.equal(polls, 2);
      assert.equal(document.querySelector('[role="status"]').textContent, "게시 완료");
      await act(async () => t.mock.timers.tick(60000));
      assert.equal(polls, 2, "Published requests must stop polling");
    });
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = previous;
  }
});

test("canonical title edits send untouched Markdown and CSRF to a candidate publication", async () => {
  const { default: Editor } = await loadComponent("src/features/content-management/ManagedPostEditor.tsx");
  const markdown = "\n# Keep H1\n\n<details>\n<summary>Keep HTML</summary>\nraw\n</details>\n";
  const requests = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url, ...init });
    if (url.startsWith("/api/content?")) return reply({
      document: { metadata: { id, title: "원제목", category_id: "notes", agent: { retain: true } }, markdown },
      revision: "a".repeat(64), contentCommit: "b".repeat(40),
      categories: [{ id: "notes", name: "기록", parent_id: null, order: 0, sources: ["notes"] }], assets: [],
    });
    if (url === "/api/content") return reply({ requestId: "request", candidateCommit: "c".repeat(40), runId: 1, runUrl: "https://github.com/gyungsubLee/subdev-blog/actions/runs/1", state: "validating" });
    return reply({ state: "validating" });
  };
  try {
    await mounted(React.createElement(Editor, { post, session: ready, onClose() {} }), async () => {
      const title = document.querySelector('input[aria-label="글 제목"]');
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(title, "새 제목");
        title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => document.querySelector('button[type="submit"]').click());
      const save = requests.find((item) => item.url === "/api/content");
      assert.ok(save);
      assert.equal(new Headers(save.headers).get("x-csrf-token"), "test-csrf");
      const body = JSON.parse(save.body);
      assert.equal(body.operation.type, "post.update");
      assert.equal(body.operation.markdown, markdown);
      assert.equal(body.operation.changes.title, "새 제목");
      assert.equal(body.baseCommit, "b".repeat(40));
      assert.match(document.querySelector('[role="status"]').textContent, /검증 중/);
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("a failed canonical save retains the edited source for reauthentication", async () => {
  const { default: Editor } = await loadComponent("src/features/content-management/ManagedPostEditor.tsx");
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => url.startsWith("/api/content?")
    ? reply({ document: { metadata: { id, title: "Title" }, markdown: "raw body" }, revision: "a".repeat(64), contentCommit: "b".repeat(40), categories: [], assets: [] })
    : reply({ error: "다시 로그인하십시오." }, 401);
  try {
    await mounted(React.createElement(Editor, { post, session: ready, onClose() {} }), async () => {
      await act(async () => document.querySelector('button[type="submit"]').click());
      assert.equal(document.querySelector('textarea[aria-label="본문 Markdown"]').value, "raw body");
      assert.match(document.querySelector('[role="alert"]').textContent, /로그인/);
      assert.ok(document.querySelector('a[href="/api/auth/github"]') !== null);
      assert.ok([...Array(localStorage.length)].some((_, index) => localStorage.key(index).startsWith("second-brain:canonical-draft:")));
    });
  } finally {
    globalThis.fetch = previous;
  }
});

for (const existing of [false, true]) test(`${existing ? "existing" : "new"}-post retries after reopening retain their original identity and request`, async () => {
  const { default: Editor } = await loadComponent("src/features/content-management/ManagedPostEditor.tsx");
  const previous = globalThis.fetch;
  const saves = [];
  let reads = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.startsWith("/api/content?")) return reply({
      document: { metadata: { id: reads++ ? "12345678-1234-8234-9234-123456789013" : id, title: "새 글" }, markdown: "새 본문" },
      revision: existing ? (reads > 1 ? "d" : "a").repeat(64) : null,
      contentCommit: (reads > 1 ? "e" : "b").repeat(40), categories: [], assets: [],
    });
    saves.push(JSON.parse(options.body));
    throw new Error("response lost");
  };
  const props = { post: existing ? post : null, session: ready, onClose() {} };
  try {
    await mounted(React.createElement(Editor, { ...props, key: "first" }), async (root) => {
      await act(async () => document.querySelector('button[type="submit"]').click());
      await act(async () => root.render(React.createElement(Editor, { ...props, key: "second" })));
      await act(async () => document.querySelector('button[type="submit"]').click());
      assert.equal(saves.length, 2);
      assert.equal(existing ? saves[0].operation.id : saves[0].operation.document.metadata.id, id);
      assert.deepEqual(saves[1], saves[0]);
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("canonical category retries retain edits, original sources and request identity", async () => {
  const { default: Categories } = await loadComponent("src/features/content-management/ManagedCategories.tsx");
  const previous = globalThis.fetch;
  const saves = [];
  let reads = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url.startsWith("/api/content?")) return reply({
      categories: [{ id: "notes", name: "원래 분류", parent_id: null, order: 3, sources: ["original"], custom: { keep: true } }],
      revision: (++reads > 1 ? "c" : "a").repeat(64), contentCommit: (reads > 1 ? "d" : "b").repeat(40),
    });
    saves.push(JSON.parse(options.body));
    return reply({ error: "다시 로그인하십시오." }, 401);
  };
  const props = { categories, session: ready };
  try {
    await mounted(React.createElement(Categories, { ...props, key: "first" }), async (root) => {
      await act(async () => document.querySelector('button[aria-label="원래 분류 수정"]').click());
      const input = document.querySelector("#inline-name");
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "바꾼 분류");
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => document.querySelector("#inline-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
      await act(async () => document.querySelector("#save-all").click());
      await act(async () => root.render(React.createElement(Categories, { ...props, key: "second" })));
      assert.ok(document.querySelector('button[aria-label="바꾼 분류 수정"]') !== null);
      await act(async () => document.querySelector("#save-all").click());
      assert.equal(saves.length, 2);
      assert.deepEqual(saves[1], saves[0]);
      assert.deepEqual(saves[1].operation.categories[0].sources, ["original"]);
      assert.deepEqual(saves[1].operation.categories[0].custom, { keep: true });
      assert.ok(document.querySelector('a[href="/api/auth/github"]') !== null);
      const originalConfirm = window.confirm;
      window.confirm = () => true;
      try {
        const reset = [...document.querySelectorAll("button")].find((button) => button.textContent === "최신 원본으로 다시 시작");
        assert.ok(reset !== undefined);
        await act(async () => reset.click());
        assert.ok(document.querySelector('button[aria-label="원래 분류 수정"]') !== null);
      } finally {
        window.confirm = originalConfirm;
      }
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("a lost deletion response can be retried after the source has disappeared", async () => {
  const { default: Editor } = await loadComponent("src/features/content-management/ManagedPostEditor.tsx");
  const previous = globalThis.fetch;
  const saves = [];
  let deleted = false;
  globalThis.fetch = async (url, options = {}) => {
    if (url.startsWith("/api/content?")) return deleted
      ? reply({ error: "Post not found" }, 404)
      : reply({ document: { metadata: { id, title: "삭제할 글" }, markdown: "보존할 본문" }, revision: "a".repeat(64), contentCommit: "b".repeat(40), categories: [], assets: [] });
    saves.push(JSON.parse(options.body));
    deleted = true;
    throw new Error("response lost");
  };
  const props = { post, session: ready, onClose() {} };
  async function remove() {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent === "글 삭제");
    assert.ok(button !== undefined, "saved deletion source remains available");
    await act(async () => button.click());
    await act(async () => document.querySelector('[role="alertdialog"] button').click());
  }
  try {
    await mounted(React.createElement(Editor, { ...props, key: "first" }), async (root) => {
      await remove();
      await act(async () => root.render(React.createElement(Editor, { ...props, key: "second" })));
      await remove();
      assert.equal(saves.length, 2);
      assert.equal(saves[0].operation.type, "post.delete");
      assert.deepEqual(saves[1], saves[0]);
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("attachment names with parentheses produce an intact Markdown destination", { timeout: 10000 }, async () => {
  const { default: Editor } = await loadComponent("src/features/content-management/ManagedPostEditor.tsx");
  const previous = globalThis.fetch;
  let uploaded;
  const uploadDone = new Promise((resolve) => { uploaded = resolve; });
  globalThis.fetch = async (url) => {
    if (url.startsWith("/api/content?")) return reply({
      document: { metadata: { id, title: "첨부 글" }, markdown: "본문" },
      revision: "a".repeat(64), contentCommit: "b".repeat(40), categories: [], assets: [],
    });
    assert.equal(url, "/api/assets");
    uploaded();
    return reply({ sha: "c".repeat(40), size: 5 });
  };
  let timer;
  try {
    await mounted(React.createElement(Editor, { post, session: ready, onClose() {} }), async () => {
      const field = document.querySelector('input[type="file"]');
      Object.defineProperty(field, "files", { configurable: true, value: [new dom.window.File(["image"], "foo).png", { type: "image/png" })] });
      await act(async () => {
        field.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
        await Promise.race([
          uploadDone,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Attachment upload timed out")), 3000); }),
        ]);
      });
      assert.match(document.querySelector('textarea[aria-label="본문 Markdown"]').value, /!\[foo\)\.png\]\(\.\/foo%29\.png\)/);
    });
  } finally {
    clearTimeout(timer);
    globalThis.fetch = previous;
  }
});

after(() => dom.window.close());
