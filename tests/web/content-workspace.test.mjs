import assert from "node:assert/strict";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "../support/load-component.mjs";

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: "https://blog.example/#/content", pretendToBeVisual: true,
});
for (const name of ["window", "document", "navigator", "HTMLElement", "Node", "Element", "Event", "MouseEvent", "HTMLInputElement"]) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: BlogView } = await loadComponent("app/web/src/site/BlogView.tsx");
const base = {
  id: "public", title: "공개 제목", markdown: "공개 본문", category: "notes", categoryId: "notes",
  createdAt: "2026-11-01", updatedAt: "2026-11-02", excerpt: "요약", parentId: null, path: "", url: "",
};
const categories = [{ id: "notes", name: "기록", parentId: null, order: 0, sources: [] }];
const management = { session: { state: "ready" }, logout() {}, refresh() {} };
async function mounted(session, run, extra = {}) {
  const root = createRoot(document.getElementById("root"));
  const { strict = false, ...props } = extra;
  try {
    const element = React.createElement(BlogView, {
      posts: [base], categories, hash: "#/content", management: { ...management, session },
      onWrite() {}, onEdit() {}, ...props,
    });
    await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, element) : element));
    await run();
  } finally {
    await act(async () => root.unmount());
    localStorage.clear();
  }
}
async function chooseCategory(id, label) {
  await act(async () => document.querySelector('[aria-label="카테고리 필터"]').click());
  const row = [...document.querySelectorAll('dialog .category-row')].find(row => row.dataset.id === id);
  assert.ok(row !== undefined, "category row must exist: " + id);
  await act(async () => row.querySelector('.row-name').click());
  if (label) assert.ok(row.textContent.includes(label));
  await act(async () => document.querySelector('dialog button[type="submit"]').click());
}
after(() => dom.window.close());

test("content workspace is reachable only after authorization", { timeout: 5000 }, async () => {
  await mounted({ state: "ready" }, async () => {
    assert.ok(document.querySelector('.header-navigation a[href="#/content"]') !== null);
    assert.ok(document.querySelector('.content-workspace') !== null);
    assert.deepEqual([...document.querySelectorAll('.header-navigation a')].map(link => link.textContent.trim()), ['기록 관리', '콘텐츠 관리', '카테고리 관리']);
    assert.ok(document.querySelector('.workspace-header') === null);
    assert.ok(document.querySelector('.wordmark svg') !== null);
    assert.ok(document.querySelector('.workspace-preflight') === null);
    assert.ok(!document.querySelector('main').textContent.includes('YOUR WRITING DESK'));
    assert.match(document.querySelector('.header-write').textContent, /글 쓰기/);
    assert.equal(document.querySelectorAll('[role="tab"]').length, 3);
    assert.ok(!document.querySelector('main').textContent.includes('게시 준비'));
  });
  for (const state of ["signed_out", "checking", "blocked"]) {
    await mounted({ state }, async () => {
      assert.ok(document.querySelector('.header-navigation a[href="#/content"]') === null);
      assert.ok(document.querySelector('.content-workspace') === null);
      assert.match(document.querySelector('main').textContent, /로그인/);
    });
  }
});

