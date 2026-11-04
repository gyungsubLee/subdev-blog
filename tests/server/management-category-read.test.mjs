import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../../app/server/src/handler.mjs';
import { createManagementCategoryFixture } from '../support/management-category-fixture.mjs';

async function read(fixture, path) {
  const response = await handleRequest(fixture.request(path), fixture);
  return { status: response.status, cacheControl: response.headers.get('cache-control'), value: await response.json() };
}

test('category reads reuse immutable data but recheck identity, grants, permissions and branch', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const first = await read(f);
  assert.equal(first.status, 200);
  assert.equal(first.value.categories[0].name, 'Other');
  assert.equal(first.value.contentCommit, 'a'.repeat(40));
  assert.equal(first.cacheControl, 'no-store');
  assert.equal(f.calls.some(call => call.path.includes('recursive=1')), false);
  assert.ok(f.maxActive > 1, 'Independent readiness checks must run concurrently');
  f.reset();
  const second = await read(f);
  assert.equal(second.status, 200);
  assert.equal(second.value.revision, first.value.revision);
  assert.equal(f.calls.length, 7, 'Only fresh authorization and current branch checks remain');
  for (const suffix of ['/user', '/user/installations', '/user/installations/12/repositories',
    '/repos/gyungsubLee/subdev-blog', '/repos/gyungsubLee/subdev-blog-content',
    '/repos/gyungsubLee/subdev-blog/branches/main', '/repos/gyungsubLee/subdev-blog-content/branches/main']) {
    assert.equal(f.calls.filter(call => call.path === suffix).length, 1, suffix);
  }
});

test('a warm cache never bypasses revoked identity, repository access or suspended installation', { timeout: 5000 }, async () => {
  for (const [key, value] of [['userId', 99], ['push', false], ['suspended', true]]) {
    const f = createManagementCategoryFixture();
    assert.equal((await read(f)).status, 200);
    f.controls[key] = value;
    f.reset();
    const denied = await read(f);
    assert.equal(denied.status, 403, key);
    assert.equal(denied.value.categories, undefined, key);
    assert.equal(f.calls.some(call => call.path.includes('/git/')), false, key);
  }
});

test('changed content head invalidates category lookup even if category bytes are unchanged', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const first = await read(f);
  f.controls.head = 'd'.repeat(40);
  f.reset();
  const next = await read(f);
  assert.equal(next.status, 200);
  assert.equal(next.value.contentCommit, 'd'.repeat(40));
  assert.equal(next.value.revision, first.value.revision);
  assert.ok(f.calls.some(call => call.path.endsWith('/git/commits/' + 'd'.repeat(40))));
  assert.ok(f.calls.some(call => call.path.endsWith('/git/trees/' + 'e'.repeat(40))));
});

test('session checks can seed immutable lookup data without caching authorization', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const session = await read(f, '/api/session');
  assert.equal(session.value.state, 'ready');
  f.reset();
  assert.equal((await read(f)).status, 200);
  assert.equal(f.calls.length, 10, 'First category read after session adds three Git object reads');
  assert.equal(f.calls.some(call => call.path.includes('/contents/')), false);
});

test('direct file lookup preserves rejection of symlink and executable category files', { timeout: 5000 }, async () => {
  for (const mode of ['120000', '100755']) {
    const f = createManagementCategoryFixture();
    f.controls.mode = mode;
    const response = await read(f);
    assert.equal(response.status, 409, mode);
    assert.equal(response.value.categories, undefined, mode);
  }
});
