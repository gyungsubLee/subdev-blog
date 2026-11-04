import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handlePublicRequest } from '../../../server/public-content.mjs';
import { parseMarkdownDocument, serializeMarkdownDocument } from '../../../src/shared/document.mjs';

// Research probe: no network, persistent cache service, or repository writes.
const id = '12345678-1234-1234-1234-123456789abc';
const commit = 'a'.repeat(40);
const filename = `posts/${id}/Title.md`;
const categories = [{ id: 'group:unclassified', name: 'Other', parent_id: null, order: 0, sources: [] }];
const markdown = 'Original body';
const source = serializeMarkdownDocument({
  metadata: { schema_version: 1, id, title: 'Title', parent_id: null, created: '2026-10-24', updated: '2026-10-24' },
  markdown,
});
const files = { 'categories.json': JSON.stringify(categories), [filename]: source };
const blobSha = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex');
const catalog = {
  version: 1,
  documents: [{
    filename,
    blobSha: blobSha(source),
    metadata: parseMarkdownDocument(source).metadata,
    markdown,
    revision: createHash('sha256').update(source).digest('hex'),
    assets: [],
  }],
};

let bodyReads = 0;
const fetcher = async (input) => {
  const url = new URL(input);
  if (url.host === 'api.github.com') {
    if (url.pathname.endsWith('/subdev-blog-content')) {
      return Response.json({ private: false });
    }
    if (url.pathname.includes('/git/ref/')) {
      return Response.json({ object: { type: 'commit', sha: commit } });
    }
    if (url.pathname.includes('/git/commits/')) {
      return Response.json({ sha: commit, tree: { sha: 'b'.repeat(40) } });
    }
    if (url.pathname.includes('/git/trees/')) {
      return Response.json({
        truncated: false,
        tree: Object.entries(files).map(([path, value]) => ({
          path, sha: blobSha(value), mode: '100644', type: 'blob', size: Buffer.byteLength(value),
        })),
      });
    }
  }
  if (url.host === 'raw.githubusercontent.com') {
    const path = url.pathname.split('/').slice(4).map(decodeURIComponent).join('/');
    if (Object.hasOwn(files, path)) {
      if (path === filename) {
        bodyReads++;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return new Response(files[path]);
    }
  }
  throw new Error(`Unexpected probe request: ${url.pathname}`);
};

const request = query => handlePublicRequest(
  new Request(`https://site.test/api/public?${query}`),
  { env: {}, fetcher, catalog },
);
assert.equal((await request('kind=index')).status, 200);
assert.equal(bodyReads, 0, 'catalog bootstrap must not fetch the full body');
const responses = await Promise.all(Array.from({ length: 8 }, () =>
  request(`kind=post&id=${id}&commit=${commit}`),
));
assert.ok(responses.every(response => response.status === 200), 'all detail requests must succeed');
const bodies = await Promise.all(responses.map(response => response.json()));
assert.ok(bodies.every(body => body.markdown === markdown), 'all details must have the authored body');
const concurrentReads = bodyReads;
assert.equal((await request(`kind=post&id=${id}&commit=${commit}`)).status, 200);
assert.equal(bodyReads, concurrentReads, 'a later detail must reuse the completed blob cache');
console.log(JSON.stringify({
  node: process.version,
  requests: 8,
  statuses: responses.map(response => response.status),
  concurrentBodyReads: concurrentReads,
  bodyReadsAfterWarmRequest: bodyReads,
  sourceSha256: createHash('sha256').update(await (await import('node:fs/promises')).readFile(new URL('../../../server/public-content.mjs', import.meta.url))).digest('hex'),
}, null, 2));