test("workspace keeps public content separate from recovery drafts and filters local edits", { timeout: 5000 }, async () => {
  localStorage.setItem('second-brain:canonical-draft:public', JSON.stringify({
    title: '비공개 수정', markdown: '초안 본문', category: 'notes', assets: [], updatedAt: '2026-11-04',
    revision: 'revision', requestId: 'request', sourceDocument: {
      document: { metadata: { id: 'public', title: base.title, category_id: 'notes', tags: [] }, markdown: base.markdown },
      revision: 'revision',
    },
  }));
  const edited = [];
  await mounted({ state: "ready" }, async () => {
    assert.match(document.querySelector('tbody').textContent, /비공개 수정/);
    assert.match(document.querySelector('tbody').textContent, /공개됨/);
    assert.match(document.querySelector('tbody').textContent, /공개되지 않은 수정 사항/);
    await act(async () => document.querySelector('.row-title').click());
    assert.equal(edited[0].id, 'public');
    assert.equal(edited[0].draft, undefined);
    assert.equal(base.title, '공개 제목');
    await act(async () => {
      const input = document.querySelector('input[type="search"]');
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, '초안 본문');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    await act(async () => [...document.querySelectorAll('[role="tab"]')].find(button => button.textContent.includes('초안')).click());
    assert.equal(document.querySelectorAll('tbody tr').length, 0);
  }, { onEdit(post) { edited.push(post); } });
});

test("workspace migrates legacy draft status labels and preserves malformed recovery bytes", { timeout: 5000 }, async () => {
  const draft = { ...base, id: "draft-legacy", draft: true, status: "review", title: "이어 쓸 초안" };
  localStorage.setItem('second-brain:canonical-draft:broken', '{invalid');
  await mounted({ state: "ready" }, async () => {
    assert.match(document.querySelector('tbody').textContent, /이어 쓸 초안/);
    assert.match(document.querySelector('tbody').textContent, /초안 저장/);
    assert.ok(!document.querySelector('tbody').textContent.includes('undefined'));
    assert.equal(localStorage.getItem('second-brain:canonical-draft:broken'), '{invalid');
    assert.ok(document.querySelector('[role="alert"]') !== null);
  }, { posts: [base, draft] });
});

test("confirmed newly published recovery resolves to one public row without removing its backup", { timeout: 5000 }, async () => {
  const key = 'second-brain:canonical-draft:draft-local';
  const bytes = JSON.stringify({
    title: '게시된 초안', markdown: base.markdown, category: 'notes', assets: [],
    publication: { state: 'published' },
    sourceDocument: { document: { metadata: { id: base.id, title: base.title }, markdown: base.markdown } },
  });
  localStorage.setItem(key, bytes);
  await mounted({ state: "ready" }, async () => {
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    assert.match(document.querySelector('tbody').textContent, /공개 제목/);
    assert.ok(!document.querySelector('tbody').textContent.includes('공개되지 않은 수정 사항'));
    assert.equal(localStorage.getItem(key), bytes);
  });
});

test("a published draft keeps its canonical identity and recovery key after further edits", { timeout: 5000 }, async () => {
  const key = 'second-brain:canonical-draft:draft-local';
  const bytes = JSON.stringify({
    canonicalId: base.id,
    title: '게시 뒤 수정한 제목', markdown: '공개되지 않은 새 본문', category: 'notes', assets: [],
    sourceDocument: {
      document: { metadata: { id: base.id, title: base.title, category_id: 'notes', tags: [] }, markdown: base.markdown },
    },
  });
  localStorage.setItem(key, bytes);
  const edited = [];
  await mounted({ state: "ready" }, async () => {
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    assert.match(document.querySelector('tbody').textContent, /게시 뒤 수정한 제목/);
    assert.match(document.querySelector('tbody').textContent, /공개됨/);
    assert.match(document.querySelector('tbody').textContent, /공개되지 않은 수정 사항/);
    await act(async () => document.querySelector('.row-title').click());
    assert.equal(edited[0].id, base.id);
    assert.equal(edited[0].draft, undefined);
    assert.equal(edited[0].recoveryKey, 'draft-local');
    assert.equal(localStorage.getItem(key), bytes);
  }, {
    posts: [base, { ...base, id: 'draft-local', draft: true }],
    onEdit(post) { edited.push(post); },
  });
});


test("workspace pages contain at most fifteen rows and filters restart from page one", { timeout: 5000 }, async () => {
  const posts = Array.from({ length: 47 }, (_, index) => ({
    ...base, id: "item-" + index, title: "항목 " + index,
    categoryId: index < 31 ? "notes" : "other",
    category: index < 31 ? "notes" : "other",
    draft: index >= 31,
  }));
  await mounted({ state: "ready" }, async () => {
    const count = () => document.querySelectorAll('tbody tr').length;
    const next = () => document.querySelector('[aria-label="다음 페이지"]');
    assert.equal(count(), 15);
    assert.equal(document.querySelector('[aria-label="이전 페이지"]').disabled, true);
    await act(async () => next().click());
    assert.equal(count(), 15);
    assert.match(document.querySelector('.workspace-pagination').textContent, /2 \/ 4/);
    await act(async () => next().click());
    await act(async () => next().click());
    assert.equal(count(), 2);
    assert.equal(next().disabled, true);
    await chooseCategory("other", "다른 기록");
    assert.equal(count(), 15);
    assert.match(document.querySelector('.workspace-pagination').textContent, /1 \/ 2/);
    assert.ok([...document.querySelectorAll('tbody tr')].every(row => row.textContent.includes("다른 기록")));
    await act(async () => next().click());
    assert.equal(count(), 1);
    await act(async () => [...document.querySelectorAll('[role="tab"]')].find(button => button.textContent.includes("초안")).click());
    assert.equal(count(), 15);
    await act(async () => next().click());
    const search = document.querySelector('input[type="search"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(search, "항목 46");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(count(), 1);
    assert.match(document.querySelector('.workspace-pagination').textContent, /1 \/ 1/);
    assert.equal(next().disabled, true);
  }, { posts, categories: [...categories, { id: "other", name: "다른 기록", parentId: null, order: 1, sources: [] }] });
});

test("category filters include descendants and preserve the empty state", { timeout: 5000 }, async () => {
  await mounted({ state: "ready" }, async () => {
    async function choose(value) { await chooseCategory(value); }
    await choose("notes");
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
    await act(async () => document.querySelector('[aria-label="카테고리 필터"]').click());
    await act(async () => document.querySelector('[data-id="notes"] .expander').click());
    await act(async () => document.querySelector('[data-id="child"] .row-name').click());
    await act(async () => document.querySelector('dialog button[type="submit"]').click());
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    assert.match(document.querySelector('tbody').textContent, /하위 글/);
    await choose("empty");
    assert.equal(document.querySelectorAll('tbody tr').length, 0);
    assert.ok(document.querySelector('.workspace-empty') !== null);
    assert.equal(document.querySelector('[aria-label="다음 페이지"]').disabled, true);
  }, { posts: [base, { ...base, id: "child-post", title: "하위 글", categoryId: "child" }], categories: [
    ...categories,
    { id: "child", name: "하위", parentId: "notes", order: 1, sources: [] },
    { id: "empty", name: "빈 분류", parentId: null, order: 2, sources: [] },
  ] });
});


test("workspace reuses category dialog and keeps category before search", { timeout: 5000 }, async () => {
  await mounted({ state: "ready" }, async () => {
    const toolbar = document.querySelector('.workspace-toolbar');
    assert.ok(toolbar.firstElementChild.classList.contains('workspace-category-filter'));
    const trigger = document.querySelector('button[aria-label="카테고리 필터"]');
    assert.ok(trigger !== null);
    await act(async () => trigger.click());
    assert.ok(document.querySelector('dialog.category-selection-dialog[open]') !== null);
    const row = [...document.querySelectorAll('dialog .row-name')].find(item => item.textContent.includes('기록'));
    await act(async () => row.click());
    await act(async () => [...document.querySelectorAll('dialog button')].find(item => item.textContent === '취소').click());
    assert.ok(document.querySelector('dialog') === null);
    assert.ok(trigger.textContent.includes('모든 카테고리'), 'cancel cannot change active filter');
    await chooseCategory('notes');
    assert.ok(trigger.textContent.includes('기록'));
    await chooseCategory('');
    assert.ok(trigger.textContent.includes('모든 카테고리'));
  });
});


test("unrecognized legacy categories agree with the unclassified count and filter", { timeout: 5000 }, async () => {
  await mounted({ state: "ready" }, async () => {
    await act(async () => document.querySelector('[aria-label="카테고리 필터"]').click());
    const row = document.querySelector('[data-id="group:unclassified"]');
    assert.equal(row.querySelector('.inline-count').textContent.trim(), '(1)');
    await act(async () => row.querySelector('.row-name').click());
    await act(async () => document.querySelector('dialog button[type="submit"]').click());
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    assert.match(document.querySelector('tbody').textContent, /이전 분류 초안/);
  }, { posts: [base, { ...base, id: 'draft-removed', draft: true, title: '이전 분류 초안', category: 'removed-category', categoryId: 'removed-category' }] });
});


test("category dialog stays open in StrictMode and Escape preserves the filter", { timeout: 5000 }, async () => {
  const previousClose = dom.window.HTMLDialogElement.prototype.close;
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
  try {
    await mounted({ state: 'ready' }, async () => {
      const trigger = document.querySelector('[aria-label="카테고리 필터"]');
      await act(async () => trigger.click());
      const dialog = document.querySelector('dialog');
      assert.ok(dialog !== null && dialog.open, 'StrictMode must not close a newly mounted dialog');
      await act(async () => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
      assert.ok(document.querySelector('dialog') === null);
      assert.ok(trigger.textContent.includes('모든 카테고리'));
    }, { strict: true });
  } finally {
    dom.window.HTMLDialogElement.prototype.close = previousClose;
  }
});

test("double-click confirms the clicked category immediately while expanders stay open", { timeout: 5000 }, async () => {
  await mounted({ state: 'ready' }, async () => {
    const trigger = document.querySelector('[aria-label="카테고리 필터"]');
    await act(async () => trigger.click());
    const parent = document.querySelector('[data-id="notes"]');
    assert.equal(parent.querySelector('.expander').getAttribute('aria-expanded'), 'false');
    assert.ok(document.querySelector('[data-id="child"]') === null);
    await act(async () => parent.querySelector('.expander').click());
    await act(async () => parent.querySelector('.row-name').click());
    assert.ok(document.querySelector('dialog') !== null, 'single click only stages a selection');
    assert.ok(trigger.textContent.includes('모든 카테고리'));
    await act(async () => parent.querySelector('.expander').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
    assert.ok(document.querySelector('dialog') !== null, 'expanding is not confirmation');
    const child = document.querySelector('[data-id="child"]');
    await act(async () => child.querySelector('.inline-count').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
    assert.ok(document.querySelector('dialog') === null);
    assert.ok(trigger.textContent.includes('하위'));
    assert.equal(document.querySelectorAll('tbody tr').length, 1);
    await act(async () => trigger.click());
    assert.ok(document.querySelector('[data-id="child"]') === null, 'reopening collapses all branches');
    await act(async () => document.querySelector('[data-id=""] .row-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
    assert.ok(document.querySelector('dialog') === null);
    assert.ok(trigger.textContent.includes('모든 카테고리'));
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
    await act(async () => trigger.click());
    await act(async () => document.querySelector('[data-id="notes"] .grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
    assert.ok(document.querySelector('dialog') === null);
    assert.ok(trigger.textContent.includes('기록'));
    assert.equal(document.querySelectorAll('tbody tr').length, 2);
  }, { posts: [base, { ...base, id: 'child-post', title: '하위 글', categoryId: 'child' }], categories: [
    ...categories, { id: 'child', name: '하위', parentId: 'notes', order: 1, sources: [] },
  ] });
});


const deletionSource = {
  document: { metadata: { id: base.id, title: base.title }, markdown: base.markdown },
  revision: "a".repeat(64), editorRevision: "c".repeat(64), contentCommit: "b".repeat(40),
  categories: [], assets: [],
};
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });

test("post deletion waits for modal confirmation and removes canonical source plus recovery", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const saved = [];
  localStorage.setItem('second-brain:canonical-draft:public', JSON.stringify({
    title: base.title, markdown: base.markdown, category: 'notes',
    sourceDocument: deletionSource,
  }));
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    if (!options.method) return response(deletionSource);
    return response({ state: 'published', requestId: JSON.parse(options.body).requestId, contentCommit: 'd'.repeat(40) });
  };
  try {
    await mounted({ state: 'ready', csrfToken: 'csrf' }, async () => {
      const trigger = document.querySelector('[aria-label="공개 제목 삭제"]');
      assert.ok(trigger !== null, 'workspace exposes deletion');
      await act(async () => trigger.click());
      const modal = document.querySelector('dialog[open][aria-labelledby="post-delete-title"]');
      assert.ok(modal !== null, 'deletion uses a modal');
      assert.match(modal.textContent, /원본.*첨부/);
      assert.equal(calls.length, 0, 'opening the dialog performs no repository work');
      await act(async () => [...modal.querySelectorAll('button')].find(button => button.textContent === '취소').click());
      assert.equal(calls.length, 0);
      await act(async () => trigger.click());
      await act(async () => document.querySelector('#confirm-post-delete').click());
      assert.equal(calls.length, 2);
      const payload = JSON.parse(calls[1].body);
      assert.equal(payload.operation.type, 'post.delete');
      assert.equal(payload.operation.id, 'public');
      assert.equal(payload.operation.baseRevision, 'a'.repeat(64));
      assert.equal(payload.operation.baseEditorRevision, 'c'.repeat(64));
      assert.equal(payload.baseCommit, 'b'.repeat(40));
      assert.equal(calls[1].headers['x-csrf-token'], 'csrf');
      assert.equal(localStorage.getItem('second-brain:canonical-draft:public'), null);
      assert.equal(document.querySelectorAll('tbody tr').length, 0);
      assert.deepEqual(saved, ['d'.repeat(40)]);
    }, { onContentSaved(commit) { saved.push(commit); } });
  } finally { globalThis.fetch = originalFetch; }
});

test("failed deletion preserves content and retries identical request after reopening", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  let reads = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method) { reads++; return response(deletionSource); }
    requests.push(options.body);
    if (requests.length === 1) throw Error('response lost');
    return response({ state: 'published', requestId: JSON.parse(options.body).requestId, contentCommit: 'd'.repeat(40) });
  };
  try {
    await mounted({ state: 'ready' }, async () => {
      async function open() { await act(async () => document.querySelector('[aria-label="공개 제목 삭제"]').click()); }
      await open();
      await act(async () => document.querySelector('#confirm-post-delete').click());
      assert.equal(document.querySelectorAll('tbody tr').length, 1);
      assert.match(document.querySelector('[role="alert"]').textContent, /response lost/);
      assert.ok(document.querySelector('dialog') === null);
      await open();
      await act(async () => document.querySelector('#confirm-post-delete').click());
      assert.equal(reads, 1, 'retry must work even after the source disappears');
      assert.equal(requests.length, 2);
      assert.equal(requests[1], requests[0]);
      assert.equal(document.querySelectorAll('tbody tr').length, 0);
    });
  } finally { globalThis.fetch = originalFetch; }
});

test("local-only draft deletion clears stored draft without a canonical request", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('unexpected request'); };
  const draft = { ...base, id: 'draft-local', title: '로컬 초안', draft: true, blocks: [] };
  localStorage.setItem('second-brain:drafts:v1', JSON.stringify([draft]));
  localStorage.setItem('second-brain:canonical-draft:draft-local', JSON.stringify({
    title: draft.title, markdown: draft.markdown, category: 'notes', sourceDocument: deletionSource,
  }));
  try {
    await mounted({ state: 'ready' }, async () => {
      const trigger = document.querySelector('[aria-label="로컬 초안 삭제"]');
      assert.ok(trigger !== null);
      await act(async () => trigger.click());
      await act(async () => document.querySelector('#confirm-post-delete').click());
      assert.equal(calls, 0);
      assert.equal(localStorage.getItem('second-brain:canonical-draft:draft-local'), null);
      assert.deepEqual(JSON.parse(localStorage.getItem('second-brain:drafts:v1')), []);
      assert.equal(document.querySelectorAll('tbody tr').length, 1);
    }, { posts: [base, draft] });
  } finally { globalThis.fetch = originalFetch; }
});

