import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readContent } from '../../app/content/src/content.mjs';
import { serializeMarkdownDocument } from '../../app/shared/document.mjs';
import { generatePublicFiles } from '../../app/server/src/public-publication.mjs';
import { createGitHubClient } from '../../app/server/src/github.mjs';

const runtime = await import('../../app/server/src/public-content.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('public-content.mjs')) return {};
  throw error;
});
const ID = '12345678-1234-1234-1234-123456789abc';
const OTHER = '87654321-1234-1234-1234-123456789abc';
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const DRAFT = 'd'.repeat(40);
const REPO = '/repos/gyungsubLee/subdev-blog-content';
const categories = [{ id: 'group:unclassified', name: 'Other', parent_id: null, order: 0, sources: [] }];
const blobSha = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex');
const document = (markdown = 'Original body', metadata = {}, id = ID) => serializeMarkdownDocument({
  metadata: { schema_version: 1, id, title: 'Title', parent_id: null, created: '2026-10-24', updated: '2026-10-24', ...metadata },
  markdown,
});

function fixture({ files = {}, nextFiles, isPrivate = false, compare = 'ahead', failPath, failStatus = 503, rawDelay = false, catalog } = {}) {
  const versions = new Map([[A, { 'categories.json': JSON.stringify(categories), [`posts/${ID}/Title.md`]: document(), ...files }]]);
  if (nextFiles) versions.set(B, { ...versions.get(A), ...nextFiles });
  const calls = [];
  const controls = { head: A, isPrivate, compare, failPath, failStatus, rawDelay, active: 0, peak: 0 };
  let generating = false;
  const publications = new Map();
  const sourceFetcher = async (input, options = {}) => {
    const url = new URL(input);
    if (!generating) calls.push({ host: url.host, path: url.pathname + url.search, authorization: options.headers?.Authorization, signal: options.signal });
    if (controls.failPath && url.pathname.includes(controls.failPath)) return Response.json({ message: 'secret error' }, { status: controls.failStatus });
    if (url.host === 'api.github.com') {
      const generated = decodeURIComponent(url.pathname).match(/\/git\/ref\/heads\/public-data\/([a-f0-9]{40})$/)?.[1];
      if (generated && publications.has(generated)) return Response.json({object:{type:'commit',sha:publications.get(generated)}});
      if (url.pathname === REPO) return Response.json({ private: controls.isPrivate, full_name: 'gyungsubLee/subdev-blog-content' });
      if (url.pathname === `${REPO}/git/ref/heads/main`) return Response.json({ ref: 'refs/heads/main', object: { type: 'commit', sha: controls.head } });
      if (url.pathname.startsWith(`${REPO}/compare/`)) return Response.json({ status: controls.compare });
      const commit = url.pathname.match(/\/git\/commits\/([a-f0-9]{40})$/)?.[1];
      if (commit && versions.has(commit)) return Response.json({ sha: commit, tree: { sha: createHash('sha1').update(commit).digest('hex') } });
      const tree = url.pathname.match(/\/git\/trees\/([a-f0-9]{40})$/)?.[1];
      const version = [...versions].find(([sha]) => createHash('sha1').update(sha).digest('hex') === tree);
      if (version) return Response.json({ truncated: false, tree: Object.entries(version[1]).map(([path, value]) => ({ path, sha: blobSha(value), mode: '100644', type: 'blob', size: Buffer.byteLength(value) })) });
    }
    if (url.host === 'raw.githubusercontent.com') {
      const [, owner, repo, commit, ...segments] = url.pathname.split('/');
      assert.equal(`${owner}/${repo}`, 'gyungsubLee/subdev-blog-content');
      const value = versions.get(commit)?.[segments.map(decodeURIComponent).join('/')];
      if (value !== undefined) {
        controls.active++;
        controls.peak = Math.max(controls.peak, controls.active);
        if (controls.rawDelay) await new Promise(resolve => setTimeout(resolve, 5));
        controls.active--;
        return new Response(value);
      }
    }
    return Response.json({ message: 'not found' }, { status: 404 });
  };
  const pending = new Map();
  const prepare = commit => {
    if (!pending.has(commit)) pending.set(commit, (async () => {
      generating = true;
      try {
        const client = createGitHubClient(undefined,sourceFetcher);
        const files = await generatePublicFiles({commit,catalog,repository:'gyungsubLee/subdev-blog-content',github:(path,options)=>client(REPO+path,options),fetcher:sourceFetcher});
        const artifact = createHash('sha1').update('public:'+commit).digest('hex');
        versions.set(artifact,Object.fromEntries([...files].map(([path,bytes])=>[path,bytes.toString('utf8')])));
        publications.set(commit,artifact);
      } finally { generating = false; }
    })());
    return pending.get(commit);
  };
  const fetcher = async (input, options) => {
    await prepare(controls.head);
    const commit = new URL(input).pathname.match(/public-data(?:%2F|\/)([a-f0-9]{40})/)?.[1];
    if (commit && versions.has(commit)) await prepare(commit);
    return sourceFetcher(input,options);
  };
  const call = async (query = 'kind=index', env = {}, method = 'GET') => {
    assert.equal(typeof runtime.handlePublicRequest, 'function', 'public runtime handler must be available');
    const response = await runtime.handlePublicRequest(new Request(`https://site.test/api/public?${query}`, { method }), { env, fetcher, catalog });
    return { status: response.status, body: await response.json(), cacheControl: response.headers.get('Cache-Control') };
  };
  return { call, calls, controls, versions, fetcher, prepare };
}

