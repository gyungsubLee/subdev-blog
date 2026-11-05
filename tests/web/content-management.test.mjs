import assert from "node:assert/strict";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import { bulkResponse } from "../support/bulk-response.mjs";
import { loadComponent } from "../support/load-component.mjs";

const dom = new JSDOM('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content"><div id="root"></div>', {
  url: "https://blog.example/#/",
  pretendToBeVisual: true,
});
for (const name of ["window", "document", "navigator", "Node", "Element", "HTMLElement", "MutationObserver", "FileReader", "DOMParser", "DOMRect", "DocumentFragment", "Text", "NodeFilter", "HTMLDivElement", "HTMLParagraphElement", "HTMLInputElement", "Range", "KeyboardEvent", "MouseEvent", "Event"]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
  });
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.scrollTo = () => {};
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = dom.window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver = dom.window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.Element.prototype.getBoundingClientRect = () => new dom.window.DOMRect(0, 0, 100, 30);
dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
dom.window.Range.prototype.getClientRects = () => [];
dom.window.document.elementFromPoint = () => dom.window.document.body;
dom.window.HTMLDialogElement.prototype.close = function () {};
dom.window.HTMLDialogElement.prototype.showModal = function () {};
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: App } = await loadComponent("app/web/src/site/App.tsx");

const id = "12345678-1234-8234-9234-123456789012";
const post = {
  id, title: "공개 글", parentId: null, category: "notes", categoryId: "notes",
  createdAt: "2026-10-22T00:00:00.000Z", updatedAt: "2026-10-22T00:00:00.000Z",
  markdown: "공개 본문", excerpt: "공개 요약", path: "posts/" + id + "/공개 글.md", url: "",
};
const categories = [{ id: "notes", name: "기록", parentId: null, order: 0, sources: ["notes"] }];
const ready = { state: "ready", user: { id: 12, login: "owner" }, csrfToken: "test-csrf" };
const reply = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

async function waitFor(check) {
  const deadline=Date.now()+8000;
  while(!check()) {
    assert.ok(Date.now()<deadline,"background sync deadline");
    await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));
  }
}

async function mounted(render, run) {
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(render));
    await run(root);
  } finally {
    await act(async () => root.unmount());
    window.dispatchEvent(new window.Event("pagehide"));
    localStorage.clear();
    dom.window.history.replaceState(null, "", "/#/");
  }
}

test("public articles render while authentication is pending and writing requires login", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url === "/api/session") return new Promise(() => {});
    assert.equal(url, "/api/public?kind=index");
    return reply({ posts: [post], categories, contentCommit: "b".repeat(40) });
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
    assert.equal(url, "/api/public?kind=index");
    return reply({ posts: [post], categories, contentCommit: "b".repeat(40) });
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
    assert.equal(url, "/api/public?kind=index");
    return reply({ posts: [post], categories, contentCommit: "b".repeat(40) });
  };
  dom.window.history.replaceState(null, "", "/#/records");
  try {
    await mounted(React.createElement(App), async () => {
      assert.ok(document.querySelector('.records-category-nav[aria-label="카테고리"]') !== null);
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
    assert.equal(url, "/api/public?kind=index");
    return reply({ posts: [post], categories, contentCommit: "b".repeat(40) });
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

test("direct publication succeeds without polling and clears a stale retry error", { timeout: 5000 }, async (t) => {
  const { default: PublishStatus } = await loadComponent("app/web/src/features/content-management/PublishStatus.tsx");
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method, body: JSON.parse(options.body) });
    return reply(requests.length === 1
      ? { state: "published", contentCommit: "c".repeat(40) }
      : { state: "pending", error: "Current save warning" });
  };
  const initial = {
    requestId: "request", candidateCommit: "c".repeat(40), state: "pending",
    error: "The save response was lost; resume this request.",
  };
  function PublicationStatus() {
    const [publication, setPublication] = React.useState(initial);
    return React.createElement(PublishStatus, { publication, csrfToken: "test-csrf", onChange: setPublication });
  }
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await mounted(React.createElement(PublicationStatus), async (root) => {
      assert.equal(document.querySelector('[role="alert"]').textContent, initial.error);
      await act(async () => document.querySelector(".publish-status button").click());
      assert.equal(document.querySelector('.publish-status [role="status"]').textContent, "게시 완료");
      assert.ok(document.querySelector('[role="alert"]') === null, "A successful retry must clear the previous error");
      await act(async () => t.mock.timers.tick(60000));
      assert.deepEqual(requests, [{
        url: "/api/publish", method: "POST",
        body: { requestId: "request", candidateCommit: "c".repeat(40) },
      }], "A direct success must not poll for an Actions run");
      await act(async () => root.render(React.createElement(PublicationStatus, { key: "current-error" })));
      await act(async () => document.querySelector(".publish-status button").click());
      assert.equal(document.querySelector('[role="alert"]').textContent, "Current save warning", "The current response error must replace a stale error");
    });
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = previous;
  }
});

