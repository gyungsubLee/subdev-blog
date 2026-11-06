import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPublicE2EServer } from '../support/public-e2e-server.mjs';
import { ID } from '../support/public-repository.mjs';
import { runPublicPublication } from '../../app/content/scripts/publish-public-content.mjs';

test('HTTP category lifecycle preserves saved-state revisions, moved posts and idempotent deletion', { timeout: 30000 }, async t => {
  const app = await createPublicE2EServer();
  t.after(() => app.close());
  const login = await fetch(app.origin + '/__e2e/login', {
    redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  async function call(path, payload) {
    const response = await fetch(app.origin + '/api/' + path, {
      method: payload ? 'POST' : 'GET',
      headers: { cookie, Origin: app.origin, 'x-csrf-token': 'e2e-csrf', 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, data: await response.json() };
  }
  async function save(source, operation) {
    const result = await call('content', {
      requestId: randomUUID(), baseCommit: source.contentCommit, operation,
    });
    assert.equal(result.status, 200, result.data.error);
    assert.equal(result.data.state, 'saved');
    return result.data;
  }
  const readCategories = async () => {
    const result = await call('content?kind=categories&refresh=1');
    assert.equal(result.status, 200, result.data.error);
    return result.data;
  };

  let source = await readCategories();
  await save(source, {
    type: 'categories.save', baseRevision: source.revision,
    categories: [...source.categories,
      { id: 'audit-parent', name: 'Parent', parent_id: null, order: 1 },
      { id: 'audit-child', name: 'Child', parent_id: 'audit-parent', order: 0 },
    ],
  });
  source = await readCategories();
  const protectedDelete = await call('content', {
    requestId: randomUUID(), baseCommit: source.contentCommit,
    operation: { type: 'category.delete', id: 'audit-parent', mode: 'move', baseRevision: source.revision },
  });
  assert.equal(protectedDelete.status, 409, 'a parent with child categories must remain protected');
  assert.equal(app.f.refs.get('main'), source.contentCommit);
  await save(source, {
    type: 'categories.save', baseRevision: source.revision,
    categories: source.categories.map(category => category.id === 'audit-child'
      ? { ...category, name: 'Renamed child', parent_id: null } : category),
  });

  source = await readCategories();
  const id = randomUUID();
  await save(source, {
    type: 'post.create', document: {
      metadata: { schema_version: 1, id, title: 'Category lifecycle', parent_id: null,
        category_id: 'audit-child', created: '2026-11-07', updated: '2026-11-07' },
      markdown: 'Preserve this body while moving categories.',
    },
  });
  source = await readCategories();
  const moved = await save(source, {
    type: 'category.delete', id: 'audit-child', mode: 'move', baseRevision: source.revision,
  });
  assert.deepEqual(moved.affectedPostIds, [id]);
  assert.deepEqual(moved.deletedPostIds, []);
  const movedPost = await call('content?kind=post&id=' + id);
  assert.equal(movedPost.data.document.metadata.category_id, 'group:unclassified');
  assert.equal(movedPost.data.document.markdown, 'Preserve this body while moving categories.');

  const fresh = await readCategories();
  assert.notEqual(fresh.revision, source.revision);
  assert.equal(fresh.contentCommit, moved.contentCommit);
  assert.equal(fresh.categories.some(category => category.id === 'audit-child'), false);
  const stale = await call('content', {
    requestId: randomUUID(), baseCommit: fresh.contentCommit,
    operation: { type: 'categories.save', baseRevision: source.revision, categories: fresh.categories },
  });
  assert.equal(stale.status, 409);
  assert.equal(app.f.refs.get('main'), fresh.contentCommit);
  await save(fresh, {
    type: 'categories.save', baseRevision: fresh.revision,
    categories: fresh.categories.map(category => category.id === 'audit-parent'
      ? { ...category, name: 'Renamed after deletion' } : category),
  });
  const post = await call('content?kind=post&id=' + id);
  await save(post.data, {
    type: 'post.update', id, baseRevision: post.data.revision,
    changes: { category_id: 'audit-parent' },
  });
  source = await readCategories();
  const payload = {
    requestId: randomUUID(), baseCommit: source.contentCommit,
    operation: { type: 'category.delete', id: 'audit-parent', mode: 'delete', baseRevision: source.revision },
  };
  const deleted = await call('content', payload);
  assert.equal(deleted.status, 200, deleted.data.error);
  assert.equal(deleted.data.state, 'saved');
  assert.deepEqual(deleted.data.deletedPostIds, [id]);
  const count = app.f.commits.size;
  const retry = await call('content', payload);
  assert.equal(retry.status, 200, retry.data.error);
  assert.equal(retry.data.contentCommit, deleted.data.contentCommit);
  assert.equal(app.f.commits.size, count, 'retry must not create another commit');
  assert.equal((await call('content?kind=post&id=' + id)).status, 404);
  assert.equal((await call('content?kind=post&id=' + ID)).status, 200);
  await runPublicPublication(['--commit', deleted.data.contentCommit, '--publish'], { env: {}, fetcher: app.gateway });
  const published = await call('public?kind=index&after=' + deleted.data.contentCommit);
  assert.equal(published.status, 200, published.data.error);
  assert.deepEqual(published.data.posts.map(item => item.id), [ID]);
  assert.equal(published.data.categories.some(category => category.id.startsWith('audit-')), false);
});