test('public index reads canonical GitHub content without login or a token', async () => {
  const f = fixture({ files: { [`posts/${ID}/Title.md`]: document('x'.repeat(1500)) } });
  const result = await f.call();
  assert.equal(result.status, 200);
  assert.equal(result.body.contentCommit, A);
  assert.equal(result.body.posts.length, 1);
  assert.equal(result.body.posts[0].markdown.length, 1400);
  assert.equal(result.body.posts[0].bodyLoaded, false);
  assert.equal(result.body.categories[0].id, 'group:unclassified');
  assert.equal(result.cacheControl, 'no-store');
  assert.ok(f.calls.every(call => call.authorization === undefined));
  assert.ok(f.calls.every(call => call.signal instanceof AbortSignal));
  assert.ok(f.calls.every(call => !call.path.includes('/git/blobs/')));
});

test('public reads exclude editor source without fetching its private editing payload', async () => {
  const f = fixture({ files: { [`posts/${ID}/editor.json`]: '{"blocks":[]}' } });
  const result = await f.call();
  assert.equal(result.status, 200);
  assert.equal(Object.hasOwn(result.body.posts[0], 'editor'), false);
  assert.ok(f.calls.every(call => !call.path.endsWith('/editor.json')));
});

test('public Markdown cannot publish editor source as an attachment', async () => {
  for (const name of ['editor.json', 'EDITOR.JSON', '%65ditor.json']) {
    const f = fixture({ files: {
      [`posts/${ID}/Title.md`]: document(`[source](./${name})`),
      [`posts/${ID}/${name}`]: '{"blocks":[]}',
    } });
    const result = await f.call();
    assert.equal(result.status, 502, 'reserved editor source must not become a public attachment');
  }
});

test('encoded aliases of the reserved editor filename fail public tree validation', async () => {
  const f = fixture({ files: { [`posts/${ID}/%2565ditor.json`]: '{"blocks":[]}' } });
  assert.equal((await f.call()).status, 502);
});

test('body, cover, icon and attachments remain pinned to the list commit after head advances', async () => {
  const files = {
    [`posts/${ID}/Title.md`]: document('![cover](./a&b.png#image)', { cover: './a&b.png', icon: './a&b.png' }),
    [`posts/${ID}/a&b.png`]: 'image',
  };
  const f = fixture({ files, nextFiles: { [`posts/${ID}/Title.md`]: document('Updated body') } });
  assert.equal((await f.call()).body.contentCommit, A);
  f.controls.head = B;
  assert.equal((await f.call(`kind=index&after=${B}`)).body.contentCommit, B);
  const result = await f.call(`kind=post&id=${ID}&commit=${A}`);
  const asset = `https://raw.githubusercontent.com/gyungsubLee/subdev-blog-content/${A}/posts/${ID}/a%26b.png`;
  assert.equal(result.status, 200);
  assert.equal(result.body.markdown, `![cover](${asset}#image)`);
  assert.equal(result.body.cover, asset);
  assert.equal(result.body.icon, asset);
  assert.equal(result.body.bodyLoaded, true);
});