test("legacy publication checks resolve without an Actions run and stop after publication", { timeout: 5000 }, async (t) => {
  const { default: PublishStatus } = await loadComponent("app/web/src/features/content-management/PublishStatus.tsx");
  const previous = globalThis.fetch;
  let polls = 0;
  globalThis.fetch = async (url) => {
    const params = new URL(url, "https://blog.example").searchParams;
    assert.equal(params.get("requestId"), "request");
    assert.equal(params.get("candidateCommit"), "c".repeat(40));
    assert.equal(params.has("runId"), false, "A saved draft must not require an Actions run");
    polls++;
    return reply({ state: polls === 1 ? "saved" : "published", contentCommit: "c".repeat(40) });
  };
  function PublicationStatus() {
    const [publication, setPublication] = React.useState({
      requestId: "request", candidateCommit: "c".repeat(40), state: "saved",
    });
    return React.createElement(PublishStatus, { publication, csrfToken: "test-csrf", onChange: setPublication });
  }
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await mounted(React.createElement(PublicationStatus), async () => {
      await act(async () => t.mock.timers.tick(1499));
      assert.equal(polls, 0, "The first check must wait 1.5 seconds");
      await act(async () => t.mock.timers.tick(1));
      assert.equal(polls, 1);
      await act(async () => t.mock.timers.tick(29999));
      assert.equal(polls, 1, "Recurring checks must wait thirty seconds");
      await act(async () => t.mock.timers.tick(1));
      assert.equal(polls, 2);
      assert.equal(document.querySelector('[role="status"]').textContent, "게시 완료");
      await act(async () => t.mock.timers.tick(60000));
      assert.equal(polls, 2, "Published requests must stop checking");
    });
  } finally {
    t.mock.timers.reset();
    globalThis.fetch = previous;
  }
});

test("background source completion keeps the existing saved label without duplicate publication polling", {timeout:5000}, async t => {
  const {default:PublishStatus}=await loadComponent("app/web/src/features/content-management/PublishStatus.tsx");
  const previous=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async()=>{requests++;return reply({state:"published"});};
  t.mock.timers.enable({apis:["setTimeout"]});
  try {
    await mounted(React.createElement(PublishStatus,{publication:{state:"saved",requestId:"request",candidateCommit:"c".repeat(40),background:true},csrfToken:"test-csrf",onChange(){}}),async()=>{
      assert.equal(document.querySelector('.publish-status [role="status"]').textContent,"원본 저장 완료");
      await act(async()=>t.mock.timers.tick(60000));
      assert.equal(requests,0,"the durable background tracker owns publication polling");
      assert.equal(document.querySelector('.publish-status [role="status"]').textContent,"원본 저장 완료");
    });
  } finally {t.mock.timers.reset();globalThis.fetch=previous;}
});

