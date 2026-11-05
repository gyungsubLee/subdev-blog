import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleContentRequest } from '../../app/server/src/content.mjs';
import { ensurePublicPublication, publishPublicSource } from '../../app/server/src/public-publication.mjs';
import { publicRepository, ID, A, B, REPOSITORY, document } from '../support/public-repository.mjs';

const REQUEST = 'abcdefab-1234-1234-1234-123456789abc';
const catalog = { version: 1, documents: [] };
const config = { content: { owner: 'gyungsubLee', repo: 'subdev-blog-content', branch: 'main' } };
const digest = value => createHash('sha256').update(value).digest('hex');
const publicationOptions = f => ({ commit: A, repository: REPOSITORY, github: f.github, fetcher: f.fetcher, catalog });
const input = operation => ({ requestId: REQUEST, baseCommit: A, operation: {
  type: 'post.update', id: ID, baseRevision: digest(document()), changes: { title: 'Renamed' }, ...operation,
} });

async function save(f, payload = input(), fetcher = f.fetcher) {
  const response = await handleContentRequest(new Request('https://site.test/api/content', {
    method: 'POST', body: JSON.stringify(payload),
  }), { config, fetcher, catalog });
  return { status: response.status, ...await response.json() };
}

const apiPath = call => call.path.replace('/repos/' + REPOSITORY, '');
const reads = (f, path) => f.calls.filter(call => call.method === 'GET' && apiPath(call) === path).length;

test('source save batches small UTF8 files and does no public generation', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const saved = await save(f);
  assert.equal(saved.status, 200);
  assert.equal(saved.state, 'saved');
  assert.equal(f.refs.get('main'), saved.candidateCommit);
  assert.equal(f.refs.has('public-data/' + saved.contentCommit), false);
  assert.equal(f.calls.filter(call => call.method === 'POST' && apiPath(call) === '/git/blobs').length, 0);
  const treeWrite = f.calls.find(call => call.method === 'POST' && apiPath(call) === '/git/trees');
  const renamed = treeWrite.body.tree.find(entry => entry.path.endsWith('/Renamed.md'));
  assert.equal(typeof renamed.content, 'string');
  assert.equal(Object.hasOwn(renamed, 'sha'), false);
  const source = f.commits.get(saved.candidateCommit);
  assert.equal(reads(f, '/git/commits/' + saved.candidateCommit), 0);
  assert.equal(reads(f, '/git/trees/' + source.tree.sha), 0);
  const promoted = f.calls.findIndex(call => call.method === 'PATCH');
  assert.equal(f.calls.slice(promoted + 1).length, 1, 'Fresh canonical head proves the source save');
});

test('a lost PATCH response recovers the same source without public writes', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const fetcher = async (url, options) => {
    const response = await f.fetcher(url, options);
    if (options?.method === 'PATCH') throw Error('Response lost after accepted update');
    return response;
  };
  const saved = await save(f, input(), fetcher);
  assert.equal(saved.status, 200);
  assert.equal(saved.state, 'saved');
  assert.equal(saved.contentCommit, f.refs.get('main'));
  const retry = await save(f, input(), fetcher);
  assert.equal(retry.status, 200);
  assert.equal(retry.candidateCommit, saved.candidateCommit);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
  assert.equal(f.calls.some(call => call.body?.message?.startsWith('public-data:')), false);
});

test('a superseding canonical commit is reported without preparing public data', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const fetcher = async (url, options) => {
    const response = await f.fetcher(url, options);
    if (options?.method === 'PATCH') {
      const candidate = f.refs.get('main');
      f.commits.set(B, { sha: B, tree: f.commits.get(candidate).tree, parents: [{ sha: candidate }] });
      f.refs.set('main', B);
    }
    return response;
  };
  const saved = await save(f, input(), fetcher);
  assert.equal(saved.status, 200);
  assert.equal(saved.state, 'superseded');
  assert.equal(saved.contentCommit, B);
  assert.equal(f.refs.has('public-data/' + B), false);
});