test('a full SHA outside canonical history cannot expose a draft commit', async () => {
  const f = fixture({ compare: 'diverged' });
  const result = await f.call(`kind=post&id=${ID}&commit=${DRAFT}`);
  assert.equal(result.status, 404);
  assert.ok(f.calls.some(call => call.path === `${REPO}/compare/${DRAFT}...${A}`));
  assert.ok(f.calls.every(call => !call.path.includes(`/git/commits/${DRAFT}`) && !call.path.includes(`/${DRAFT}/posts/`)));
});

test('an uncached canonical ancestor can be read after ancestry verification', async () => {
  const f = fixture({ nextFiles: { [`posts/${ID}/Title.md`]: document('Updated body') } });
  f.controls.head = B;
  const result = await f.call(`kind=post&id=${ID}&commit=${A}`);
  assert.equal(result.status, 200);
  assert.equal(result.body.markdown, 'Original body');
  assert.ok(f.calls.some(call => call.path === `${REPO}/compare/${A}...${B}`));
});

test('after bypasses an old head cache and selects the new commit publication', async () => {
  const f = fixture({ nextFiles: {} });
  await f.call();
  await f.call();
  assert.equal(f.calls.filter(call => call.path === `${REPO}/git/ref/heads/main`).length, 1);
  f.controls.head = B;
  assert.equal((await f.call(`kind=index&after=${B}`)).body.contentCommit, B);
  assert.equal(f.calls.filter(call => call.path === `${REPO}/git/ref/heads/main`).length, 2);
  assert.equal(f.calls.filter(call => call.host === 'raw.githubusercontent.com').length, 4);
});

test('fixed public repository reads do not fetch metadata and tokens stay server-side', async () => {
  const f=fixture({isPrivate:true});
  const result=await f.call('kind=index',{GITHUB_PUBLIC_TOKEN:'server-secret'});
  assert.equal(result.status,200);
  assert.ok(f.calls.every(call=>call.path!==REPO));
  assert.ok(f.calls.filter(call=>call.host==='api.github.com').every(call=>call.authorization==='Bearer server-secret'));
  assert.ok(!JSON.stringify(result.body).includes('server-secret'));
});