test("canonical title edits preserve Markdown and CSRF then refresh the published commit", {timeout:15000}, async () => {
  const { default: Editor } = await loadComponent("app/web/src/features/content-management/ManagedPostEditor.tsx");
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
    if (url === "/api/content") return reply(bulkResponse(JSON.parse(init.body),{}, {document:{metadata:{id,title:"원제목"},markdown},categories,assets:[]}));
    return reply({ state: "validating" });
  };
  const refreshed = [];
  try {
    await mounted(React.createElement(Editor, { post, session: ready, onClose() {}, onSaved: (commit) => refreshed.push(commit) }), async () => {
      const title = document.querySelector('input[aria-label="글 제목"]');
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(title, "새 제목");
        title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => document.querySelector('button[type="submit"]').click());
      await waitFor(() => document.querySelector('.publish-status [role="status"]')?.textContent === "게시 완료");
      const save = requests.find((item) => item.url === "/api/content");
      assert.ok(save);
      assert.equal(new Headers(save.headers).get("x-csrf-token"), "test-csrf");
      const body = JSON.parse(save.body);
      assert.equal(body.operations[0].type, "post.update");
      assert.equal(body.operations[0].markdown, markdown);
      assert.equal(body.operations[0].changes.title, "새 제목");
      assert.equal(body.baseCommit, "b".repeat(40));
      assert.equal(document.querySelector('.publish-status [role="status"]').textContent, "게시 완료");
      assert.deepEqual(refreshed, ["c".repeat(40)]);
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("a failed canonical save retains the edited source for reauthentication", {timeout:15000}, async () => {
  const { default: Editor } = await loadComponent("app/web/src/features/content-management/ManagedPostEditor.tsx");
  const previous = globalThis.fetch;
  globalThis.fetch = async (url) => url.startsWith("/api/content?")
    ? reply({ document: { metadata: { id, title: "Title" }, markdown: "raw body" }, revision: "a".repeat(64), contentCommit: "b".repeat(40), categories: [], assets: [] })
    : reply({ error: "다시 로그인하십시오." }, 401);
  try {
    await mounted(React.createElement(Editor, { post, session: ready, onClose() {} }), async () => {
      await act(async () => document.querySelector('button[type="submit"]').click());
      assert.ok(document.querySelector('.bn-editor') !== null);
      assert.equal(JSON.parse(localStorage.getItem('second-brain:canonical-draft:'+id)).markdown, "raw body");
      await waitFor(() => document.querySelector('[role="alert"]')?.textContent.includes("로그인"));
      assert.match(document.querySelector('[role="alert"]').textContent, /로그인/);
      assert.ok(document.querySelector('a[href="/api/auth/github"]') !== null);
      assert.ok([...Array(localStorage.length)].some((_, index) => localStorage.key(index).startsWith("second-brain:canonical-draft:")));
    });
  } finally {
    globalThis.fetch = previous;
  }
});

for (const existing of [false, true]) test(`${existing ? "existing" : "new"}-post retries after reopening retain their original identity and request`, {timeout:20000}, async () => {
  const { default: Editor } = await loadComponent("app/web/src/features/content-management/ManagedPostEditor.tsx");
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
      async function saveAndWait(count) {
        await act(async () => document.querySelector('button[type="submit"]').click());
        const deadline = Date.now() + 8000;
        while (saves.length < count) {
          if (Date.now() > deadline) assert.fail("Retry save did not reach the API");
          await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
        }
      }
      await saveAndWait(1);
      await act(async () => root.render(React.createElement(Editor, { ...props, key: "second" })));
      const deadline = Date.now() + 8000;
      while (!document.querySelector('button[type="submit"]')) {
        if (Date.now() > deadline) assert.fail("Recovered editor did not mount");
        await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      }
      await saveAndWait(2);
      assert.equal(saves.length, 2);
      assert.equal(existing ? saves[0].operations[0].id : saves[0].operations[0].document.metadata.id, id);
      assert.deepEqual(saves[1], saves[0]);
    });
  } finally {
    globalThis.fetch = previous;
  }
});

