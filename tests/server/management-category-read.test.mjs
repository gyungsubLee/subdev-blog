import test from 'node:test';
import assert from 'node:assert/strict';
import { handleContentRequest } from '../../app/server/src/content.mjs';
import { loadConfig } from '../../app/server/src/auth.mjs';
import { handleRequest } from '../../app/server/src/handler.mjs';
import { createManagementCategoryFixture } from '../support/management-category-fixture.mjs';

async function read(fixture, path) {
  const response = await handleRequest(fixture.request(path), fixture);
  return { status: response.status, cacheControl: response.headers.get('cache-control'), value: await response.json() };
}

test('category reads fetch fresh file data without authorization or HEAD queries', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const first = await read(f);
  assert.equal(first.status, 200);
  assert.equal(first.value.categories[0].name, 'Other');
  assert.equal(first.value.contentCommit, 'a'.repeat(40));
  assert.equal(first.cacheControl, 'no-store');
  assert.equal(f.calls.some(call => call.path.includes('recursive=1')), false);
  assert.equal(f.calls.some(call => call.path.startsWith('/user')), false);
  f.reset();
  const second = await read(f);
  assert.equal(second.status, 200);
  assert.equal(second.value.revision, first.value.revision);
  assert.equal(f.calls.length, 0, 'Repeat reads reuse validated data without a network request');
});

test('content access failures remain visible even with a valid authorized session', { timeout: 5000 }, async () => {
  for (const status of [401, 403]) {
    const f = createManagementCategoryFixture();
    assert.equal((await read(f)).status, 200);
    const upstream = f.fetcher;
    f.fetcher = async (url, options) => new URL(url).pathname === '/graphql'
      ? Response.json({ message: 'revoked' }, { status }) : upstream(url, options);
    const denied = await read(f);
    assert.equal(denied.status, status);
    assert.equal(denied.value.categories, undefined);
  }
});

test('changed content head invalidates category lookup even if category bytes are unchanged', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const first = await read(f);
  f.controls.head = 'd'.repeat(40);
  f.reset();
  const next = await read(f, '/api/content?kind=categories&refresh=1');
  assert.equal(next.status, 200);
  assert.equal(next.value.contentCommit, 'd'.repeat(40));
  assert.equal(next.value.revision, first.value.revision);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, '/graphql');
});

test('session checks use no GitHub requests and content reads independently load current data', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const session = await read(f, '/api/session');
  assert.equal(session.value.state, 'ready');
  assert.equal(f.calls.length, 0);
  f.reset();
  assert.equal((await read(f)).status, 200);
  assert.equal(f.calls.length, 1, 'First category read fetches file data directly');
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


test('category reads fetch file data once without a HEAD request, including with a stale connection', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const result = await read(f);
  assert.equal(result.status, 200);
  assert.equal(result.value.categories[0].name, 'Other');
  assert.equal(f.calls.length, 1, 'One data query must replace HEAD and Git-object traversal');
  assert.equal(f.calls[0].path, '/graphql');
  assert.equal(f.calls.some(call => call.path.includes('/git/ref/')), false);
  f.controls.head = 'd'.repeat(40);
  const next = await handleContentRequest(f.request('/api/content?kind=categories&refresh=1'), {
    token: 'diagnostic-only', config: loadConfig(f.env), fetcher: f.fetcher,
    connection: { contentCommit: 'a'.repeat(40) },
  });
  assert.equal((await next.json()).contentCommit, 'd'.repeat(40));
});

test('category query rejects upstream errors, unsafe files and incomplete text without disclosing details', async () => {
  for (const [payload, status] of [
    [{ errors: [{ type: 'UNAUTHORIZED', message: 'private detail' }] }, 401],
    [{ errors: [{ type: 'FORBIDDEN', message: 'private detail' }] }, 403],
    [{ errors: [{ type: 'NOT_FOUND', message: 'private detail' }] }, 404],
    [{ data: { repository: { object: { oid: 'a'.repeat(40), file: null } } } }, 409],
    [{ data: { repository: { object: { oid: 'a'.repeat(40), file: { type: 'blob', mode: 33188, object: { text: '[]', byteSize: 100, isBinary: false } } } } } }, 502],
    [{ data: { repository: { object: { oid: 'a'.repeat(40), file: { type: 'blob', mode: 33188, object: { text: null, byteSize: 5, isBinary: true } } } } } }, 502],
  ]) {
    const f = createManagementCategoryFixture();
    f.fetcher = async () => Response.json(payload);
    const result = await read(f);
    assert.equal(result.status, status);
    assert.equal(result.value.categories, undefined);
    assert.equal(JSON.stringify(result.value).includes('private detail'), false);
  }
});
