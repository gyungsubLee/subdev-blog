import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { ensurePublicPublication, generatePublicFiles } from '../../app/server/src/public-publication.mjs';
import { MAX_PUBLIC_FILE } from '../../app/server/src/public-files.mjs';
import { publicRepository, ID, A, B, REPOSITORY, document } from '../support/public-repository.mjs';

const options = (fixture, commit = A) => ({
  commit,
  repository: REPOSITORY,
  github: fixture.github,
  fetcher: fixture.fetcher,
});

async function seedPublication(fixture, cache) {
  const files = await generatePublicFiles(options(fixture));
  const manifest = JSON.parse(files.get('manifest.json'));
  const cacheBytes = Buffer.from(JSON.stringify(cache));
  const uploadedCache = await fixture.github('/git/blobs', {
    method: 'POST', body: { content: cacheBytes.toString('utf8'), encoding: 'utf-8' },
  });
  manifest.files['generation.json'] = { sha: uploadedCache.sha, size: cacheBytes.length };
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));

  const tree = [{ path: 'generation.json', mode: '100644', type: 'blob', sha: uploadedCache.sha }];
  for (const [path, bytes] of files) {
    if (path === 'generation.json') continue;
    const blob = await fixture.github('/git/blobs', {
      method: 'POST', body: { content: bytes.toString('utf8'), encoding: 'utf-8' },
    });
    tree.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const uploadedTree = await fixture.github('/git/trees', { method: 'POST', body: { tree } });
  const artifact = await fixture.github('/git/commits', {
    method: 'POST', body: { message: 'public-data:' + A, tree: uploadedTree.sha, parents: [] },
  });
  await fixture.github('/git/refs', {
    method: 'POST', body: { ref: 'refs/heads/public-data/' + A, sha: artifact.sha },
  });
  fixture.addSource(B, { [`posts/${ID}/Title.md`]: document('Changed body') });
  fixture.commits.get(B).parents = [{ sha: A }];
  fixture.refs.set('main', B);
  fixture.calls.length = 0;
}

const invalidCaches = [
  {
    name: 'noncanonical base64',
    data: gzipSync(Buffer.from('{}')).toString('base64') + '!',
    message: 'Invalid generation cache encoding',
  },
  {
    name: 'malformed gzip',
    data: Buffer.from('not a gzip stream').toString('base64'),
    message: 'Invalid compressed generation cache',
  },
  {
    name: 'invalid decoded JSON',
    data: gzipSync(Buffer.from('not JSON')).toString('base64'),
    message: 'Invalid public content JSON',
  },
];

for (const { name, data, message } of invalidCaches) {
  test(`a verified cache with ${name} fails before any new publication write`, { timeout: 5000 }, async () => {
    const fixture = publicRepository();
    await seedPublication(fixture, { version: 2, encoding: 'gzip+base64', data });

    await assert.rejects(ensurePublicPublication(options(fixture, B)), error => {
      assert.equal(error.status, 502);
      assert.equal(error.message, message);
      return true;
    });
    assert.equal(fixture.refs.has('public-data/' + B), false);
    assert.ok(fixture.calls.every(call => call.method === 'GET'), 'Invalid cache must fail before a write');
  });
}

test('a verified compressed cache cannot decode beyond the public file limit', { timeout: 5000 }, async () => {
  const fixture = publicRepository();
  const oversized = gzipSync(Buffer.alloc(MAX_PUBLIC_FILE + 1, 32));
  await seedPublication(fixture, { version: 2, encoding: 'gzip+base64', data: oversized.toString('base64') });

  await assert.rejects(ensurePublicPublication(options(fixture, B)), error => {
    assert.equal(error.status, 502);
    assert.equal(error.message, 'Invalid compressed generation cache');
    return true;
  });
  assert.equal(fixture.refs.has('public-data/' + B), false);
  assert.ok(fixture.calls.every(call => call.method === 'GET'), 'Oversized decoded cache must fail before a write');
});

test('a wrong concurrent blob SHA drains active uploads and never publishes a ready ref', { timeout: 10000 }, async () => {
  const other = '22345678-1234-1234-1234-123456789abc';
  const third = '32345678-1234-1234-1234-123456789abc';
  const largeBody = '"'.repeat(1100000);
  const fixture = publicRepository({
    [`posts/${ID}/Title.md`]: document(largeBody),
    [`posts/${other}/Other.md`]: document(largeBody, { title: 'Other' }, other),
    [`posts/${third}/Third.md`]: document(largeBody, { title: 'Third' }, third),
  });
  let started = 0;
  let finished = 0;
  let active = 0;
  const github = async (path, settings) => {
    if (path !== '/git/blobs' || settings?.method !== 'POST') return fixture.github(path, settings);
    const ordinal = ++started;
    active++;
    try {
      await new Promise(resolve => setTimeout(resolve, ordinal === 1 ? 5 : 25));
      const blob = await fixture.github(path, settings);
      return ordinal === 1 ? { ...blob, sha: '0'.repeat(40) } : blob;
    } finally {
      active--;
      finished++;
    }
  };

  await assert.rejects(ensurePublicPublication({ ...options(fixture), github }), error => {
    assert.equal(error.status, 502);
    assert.equal(error.message, 'Uploaded blob differs from generated file');
    return true;
  });
  assert.equal(started, 2, 'Stop queued uploads after the first integrity failure');
  assert.equal(finished, 2, 'Drain every upload that was already in flight');
  assert.equal(active, 0);
  assert.equal(fixture.refs.has('public-data/' + A), false);
  assert.ok(fixture.calls.every(call => call.method === 'GET' || call.path.endsWith('/git/blobs')),
    'No tree, commit or ready ref may be written after a blob integrity failure');
});