test("canonical category retries retain edits, original sources and request identity", {timeout:20000}, async () => {
  const { default: Categories } = await loadComponent("app/web/src/features/content-management/ManagedCategories.tsx");
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
      await waitFor(() => document.querySelector('a[href="/api/auth/github"]'));
      await act(async () => root.render(React.createElement(Categories, { ...props, key: "second" })));
      assert.ok(document.querySelector('button[aria-label="바꾼 분류 수정"]') !== null);
      await act(async () => document.querySelector("#save-all").click());
      await waitFor(() => document.querySelector('a[href="/api/auth/github"]'));
      assert.equal(saves.length, 2);
      assert.deepEqual(saves[1], saves[0]);
      assert.deepEqual(saves[1].operations[0].categories[0].sources, ["original"]);
      assert.deepEqual(saves[1].operations[0].categories[0].custom, { keep: true });
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
  const { usePostDeletion } = await loadComponent("app/web/src/features/content-management/usePostDeletion.ts");
  function Deletion() {
    const deletion = usePostDeletion(ready);
    return React.createElement('button', { id: 'confirm-post-delete', onClick: () => deletion.remove(post) }, 'delete');
  }
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
  async function remove() {
    const button = document.querySelector('#confirm-post-delete');
    assert.ok(button !== null, "the workspace delete dialog retains the saved request");
    await act(async () => button.click());
  }
  try {
    await mounted(React.createElement(Deletion, { key: "first" }), async (root) => {
      await remove();
      await act(async () => root.render(React.createElement(Deletion, { key: "second" })));
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
  const { default: Editor } = await loadComponent("app/web/src/features/content-management/ManagedPostEditor.tsx");
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
      const editable=document.querySelector('.bn-editor[contenteditable="true"]');
      const view=editable.editor.view;
      await act(async()=>{
        view.focus();
        const {from,to}=view.state.selection;
        const handled=view.someProp('handleTextInput',handler=>handler(view,from,to,'/',()=>view.state.tr.insertText('/')));
        if(!handled)view.dispatch(view.state.tr.insertText('/',from,to));
      });
      await waitFor(()=>[...document.querySelectorAll('[role="option"]')].some(item=>item.textContent.includes('이미지')));
      await act(async()=>[...document.querySelectorAll('[role="option"]')].find(item=>item.textContent.includes('이미지')).click());
      const field=document.querySelector('.bn-file-panel input[type="file"], .bn-panel input[type="file"]');
      Object.defineProperty(field, "files", { configurable: true, value: [new dom.window.File(["image"], "foo).png", { type: "image/png" })] });
      await act(async () => {
        field.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
        await Promise.race([
          uploadDone,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Attachment upload timed out")), 3000); }),
        ]);
      });
      await waitFor(()=>JSON.parse(localStorage.getItem('second-brain:canonical-draft:'+id)).markdown.includes('foo%29.png'));
      assert.match(JSON.parse(localStorage.getItem('second-brain:canonical-draft:'+id)).markdown, /!\[foo\)\.png\]\(\.\/foo%29\.png\)/);
    });
  } finally {
    clearTimeout(timer);
    globalThis.fetch = previous;
  }
});