test('public generation failure cannot block source save or duplicate its retry', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const fetcher = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    if (body?.message?.startsWith('public-data:') || new URL(url).host === 'raw.githubusercontent.com') {
      return Response.json({}, { status: 503 });
    }
    return f.fetcher(url, options);
  };
  const saved = await save(f, input(), fetcher);
  assert.equal(saved.status, 200);
  assert.equal(saved.state, 'saved');
  const retry = await save(f, input(), fetcher);
  assert.equal(retry.status, 200);
  assert.equal(retry.candidateCommit, saved.candidateCommit);
  assert.equal(f.calls.filter(call => call.method === 'POST' && apiPath(call) === '/git/commits').length, 1);
});

test('publication status stays saved until a complete immutable artifact is verified', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const saved = await save(f);
  const status = async (fetcher = f.fetcher) => {
    const response = await handleContentRequest(new Request('https://site.test/api/publish?requestId=' + REQUEST + '&candidateCommit=' + saved.candidateCommit), { config, fetcher, catalog });
    return {status:response.status,...await response.json()};
  };
  const waiting = await status();
  assert.equal(waiting.status, 200);
  assert.equal(waiting.state, 'saved');
  await ensurePublicPublication({...publicationOptions(f),commit:saved.contentCommit});
  assert.equal((await status()).state, 'saved', 'Immutable files alone do not make the default reader ready');
  await publishPublicSource({...publicationOptions(f),commit:saved.contentCommit});
  const published = await status();
  assert.equal(published.state, 'published');
  assert.equal(published.publicCommit, saved.contentCommit);
  const artifact = f.refs.get('public-data/' + saved.contentCommit);
  const treeSha = f.commits.get(artifact).tree.sha;
  f.trees.set(treeSha, f.trees.get(treeSha).filter(entry => entry.path !== `posts/${ID}.json`));
  const invalid = await status((...args) => f.fetcher(...args));
  assert.equal(invalid.status, 502);
  assert.equal(f.refs.get('main'), saved.contentCommit);
});

test('bulk receipt reuses verified candidate inventory and locally authored bytes', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const payload = input();
  payload.operations = [payload.operation];
  delete payload.operation;
  const saved = await save(f, payload);
  assert.equal(saved.status, 200);
  assert.equal(saved.state, 'saved');
  assert.equal(saved.receipt.payloadHash, digest(JSON.stringify(payload)));
  assert.equal(typeof saved.sources[ID].revision, 'string');
  const source = f.commits.get(saved.candidateCommit);
  assert.equal(reads(f, '/git/commits/' + saved.candidateCommit), 0);
  assert.equal(reads(f, '/git/trees/' + source.tree.sha), 0);
  const changed = f.trees.get(source.tree.sha).find(entry => entry.path.endsWith('/Renamed.md'));
  assert.equal(reads(f, '/git/blobs/' + changed.sha), 0);
  const retry = await save(f, payload);
  assert.equal(retry.status, 200);
  assert.equal(retry.sources[ID].revision, saved.sources[ID].revision);
  assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('immutable source reads are reused while canonical heads stay fresh', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const read = () => handleContentRequest(new Request('https://site.test/api/content?kind=post&id=' + ID), {config, fetcher:f.fetcher,catalog});
  assert.equal((await read()).status, 200);
  const first = f.calls.length;
  assert.equal((await read()).status, 200);
  const repeated = f.calls.slice(first);
  assert.equal(repeated.length, 1);
  assert.equal(apiPath(repeated[0]), '/git/ref/heads/main');
});

test('large source upload rejects an unexpected blob identity before tree or canonical writes', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const fetcher = async (url, options = {}) => {
    const response = await f.fetcher(url, options);
    if (options.method === 'POST' && new URL(url).pathname.endsWith('/git/blobs')) {
      return Response.json({sha:'f'.repeat(40)});
    }
    return response;
  };
  const saved = await save(f, input({markdown:'x'.repeat(70000)}), fetcher);
  assert.equal(saved.status, 502);
  assert.equal(f.refs.get('main'), A);
  assert.equal(f.calls.some(call => call.method === 'POST' && apiPath(call) === '/git/trees'), false);
});

test('previous ready source cannot mark a newly saved source published', { timeout: 10000 }, async () => {
  const f = publicRepository();
  await publishPublicSource(publicationOptions(f));
  const saved = await save(f);
  const response = await handleContentRequest(new Request('https://site.test/api/publish?requestId=' + REQUEST + '&candidateCommit=' + saved.candidateCommit), {config,fetcher:f.fetcher,catalog});
  assert.equal(response.status, 200);
  const waiting = await response.json();
  assert.equal(waiting.state, 'saved');
  assert.equal(waiting.contentCommit, saved.contentCommit);
  assert.equal(waiting.publicCommit, A);
});