test("a newly published recovery deletes its canonical identity before the index catches up", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  const sent = [];
  localStorage.setItem('second-brain:canonical-draft:draft-local', JSON.stringify({
    title: '새로 공개한 글', markdown: base.markdown, category: 'notes',
    publication: { state: 'published' }, sourceDocument: deletionSource,
  }));
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method) return response(deletionSource);
    sent.push(JSON.parse(options.body));
    return response({ state: 'published', requestId: sent[0].requestId, contentCommit: 'd'.repeat(40) });
  };
  try {
    await mounted({ state: 'ready' }, async () => {
      const trigger = document.querySelector('[aria-label="새로 공개한 글 삭제"]');
      assert.ok(trigger !== null);
      await act(async () => trigger.click());
      await act(async () => document.querySelector('#confirm-post-delete').click());
      assert.equal(sent.length, 1, 'an accepted original must not be treated as a local-only draft');
      assert.equal(sent[0].operation.id, 'public');
      assert.equal(localStorage.getItem('second-brain:canonical-draft:draft-local'), null);
      assert.equal(document.querySelectorAll('tbody tr').length, 0);
    }, { posts: [] });
  } finally { globalThis.fetch = originalFetch; }
});

test("delete confirmation closes and hides the row before the background response", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  let release;
  let writes = 0;
  const pending = new Promise(resolve => { release = resolve; });
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method) return response(deletionSource);
    writes++;
    await pending;
    return response({ state: 'published', requestId: JSON.parse(options.body).requestId, contentCommit: 'd'.repeat(40) });
  };
  try {
    await mounted({ state: 'ready' }, async () => {
      await act(async () => document.querySelector('[aria-label="공개 제목 삭제"]').click());
      const confirm = document.querySelector('#confirm-post-delete');
      await act(async () => { confirm.click(); confirm.click(); });
      assert.ok(document.querySelector('dialog') === null);
      assert.equal(document.querySelectorAll('tbody tr').length, 0);
      assert.equal(writes, 1);
      await act(async () => release());
      assert.equal(document.querySelectorAll('tbody tr').length, 0);
    });
  } finally { release(); globalThis.fetch = originalFetch; }
});

test("background deletion failure restores the row and its recovery and announces the error", { timeout: 5000 }, async () => {
  const originalFetch = globalThis.fetch;
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const recovery = JSON.stringify({ title: base.title, markdown: base.markdown, sourceDocument: deletionSource });
  localStorage.setItem('second-brain:canonical-draft:public', recovery);
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method) return response(deletionSource);
    await pending;
    return response({ error: 'offline' }, 503);
  };
  try {
    await mounted({ state: 'ready' }, async () => {
      await act(async () => document.querySelector('[aria-label="공개 제목 삭제"]').click());
      await act(async () => document.querySelector('#confirm-post-delete').click());
      assert.ok(document.querySelector('dialog') === null);
      assert.equal(document.querySelectorAll('tbody tr').length, 0);
      await act(async () => release());
      assert.equal(document.querySelectorAll('tbody tr').length, 1);
      assert.match(document.querySelector('[role="alert"]').textContent, /공개 제목.*offline/);
      assert.equal(localStorage.getItem('second-brain:canonical-draft:public'), recovery);
    });
  } finally { release(); globalThis.fetch = originalFetch; }
});
