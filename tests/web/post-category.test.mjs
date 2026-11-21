import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { loadComponent } from '../support/load-component.mjs';
import { syncStore } from '../support/memory-sync-store.mjs';
import { payloadHash } from '../../app/web/src/features/content-management/sync-core.mjs';

const dom = new JSDOM('', { url: 'https://blog.test' });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
const service = await loadComponent('tests/support/post-category.mjs');
after(() => dom.window.close());
const session = { state: 'ready', user: { id: 42 }, csrfToken: 'csrf' };
const source = {
  document: { metadata: { id: 'p', title: 'Original title', category_id: 'old' }, markdown: 'Original body' },
  revision: 'a'.repeat(64), editorRevision: 'c'.repeat(64), contentCommit: 'b'.repeat(40),
  categories: [{ id: 'new', name: 'New', parent_id: null, order: 0, sources: [] }], assets: [],
};

test('a scoped source read cannot overwrite a draft created by another tab while loading', { timeout: 5000 }, async () => {
  const previousFetch = globalThis.fetch;
  const key = 'second-brain:canonical-draft:p';
  const bytes = JSON.stringify({ title: 'Keep this edit', markdown: 'Keep this body' });
  globalThis.fetch = async url => {
    assert.equal(new URL(url, 'https://blog.test').searchParams.get('scope'), 'single');
    localStorage.setItem(key, bytes);
    return Response.json(source);
  };
  try {
    await assert.rejects(service.changePostCategory({ id: 'p' }, 'new', session));
    assert.equal(localStorage.getItem(key), bytes);
  } finally {
    globalThis.fetch = previousFetch;
    localStorage.clear();
  }
});

test('category changes save only classification, reuse recovery, and preserve other unpublished edits', { timeout: 5000 }, async () => {
  const previousFetch = globalThis.fetch;
  const key = 'second-brain:canonical-draft:p';
  const sent = [];
  localStorage.setItem(key, JSON.stringify({
    title: 'Unsaved title', markdown: 'Unsaved body', category: 'old', requestId: 'local-edit', sourceDocument: source,
  }));
  globalThis.fetch = async (url, options = {}) => {
    assert.equal(url, '/api/content', 'the retained source avoids another GET');
    const payload = JSON.parse(options.body);
    sent.push(payload);
    return Response.json({ state: 'published', requestId: payload.requestId, contentCommit: 'd'.repeat(40),
      receipt: { requestId: payload.requestId, payloadHash: await payloadHash(payload), contentCommit: 'd'.repeat(40) },
      categories: { categories: source.categories, revision: 'e'.repeat(64), contentCommit: 'd'.repeat(40) },
      sources: { p: { revision: 'f'.repeat(64), editorRevision: source.editorRevision,
        contentCommit: 'd'.repeat(40), updatedAt: '2026-11-15' } },
    });
  };
  try {
    await service.changePostCategory({ id: 'p' }, 'new', session);
    const deadline = Date.now() + 3000;
    while (!(await syncStore.read(service.syncScope(session))).history.some(batch => batch.applied)) {
      assert.ok(Date.now() < deadline, 'category receipt deadline');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(sent.length, 1);
    const operation = sent[0].operations[0];
    assert.deepEqual(operation.changes, { category_id: 'new' });
    assert.equal(operation.markdown, undefined);
    assert.equal(operation.editor, undefined);
    assert.equal(operation.baseEditorRevision, 'c'.repeat(64));
    const saved = JSON.parse(localStorage.getItem(key));
    assert.equal(saved.title, 'Unsaved title');
    assert.equal(saved.markdown, 'Unsaved body');
    assert.equal(saved.category, 'new');
    assert.equal(saved.sourceDocument.document.metadata.title, 'Original title');
    assert.equal(saved.sourceDocument.document.metadata.category_id, 'new');
    assert.equal(saved.publication, undefined, 'other local edits remain unpublished');
  } finally {
    service.stopContentSync();
    globalThis.fetch = previousFetch;
    localStorage.clear();
  }
});

test('a category overlay keeps an unloaded body eligible for its full-body read', { timeout: 5000 }, async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('unexpected read'); };
  localStorage.setItem('second-brain:canonical-draft:p', JSON.stringify({
    title: 'Original title', markdown: 'Original body', category: 'old', sourceDocument: source,
  }));
  try {
    await service.changePostCategory({ id: 'p' }, 'new', session);
    const index = await service.overlayContent({ posts: [{ id: 'p', markdown: '', bodyLoaded: false }], categories: [], contentCommit: source.contentCommit });
    assert.equal(index.posts[0].bodyLoaded, false);
    assert.equal(index.posts[0].categoryId, 'new');
  } finally {
    service.stopContentSync();
    globalThis.fetch = previousFetch;
    localStorage.clear();
  }
});