test('candidate inventory preserves existing assets and verified sizes of new assets', { timeout: 10000 }, async () => {
  const f = publicRepository({ [`posts/${ID}/original.png`]: 'original' });
  const bytes = Buffer.from('new asset');
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  f.blobs.set(sha, bytes);
  const saved = await save(f, input({ assets: [{ name: 'new.png', sha, size: bytes.length }] }));
  assert.equal(saved.status, 200);
  assert.equal(saved.state, 'saved');
  const sourceEntries = f.trees.get(f.commits.get(saved.candidateCommit).tree.sha);
  assert.ok(sourceEntries.some(entry => entry.path === `posts/${ID}/Renamed.md`));
  assert.ok(!sourceEntries.some(entry => entry.path === `posts/${ID}/Title.md`));
  assert.ok(sourceEntries.some(entry => entry.path === `posts/${ID}/original.png`));
  assert.ok(sourceEntries.some(entry => entry.path === `posts/${ID}/new.png` && entry.sha === sha && entry.size === bytes.length));
  assert.equal(f.refs.has('public-data/' + saved.candidateCommit), false);
});

test('an earlier source receipt becomes published when verified ready advances to its descendant', { timeout: 10000 }, async () => {
  const f = publicRepository();
  const saved = await save(f);
  f.commits.set(B, {sha:B,tree:f.commits.get(saved.contentCommit).tree,parents:[{sha:saved.contentCommit}]});
  f.refs.set('main', B);
  await publishPublicSource({...publicationOptions(f),commit:B});
  const response = await handleContentRequest(new Request('https://site.test/api/publish?requestId=' + REQUEST + '&candidateCommit=' + saved.candidateCommit), {config,fetcher:f.fetcher,catalog});
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.state, 'published');
  assert.equal(status.candidateCommit, saved.candidateCommit);
  assert.equal(status.contentCommit, B);
  assert.equal(status.publicCommit, B);
  const retry = await save(f);
  assert.equal(retry.state, 'superseded', 'Source retry conflict behavior is separate from public readiness');
});

test('unchanged source can track workflow readiness without a request candidate or save-path public reads', { timeout: 10000 }, async () => {
  const f = publicRepository();
  await publishPublicSource(publicationOptions(f));
  const saved = await save(f);
  const entry = f.trees.get(f.commits.get(saved.contentCommit).tree.sha).find(file => file.path.endsWith('/Renamed.md'));
  f.calls.length = 0;
  const unchanged = await save(f, {requestId:'11111111-2222-3333-4444-555555555555',baseCommit:saved.contentCommit,operation:{
    type:'post.update',id:ID,baseRevision:digest(f.blobs.get(entry.sha)),changes:{title:'Renamed'},
  }});
  assert.equal(unchanged.status, 200);
  assert.equal(unchanged.state, 'unchanged');
  assert.equal(unchanged.publicationPending, true);
  assert.equal(f.calls.some(call => apiPath(call).includes('public-ready/')), false);
  assert.equal(f.calls.some(call => call.method !== 'GET'), false);
  const status = async sourceCommit => {
    const response = await handleContentRequest(new Request('https://site.test/api/publish?sourceCommit=' + sourceCommit), {config,fetcher:f.fetcher,catalog});
    return {status:response.status,...await response.json()};
  };
  const waiting = await status(saved.contentCommit);
  assert.equal(waiting.status, 200);
  assert.equal(waiting.state, 'saved');
  assert.equal(waiting.sourceCommit, saved.contentCommit);
  assert.equal(waiting.contentCommit, saved.contentCommit);
  assert.equal(waiting.publicCommit, A);
  f.commits.set(B, {sha:B,tree:f.commits.get(A).tree,parents:[{sha:A}]});
  assert.equal((await status(B)).status, 409, 'An unrelated source is not a publication status authority');
  await publishPublicSource({...publicationOptions(f),commit:saved.contentCommit});
  const published = await status(saved.contentCommit);
  assert.equal(published.status, 200);
  assert.equal(published.state, 'published');
  assert.equal(published.publicCommit, saved.contentCommit);
});