test('invalid request parameters and repository overrides are rejected before network access', async () => {
  for (const query of ['kind=other', `kind=post&id=${ID}`, `kind=post&id=bad&commit=${A}`, `kind=post&id=${ID}&commit=main`, 'kind=index&after=bad', 'kind=index&repo=other/repo', 'kind=index&token=secret']) {
    const f = fixture();
    assert.equal((await f.call(query)).status, 400, query);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal((await f.call('kind=index', {}, 'POST')).status, 405);
  assert.equal(f.calls.length, 0);
});

test('GitHub errors are visible and never become a successful empty index or stale snapshot', async () => {
  const f = fixture();
  await f.call();
  f.controls.failPath = '/git/ref/';
  f.controls.failStatus = 403;
  const result = await f.call(`kind=index&after=${B}`);
  assert.equal(result.status, 403);
  assert.equal(typeof result.body.error, 'string');
  assert.equal(result.body.posts, undefined);
});

test('runtime retains missing authored links but rejects unsafe paths and URL schemes', async () => {
  const f = fixture({ files: { [`posts/${ID}/Title.md`]: document('[missing](../missing.md) [missing](#/post/' + OTHER + ') ![missing](./missing.png)') } });
  const result = await f.call();
  assert.equal(result.status, 200);
  assert.ok(result.body.posts[0].markdown.includes('../missing.md'));
  for (const destination of ['javascript:alert', '../outside.png', './%252e%252e%252foutside.png', './a%5cb.png']) {
    const unsafe = fixture({ files: { [`posts/${ID}/Title.md`]: document(`[unsafe](${destination})`) } });
    assert.equal((await unsafe.call()).status, 502, destination);
  }
});

test('generation source reads are bounded in parallel and unsafe trees fail before publication', async () => {
  const files = {};
  for (let index = 0; index < 20; index++) {
    const id = `12345678-1234-1234-1234-${String(index).padStart(12, '0')}`;
    files[`posts/${id}/Title.md`] = document('Body ' + index, {}, id);
  }
  const f = fixture({ files, rawDelay: true });
  assert.equal((await f.call()).body.posts.length, 21);
  assert.ok(f.controls.peak > 1 && f.controls.peak <= 8, `maximum parallel reads: ${f.controls.peak}`);
  const unsafe = fixture({ files: { [`posts/${ID}/nested/file.png`]: 'bad' } });
  assert.equal((await unsafe.call()).status, 502);
});

test('a generation source failure is surfaced and request deadlines are finite', async () => {
  const f = fixture({ failPath: '/Title.md', failStatus: 404 });
  assert.equal((await f.call()).status, 502);
  let deadline;
  await assert.rejects(createGitHubClient(undefined, async (_url, options) => {
    deadline = options.signal;
    throw new Error('offline');
  })('/repos/owner/repo'), error => error.status === 502);
  assert.ok(deadline instanceof AbortSignal);
});

test('anonymous GitHub requests omit credentials and always carry an abort deadline', async () => {
  let suppliedHeaders;
  let suppliedSignal;
  await createGitHubClient(undefined, async (_url, options) => {
    suppliedHeaders = options.headers;
    suppliedSignal = options.signal;
    return Response.json({ private: false });
  })('/repos/owner/repo');
  assert.equal(suppliedHeaders.Authorization, undefined);
  assert.ok(suppliedSignal instanceof AbortSignal);
});


test('generated summaries preserve inheritance, links and changed content; detail fetches only its public JSON', async () => {
  const changedId = '22222222-1234-1234-1234-123456789abc';
  const root = document('Parent full body', { category_id: 'group:custom' });
  const child = document(`[parent](../${ID}/Title.md#section)\n` + 'child '.repeat(300), { parent_id: ID }, OTHER);
  const stale = document('Old changed body', {}, changedId);
  const records = [root, child, stale].map((text, index) => {
    const id = [ID, OTHER, changedId][index];
    const marker = text.indexOf('---\n', 4) + 4;
    return { blobSha: blobSha(text), filename: `posts/${id}/Title.md`, metadata: {
      schema_version: 1, id, title: 'Title', parent_id: id === OTHER ? ID : null,
      created: '2026-10-24', updated: '2026-10-24', ...(id === ID ? { category_id: 'group:custom' } : {}),
    }, markdown: text.slice(marker).slice(0, 1400), revision: createHash('sha256').update(text).digest('hex'), assets: [] };
  });
  const f = fixture({
    catalog: { version: 1, documents: records },
    files: {
      'categories.json': JSON.stringify([...categories, { id: 'group:custom', name: 'Custom', parent_id: null, order: 1, sources: [] }]),
      [`posts/${ID}/Title.md`]: root,
      [`posts/${OTHER}/Title.md`]: child,
      [`posts/${changedId}/Title.md`]: document('Current changed body', {}, changedId),
    },
  });
  const index = await f.call();
  assert.equal(index.status, 200);
  assert.equal(index.body.posts.find(post => post.id === OTHER).categoryId, 'group:custom');
  assert.ok(index.body.posts.find(post => post.id === OTHER).markdown.includes(`#/post/${ID}#section`));
  assert.equal(index.body.posts.find(post => post.id === changedId).markdown, 'Current changed body');
  const rawReads = () => f.calls.filter(call => call.host === 'raw.githubusercontent.com');
  assert.equal(rawReads().length, 2);
  assert.ok(rawReads().every(call => !call.path.includes(`/posts/${ID}/`) && !call.path.includes(`/posts/${OTHER}/`)));
  const detail = await f.call(`kind=post&id=${OTHER}&commit=${A}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.body.markdown.length > 1400);
  assert.ok(detail.body.markdown.includes(`#/post/${ID}#section`));
  assert.equal(detail.body.categoryId, 'group:custom');
  assert.equal(rawReads().length, 3);
  assert.ok(rawReads()[2].path.endsWith(`/posts/${OTHER}.json`));
  await f.call(`kind=post&id=${OTHER}&commit=${A}`);
  assert.equal(rawReads().length, 3);
});


test('content catalog records carry the exact Git blob hash of canonical source bytes', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'public-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const raw = document('Catalog source body');
  await mkdir(path.join(root, 'posts', ID), { recursive: true });
  await writeFile(path.join(root, 'categories.json'), JSON.stringify(categories));
  await writeFile(path.join(root, 'posts', ID, 'Title.md'), raw);
  const snapshot = await readContent(root);
  assert.equal(snapshot.documents.get(ID).blobSha, blobSha(raw));
});

test('a cached snapshot is denied after canonical history is replaced', async () => {
  const f = fixture({ compare: 'diverged', nextFiles: { [`posts/${ID}/Title.md`]: document('Unrelated replacement body') } });
  assert.equal((await f.call()).body.contentCommit, A);
  f.controls.head = B;
  assert.equal((await f.call(`kind=index&after=${B}`)).body.contentCommit, B);
  const rawCount = f.calls.filter(call => call.host === 'raw.githubusercontent.com').length;
  const result = await f.call(`kind=post&id=${ID}&commit=${A}`);
  assert.equal(result.status, 404);
  assert.ok(f.calls.some(call => call.path === `${REPO}/compare/${A}...${B}`));
  assert.equal(f.calls.filter(call => call.host === 'raw.githubusercontent.com').length, rawCount);
});

test('a cached ancestor proof is reused only for its current canonical head', async () => {
  const f = fixture({ nextFiles: { [`posts/${ID}/Title.md`]: document('Descendant body') } });
  await f.call();
  f.controls.head = B;
  await f.call(`kind=index&after=${B}`);
  const rawCount = f.calls.filter(call => call.host === 'raw.githubusercontent.com').length;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await f.call(`kind=post&id=${ID}&commit=${A}`);
    assert.equal(result.status, 200);
    assert.equal(result.body.markdown, 'Original body');
  }
  assert.equal(f.calls.filter(call => call.path === `${REPO}/compare/${A}...${B}`).length, 1);
  assert.equal(f.calls.filter(call => call.host === 'raw.githubusercontent.com').length, rawCount + 1);
});


