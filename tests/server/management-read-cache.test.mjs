import test from 'node:test';
import assert from 'node:assert/strict';
import { createManagementGitHubClient } from '../../app/server/src/management-read-cache.mjs';

const config = { content: { owner: 'owner', repo: 'content', branch: 'main' } };
const path = '/repos/owner/content/git/blobs/' + 'a'.repeat(40);

test('immutable management reads share concurrent work and reuse completed data', { timeout: 5000 }, async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    await new Promise(resolve => setImmediate(resolve));
    return Response.json({ content: 'e30=', encoding: 'base64' });
  };
  const first = createManagementGitHubClient('token', config, fetcher);
  const second = createManagementGitHubClient('token', config, fetcher);
  const values = await Promise.all([first(path), second(path)]);
  assert.equal(values[0].content, 'e30=');
  assert.equal(values[1].content, 'e30=');
  assert.equal((await second(path)).encoding, 'base64');
  assert.equal(calls, 1);
});

test('mutable permissions and branch refs are never cached; writes always execute', { timeout: 5000 }, async () => {
  let calls = 0;
  const github = createManagementGitHubClient('token', config, async () => Response.json({ sequence: ++calls }));
  for (const mutablePath of ['/user', '/user/installations', '/repos/owner/content', '/repos/owner/content/git/ref/heads/main']) {
    const first = await github(mutablePath);
    assert.equal((await github(mutablePath)).sequence, first.sequence + 1);
  }
  const first = await github(path, { method: 'POST', body: {} });
  assert.equal((await github(path, { method: 'POST', body: {} })).sequence, first.sequence + 1);
});

test('management cache isolates tokens, configurations, fetchers and immutable revisions', { timeout: 5000 }, async () => {
  let calls = 0;
  const fetcher = async () => Response.json({ sequence: ++calls });
  const first = createManagementGitHubClient('first', config, fetcher);
  assert.equal((await first(path)).sequence, 1);
  assert.equal((await createManagementGitHubClient('second', config, fetcher)(path)).sequence, 2);
  assert.equal((await createManagementGitHubClient('first', { content: { ...config.content, branch: 'other' } }, fetcher)(path)).sequence, 3);
  assert.equal((await first(path.replace(/a{40}$/, 'b'.repeat(40)))).sequence, 4);
  assert.equal((await createManagementGitHubClient('first', config, async () => Response.json({ sequence: 99 }))(path)).sequence, 99);
  assert.equal((await first(path)).sequence, 1);
});

test('failed immutable reads are not retained and can recover', { timeout: 5000 }, async () => {
  let fail = true;
  const github = createManagementGitHubClient('token', config, async () => {
    if (fail) return Response.json({}, { status: 404 });
    return Response.json({ recovered: true });
  });
  await assert.rejects(github(path), { status: 404 });
  fail = false;
  assert.equal((await github(path)).recovered, true);
});

test('entry, byte and configuration limits evict cached management data', { timeout: 10000 }, async () => {
  let calls = 0;
  const fetcher = async url => Response.json({
    sequence: ++calls,
    padding: url.includes('/git/commits/') ? 'x'.repeat(2 * 1024 * 1024) : '',
  });
  const github = createManagementGitHubClient('token', config, fetcher);
  const first = (await github(path)).sequence;
  for (let i = 0; i < 33; i++) {
    await github('/repos/owner/content/git/blobs/' + i.toString(16).padStart(40, '0'));
  }
  assert.ok((await github(path)).sequence > first, 'Old entries must be evicted');
  const beforeBytes = (await github(path)).sequence;
  for (let i = 0; i < 3; i++) {
    await github('/repos/owner/content/git/commits/' + i.toString(16).padStart(40, '0'));
  }
  assert.ok((await github(path)).sequence > beforeBytes, 'Old data must be evicted by byte size');
  const beforeConfigurations = (await github(path)).sequence;
  for (let i = 0; i < 4; i++) {
    await createManagementGitHubClient('token-' + i, config, fetcher)(path);
  }
  assert.ok((await createManagementGitHubClient('token', config, fetcher)(path)).sequence > beforeConfigurations);
});
