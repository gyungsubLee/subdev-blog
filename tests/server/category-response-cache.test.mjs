import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../../app/server/src/handler.mjs';
import { createManagementCategoryFixture } from '../support/management-category-fixture.mjs';

async function read(f, path = '/api/content?kind=categories') {
  const response = await handleRequest(f.request(path), f);
  return { status: response.status, value: await response.json() };
}

test('repeat and concurrent category reads reuse validated data with zero external requests', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture({ latencyMs: 5 });
  const results = await Promise.all([read(f), read(f), read(f)]);
  assert.ok(results.every(result => result.status === 200));
  assert.equal(f.calls.length, 1, 'Concurrent reads share a single download');
  f.reset();
  const again = await read(f);
  assert.equal(again.value.categories[0].name, 'Other');
  assert.equal(f.calls.length, 0, 'Repeat reads must use the cached response, not redownload');
});

test('explicit latest-source refresh replaces the cache without a HEAD request', async () => {
  const f = createManagementCategoryFixture();
  assert.equal((await read(f)).value.contentCommit, 'a'.repeat(40));
  f.controls.head = 'd'.repeat(40);
  f.reset();
  assert.equal((await read(f)).value.contentCommit, 'a'.repeat(40));
  assert.equal(f.calls.length, 0);
  assert.equal((await read(f, '/api/content?kind=categories&refresh=1')).value.contentCommit, 'd'.repeat(40));
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, '/graphql');
  f.reset();
  assert.equal((await read(f)).value.contentCommit, 'd'.repeat(40));
  assert.equal(f.calls.length, 0);
});