test("writing opens an empty local draft without fetching a GitHub source", { timeout: 10000 }, async () => {
  const previous = globalThis.fetch;
  let sourceReads = 0;
  let submitted;
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/session") return reply(ready);
    if (url === "/api/public?kind=index") {
      return reply({ posts: [post], categories, contentCommit: "b".repeat(40) });
    }
    if (url.startsWith("/api/content?")) {
      sourceReads++;
      return reply({ error: "GitHub source unavailable" }, 503);
    }
    assert.equal(url, "/api/content");
    submitted = JSON.parse(options.body);
    return reply(bulkResponse(submitted,{state:"unchanged"}));
  };
  dom.window.history.replaceState(null, "", "/#/");
  try {
    await mounted(React.createElement(App), async () => {
      await act(async () => document.querySelector("button.header-write").click());
      const deadline = Date.now() + 8000;
      while (!document.querySelector('.bn-editor[contenteditable="true"]')) {
        assert.ok(Date.now() < deadline, "New writing must not wait for a GitHub source");
        await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
      }
      assert.equal(sourceReads, 0, "Blank writing needs no source read");
      assert.equal(document.querySelector('[aria-label="글 제목"]')?.value, "");
      assert.doesNotMatch(document.body.textContent, /원본 수정|원본을 불러오는 중/);
      await act(async () => document.querySelector('[aria-label="글 분류"]').click());
      assert.match(document.querySelector('dialog[aria-label="분류 선택"]')?.textContent ?? "", /기록/);
      await act(async () => {
        const dialog = document.querySelector('dialog[aria-label="분류 선택"]');
        [...dialog.querySelectorAll("button")].find((button) => button.textContent.includes("취소")).click();
      });
      const editable = document.querySelector('.bn-editor[contenteditable="true"]');
      assert.equal(editable.textContent.trim(), "");
      await act(async () => {
        const input = document.querySelector('[aria-label="글 제목"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "새 글");
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => document.querySelector('button[type="submit"]').click());
      await waitFor(() => submitted);
      await waitFor(() => document.querySelector('.publish-status [role="status"]')?.textContent === "변경사항이 없습니다.");
      assert.equal(submitted?.operations[0].type, "post.create");
      assert.equal(submitted.baseCommit, "b".repeat(40));
      assert.equal(submitted.operations[0].document.metadata.title, "새 글");
      assert.match(submitted.operations[0].document.metadata.id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      assert.equal(submitted.operations[0].editor.documentId, submitted.operations[0].document.metadata.id);
    });
  } finally {
    globalThis.fetch = previous;
    localStorage.clear();
  }
});

test("a new records category reaches the writer and is created only when its post is published", { timeout: 10000 }, async () => {
  const previous = globalThis.fetch;
  const mutations = [];
  globalThis.fetch = async (url, options = {}) => {
    if (url === "/api/session") return reply(ready);
    if (url === "/api/public?kind=index") return reply({ posts: [post], categories, contentCommit: "b".repeat(40) });
    if (url === "/api/content?kind=categories") return reply({ categories: categories.map(({ parentId, ...item }) => ({ ...item, parent_id: parentId })), revision: "r", contentCommit: "b".repeat(40) });
    assert.equal(url, "/api/content");
    const input = JSON.parse(options.body);
    mutations.push(input);
    return reply(bulkResponse(input));
  };
  dom.window.history.replaceState(null, "", "/#/records");
  const find = (label) => [...document.querySelectorAll("button")].find(button => button.textContent.trim() === label);
  try {
    await mounted(React.createElement(App), async () => {
      await act(async () => document.querySelector(".records-body").dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
      await act(async () => find("카테고리 추가").click());
      await act(async () => {
        const input = document.querySelector('[name="categoryName"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "새 주제");
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => find("저장").click());
      const category = document.querySelector('[data-record-category][aria-label="새 주제"]');
      assert.ok(category !== null);
      const categoryId = category.dataset.recordCategory;
      await act(async () => category.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
      await act(async () => find("글 추가").click());
      const deadline = Date.now() + 8000;
      while (!document.querySelector('.bn-editor[contenteditable="true"]')) {
        assert.ok(Date.now() < deadline, "new category writer opens");
        await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
      }
      assert.equal(mutations.length, 0, "opening a draft never publishes categories");
      assert.ok(document.querySelector('[aria-label="글 분류"]').textContent.includes("새 주제"));
      await act(async () => {
        const input = document.querySelector('[aria-label="글 제목"]');
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(input, "새 주제의 글");
        input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      });
      await act(async () => document.querySelector('button[type="submit"]').click());
      await waitFor(() => document.querySelector('.publish-status [role="status"]')?.textContent === "게시 완료");
      assert.equal(mutations.length,1,"category and post share one bulk request");
      assert.deepEqual(mutations[0].operations.map(item => item.type), ["categories.save", "post.create"]);
      assert.equal(mutations[0].operations[0].categories.find(item => item.id === categoryId).name, "새 주제");
      assert.equal(mutations[0].operations[1].document.metadata.category_id, categoryId);
      assert.equal(mutations[0].baseCommit, "b".repeat(40));
    });
  } finally { globalThis.fetch = previous; }
});

after(() => dom.window.close());