let productionSizeFixture;
function largePublicFixture() {
  if (productionSizeFixture) return productionSizeFixture;
  const files = {};
  const records = [];
  let seed = 42;
  for (let index = 0; index < 1200; index++) {
    const id = index === 0 ? ID : `12345678-1234-1234-1234-${String(index).padStart(12, '0')}`;
    let markdown = '';
    for (let character = 0; character < 1400; character++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      markdown += String.fromCharCode(0xac00 + ((seed >>> 16) % 64));
    }
    const metadata = {
      schema_version: 1, id, title: 'Title', parent_id: null,
      created: '2026-10-24', updated: '2026-10-24', private_note: 'server-only-catalog-metadata',
    };
    const raw = document(markdown, metadata, id);
    const filename = `posts/${id}/Title.md`;
    files[filename] = raw;
    records.push({ blobSha: blobSha(raw), filename, metadata, markdown, revision: createHash('sha256').update(raw).digest('hex'), assets: [] });
  }
  const catalog = { version: 1, documents: records };
  const f = fixture({ files, catalog });
  productionSizeFixture = { ...f, catalog };
  return productionSizeFixture;
}

async function largePublicResponse(acceptEncoding) {
  const f = largePublicFixture();
  const headers = acceptEncoding === undefined ? {} : { 'Accept-Encoding': acceptEncoding };
  return runtime.handlePublicRequest(new Request('https://site.test/api/public?kind=index', { headers }), { env: {}, fetcher: f.fetcher, catalog: f.catalog });
}

test('production-size indexes use bounded gzip without losing records or summary search text', async () => {
  const response = await largePublicResponse();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Encoding'), 'gzip');
  assert.equal(response.headers.get('Content-Type'), 'application/json');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vary'), 'Accept-Encoding');
  const compressed = Buffer.from(await response.arrayBuffer());
  assert.ok(compressed.length <= 4 * 1024 * 1024);
  const json = gunzipSync(compressed);
  assert.ok(json.length > 4.5 * 1024 * 1024);
  const index = JSON.parse(json.toString('utf8'));
  assert.equal(index.posts.length, 1200);
  assert.ok(index.posts.every(post => post.markdown.length === 1400 && post.bodyLoaded === false));
  assert.ok(!json.includes(Buffer.from('server-only-catalog-metadata')));
  assert.equal(index.contentCommit, A);
});

test('explicit gzip rejection overrides wildcards and large identity responses stay bounded', async () => {
  for (const header of ['gzip;q=0, *;q=1', 'gzip ; q=0, *;q=1', 'gzip;q=0', 'identity', '*;q=0']) {
    const response = await largePublicResponse(header);
    assert.equal(response.status, 406, header);
    assert.equal(response.headers.get('Content-Encoding'), null);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  for (const header of ['*;q=0.5', 'gzip;q=1, *;q=0', 'br, gzip;q=0.5']) {
    const response = await largePublicResponse(header);
    assert.equal(response.status, 200, header);
    assert.equal(response.headers.get('Content-Encoding'), 'gzip');
    assert.ok((await response.arrayBuffer()).byteLength <= 4 * 1024 * 1024);
  }
});

test('small public responses remain ordinary JSON when gzip is rejected', async () => {
  const f = fixture();
  const response = await runtime.handlePublicRequest(new Request('https://site.test/api/public?kind=index', { headers: { 'Accept-Encoding': 'gzip;q=0' } }), { env: {}, fetcher: f.fetcher });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Encoding'), null);
  assert.equal((await response.json()).posts[0].markdown, 'Original body');
});

test('repeated consumed index responses reuse JSON bytes and remain independently readable', async () => {
  const f = fixture();
  await f.prepare(A);
  const stringify = JSON.stringify;
  let encodings = 0;
  JSON.stringify = function (value, ...args) {
    if (value?.posts && value?.contentCommit === A) encodings++;
    return stringify.call(this, value, ...args);
  };
  try {
    for (let i = 0; i < 3; i++) {
      const result = await f.call();
      assert.equal(result.status, 200);
      assert.equal(result.body.posts[0].markdown, 'Original body');
    }
    assert.equal(encodings, 0, 'generated index bytes must not be reserialized');
  } finally {
    JSON.stringify = stringify;
  }
});

// Inspect retention without exposing test-only controls from the production module.
async function inspectedRuntime() {
  const location = new URL('../../app/server/src/public-content.mjs', import.meta.url);
  const source = (await readFile(location, 'utf8')).replace('gzipSync(bytes)', '(gzipEncodings++, gzipSync(bytes))').replace(/from '([^']+)'/g, (match, name) =>
    name.startsWith('.') ? `from '${new URL(name, location).href}'` : match);
  return import('data:text/javascript;base64,' + Buffer.from(source + '\nlet gzipEncodings = 0; export const compressionCount = () => gzipEncodings; export const inspectCache = fetcher => cacheFor(fetcher, "main");').toString('base64'));
}

test('encoded bytes count toward the snapshot budget and trigger eviction on growth', async () => {
  const inspected = await inspectedRuntime();
  const f = largePublicFixture();
  const fetcher = (...args) => f.fetcher(...args);
  const call = encoding => inspected.handlePublicRequest(new Request('https://site.test/api/public?kind=index', {
    headers: { 'Accept-Encoding': encoding },
  }), { env: {}, fetcher, catalog: f.catalog });
  const identity = await call('identity');
  assert.equal(identity.status, 406);
  await identity.json();
  const cache = inspected.inspectCache(fetcher);
  const snapshot = cache.snapshots.get(A);
  assert.ok(snapshot.encoded.identity.length > 4 * 1024 * 1024);
  assert.ok(snapshot.bytes > snapshot.encoded.identity.length);
  assert.equal(cache.snapshotBytes, snapshot.bytes);
  // Simulate other retained source data near the real 128 MiB limit.
  snapshot.bytes = 128 * 1024 * 1024 - 100;
  cache.snapshotBytes = snapshot.bytes;
  const compressed = await call('gzip');
  assert.equal(compressed.status, 200);
  await compressed.arrayBuffer();
  assert.equal(cache.snapshots.size, 0);
  assert.equal(cache.snapshotBytes, 0);
  const repeated = await call('gzip');
  await repeated.arrayBuffer();
  // The near-limit snapshot was evicted, so this request must rebuild once.
  assert.equal(inspected.compressionCount(), 2);
  const warm = await call('gzip');
  await warm.arrayBuffer();
  assert.equal(inspected.compressionCount(), 2, 'a retained gzip response must not be recompressed');
  assert.ok(snapshot.encoded.gzip.length > 100);
});

test('retention never exceeds three snapshots after new commits', async () => {
  const inspected = await inspectedRuntime();
  const f = fixture({ nextFiles: {} });
  const commits = [A, B, 'c'.repeat(40), 'e'.repeat(40)];
  for (const commit of commits) {
    f.versions.set(commit, f.versions.get(A));
    f.controls.head = commit;
    const response = await inspected.handlePublicRequest(new Request(`https://site.test/api/public?kind=index&after=${commit}`), { env: {}, fetcher: f.fetcher, catalog: {version: 1, documents: []} });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).contentCommit, commit);
  }
  const cache = inspected.inspectCache(f.fetcher);
  assert.equal(cache.snapshots.size, 3);
  assert.equal(cache.snapshots.has(A), false);
  assert.equal(cache.snapshotBytes, [...cache.snapshots.values()].reduce((total, snapshot) => total + snapshot.bytes, 0));
});
