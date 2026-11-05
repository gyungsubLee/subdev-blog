import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';
import { publicRepository, ID, A, B, REPOSITORY, document } from '../support/public-repository.mjs';
const publication = await import('../../app/server/src/public-publication.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const options = f => ({ commit: A, repository: REPOSITORY, github: f.github, fetcher: f.fetcher });

test('workflow exposes a verified source only after its immutable publication is complete', { timeout: 5000 }, async () => {
  assert.equal(typeof publication.publishPublicSource, 'function');
  const f = publicRepository();
  const result = await publication.publishPublicSource(options(f));
  assert.equal(result.sourceCommit, A);
  assert.equal(result.state, 'published');
  assert.equal(f.refs.get('public-ready/main'), A);
  const readyWrite = f.calls.findIndex(call => call.body?.ref === 'refs/heads/public-ready/main');
  const verifiedTree = f.calls.findLastIndex(call => call.method === 'GET' && call.path.includes('/git/trees/'));
  assert.ok(readyWrite > verifiedTree, 'The ready ref follows verification of the completed artifact');
  assert.equal(await publication.verifyPublicPublication(options(f), result.publicationCommit), result.publicationCommit);
});

test('ready source advances by canonical ancestry and concurrent workflows preserve the newest source', { timeout: 5000 }, async () => {
  const f = publicRepository();
  await publication.publishPublicSource(options(f));
  f.addSource(B, { [`posts/${ID}/Title.md`]: document('New body') });
  f.commits.get(B).parents = [{ sha: A }];
  f.refs.set('main', B);
  const newer = await publication.publishPublicSource({ ...options(f), commit: B });
  assert.equal(newer.state, 'published');
  assert.equal(f.refs.get('public-ready/main'), B);
  assert.ok(f.calls.some(call => call.method === 'PATCH' && call.body.sha === B && call.body.force === false));

  f.refs.delete('public-ready/main');
  await Promise.all([
    publication.publishPublicSource(options(f)),
    publication.publishPublicSource({ ...options(f), commit: B }),
  ]);
  assert.equal(f.refs.get('public-ready/main'), B);
});

test('ready source status verifies the immutable artifact and rejects an incomplete publication', { timeout: 5000 }, async () => {
  assert.equal(typeof publication.readReadyPublicSource, 'function');
  const f = publicRepository();
  assert.equal(await publication.readReadyPublicSource(options(f)), null);
  const result = await publication.publishPublicSource(options(f));
  const ready = await publication.readReadyPublicSource(options(f));
  assert.equal(ready.sourceCommit, A);
  assert.equal(ready.publicationCommit, result.publicationCommit);
  const artifactTree = f.commits.get(result.publicationCommit).tree.sha;
  f.trees.set(artifactTree, f.trees.get(artifactTree).filter(entry => entry.path !== `posts/${ID}.json`));
  await assert.rejects(publication.readReadyPublicSource(options(f)), error => error.status === 502);
});

test('failed artifact verification never advances the last ready source', { timeout: 5000 }, async () => {
  const f = publicRepository();
  await publication.publishPublicSource(options(f));
  f.addSource(B, { [`posts/${ID}/Title.md`]: document('New body') });
  f.commits.get(B).parents = [{ sha: A }];
  f.refs.set('main', B);
  const artifact = await publication.ensurePublicPublication({ ...options(f), commit: B });
  const tree = f.commits.get(artifact).tree.sha;
  f.trees.set(tree, f.trees.get(tree).filter(entry => entry.path !== `posts/${ID}.json`));
  await assert.rejects(publication.publishPublicSource({ ...options(f), commit: B }), error => error.status === 502);
  assert.equal(f.refs.get('public-ready/main'), A);
});

test('an older workflow cannot roll back a newer ready source', { timeout: 5000 }, async () => {
  assert.equal(typeof publication.publishPublicSource, 'function');
  const f = publicRepository();
  f.addSource(B, { [`posts/${ID}/Title.md`]: document('New body') });
  f.commits.get(B).parents = [{ sha: A }];
  f.refs.set('main', B);
  await publication.publishPublicSource({ ...options(f), commit: B });
  const older = await publication.publishPublicSource(options(f));
  assert.equal(older.state, 'superseded');
  assert.equal(f.refs.get('public-ready/main'), B);
  assert.ok(f.calls.filter(call => call.method === 'PATCH').every(call => call.body.force === false));
});

test('lost ready-ref response recovers without generating duplicate public commits', { timeout: 5000 }, async () => {
  assert.equal(typeof publication.publishPublicSource, 'function');
  const f = publicRepository();
  let lost = false;
  const github = async (path, settings) => {
    const result = await f.github(path, settings);
    if (!lost && settings?.body?.ref === 'refs/heads/public-ready/main') {
      lost = true;
      throw Object.assign(new Error('response lost'), { status: 502 });
    }
    return result;
  };
  assert.equal((await publication.publishPublicSource({ ...options(f), github })).state, 'published');
  assert.equal((await publication.publishPublicSource(options(f))).state, 'published');
  assert.equal(f.refs.get('public-ready/main'), A);
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.body?.message === 'public-data:' + A).length, 1);
});

test('a newer workflow winning during the old PATCH response cannot be overwritten', { timeout: 5000 }, async () => {
  const c = 'c'.repeat(40);
  const f = publicRepository();
  await publication.publishPublicSource(options(f));
  f.addSource(B, { [`posts/${ID}/Title.md`]: document('Second body') });
  f.commits.get(B).parents = [{ sha: A }];
  f.addSource(c, { [`posts/${ID}/Title.md`]: document('Third body') });
  f.commits.get(c).parents = [{ sha: B }];
  f.refs.set('main', c);
  let competing = false;
  const github = async (path, settings) => {
    if (!competing && settings?.method === 'PATCH' && settings.body.sha === B) {
      competing = true;
      await publication.publishPublicSource({ ...options(f), commit: c });
      throw Object.assign(new Error('response lost while newer workflow won'), { status: 502 });
    }
    return f.github(path, settings);
  };
  const result = await publication.publishPublicSource({ ...options(f), commit: B, github });
  assert.equal(result.state, 'superseded');
  assert.equal(f.refs.get('public-ready/main'), c);
});

test('publication CLI traces every consumed response without recording credentials or bodies', { timeout: 10000 }, async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { fileURLToPath } = await import('node:url');
  const script = fileURLToPath(new URL('../../app/content/scripts/publish-public-content.mjs', import.meta.url));
  const fixture = new URL('../support/public-repository.mjs', import.meta.url).href;
  const code = `
    import { publicRepository, A } from ${JSON.stringify(fixture)};
    const fixture = publicRepository();
    globalThis.fetch = fixture.fetcher;
    process.argv = ['node', ${JSON.stringify(script)}, '--commit', A, '--publish'];
    await import(${JSON.stringify(new URL('../../app/content/scripts/publish-public-content.mjs', import.meta.url).href)});
  `;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code], {
    timeout: 7000, maxBuffer: 256 * 1024,
    env: { ...process.env, GITHUB_TOKEN: 'fixture-secret-must-not-be-recorded' },
  });
  assert.equal(JSON.parse(stdout.trim()).state, 'published');
  const calls = stderr.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(calls.some(call => call.method === 'GET' && call.status === 404), 'Readiness misses also need traffic accounting');
  assert.ok(calls.some(call => call.method === 'POST'));
  assert.ok(calls.every(call => call.bodyComplete && call.responseBytes > 0 && call.requestBytes >= 0 && call.ms >= 0));
  assert.ok(!stderr.includes('fixture-secret-must-not-be-recorded'));
  assert.ok(!stderr.includes('Original body'));
});

test('a pending or failed new source keeps the last ready public index readable on a cold reader', { timeout: 5000 }, async () => {
  const f = publicRepository();
  await publication.ensurePublicPublication(options(f));
  f.refs.set('public-ready/main', A);
  f.addSource(B, { [`posts/${ID}/Title.md`]: document('Not published yet') });
  f.commits.get(B).parents = [{ sha: A }];
  f.refs.set('main', B);
  const { handlePublicRequest } = await import('../../app/server/src/public-content.mjs');
  const response = await handlePublicRequest(new Request('https://site.test/api/public?kind=index'), { env: {}, fetcher: f.fetcher });
  assert.equal(response.status, 200);
  const index = await response.json();
  assert.equal(index.contentCommit, A);
  assert.equal(index.posts[0].markdown, 'Original body');
  assert.ok(f.calls.every(call => call.body?.ref !== 'refs/heads/public-data/' + B));
});

test('generation projects safe public files and full bodies before publishing an immutable ref', async () => {
  assert.equal(typeof publication.ensurePublicPublication, 'function');
  const f = publicRepository({ [`posts/${ID}/Title.md`]: document('x'.repeat(1500), { private_note: 'SECRET', tags: ['SECRET'] }) });
  const artifact = await publication.ensurePublicPublication(options(f));
  assert.equal(f.refs.get('public-data/' + A), artifact);
  const entries = f.trees.get(f.commits.get(artifact).tree.sha);
  const read = path => JSON.parse(f.blobs.get(entries.find(entry => entry.path === path).sha));
  const index = read('index.json');
  assert.equal(index.contentCommit, A);
  assert.equal(index.posts[0].markdown.length, 1400);
  assert.equal(index.posts[0].bodyLoaded, false);
  assert.equal(read(`posts/${ID}.json`).markdown.length, 1500);
  assert.ok(!JSON.stringify(index).includes('SECRET'));
  const before = f.calls.length;
  assert.equal(await publication.ensurePublicPublication(options(f)), artifact);
  assert.ok(f.calls.slice(before).every(call => call.method === 'GET'));
});

test('unsafe source fails before the ready ref is created', async () => {
  assert.equal(typeof publication.ensurePublicPublication, 'function');
  for (const link of ['javascript:alert', './editor.json', './%65ditor.json', '../outside.png']) {
    const f = publicRepository({ [`posts/${ID}/Title.md`]: document(`[unsafe](${link})`), [`posts/${ID}/editor.json`]: '{}' });
    await assert.rejects(publication.ensurePublicPublication(options(f)));
    assert.equal(f.refs.has('public-data/' + A), false);
  }
});

test('generation rewrites pinned assets and inherited category without exposing original metadata', async () => {
  assert.equal(typeof publication.generatePublicFiles, 'function');
  const f = publicRepository({ [`posts/${ID}/Title.md`]: document('![image](./image.png)', { cover: './image.png' }), [`posts/${ID}/image.png`]: 'image' });
  const files = await publication.generatePublicFiles(options(f));
  const post = JSON.parse(files.get(`posts/${ID}.json`));
  assert.equal(post.markdown, `![image](https://raw.githubusercontent.com/${REPOSITORY}/${A}/posts/${ID}/image.png)`);
  assert.equal(post.cover, `https://raw.githubusercontent.com/${REPOSITORY}/${A}/posts/${ID}/image.png`);
  assert.equal(post.categoryId, 'group:unclassified');
  assert.equal(post.bodyLoaded, true);
});

test('the reader serves generated files without touching source Markdown or trees', async () => {
  const f = publicRepository();
  assert.equal(typeof publication.ensurePublicPublication, 'function');
  await publication.ensurePublicPublication(options(f));
  f.calls.length = 0;
  const { handlePublicRequest } = await import('../../app/server/src/public-content.mjs');
  const response = await handlePublicRequest(new Request('https://site.test/api/public?kind=index'), { env: {}, fetcher: f.fetcher });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).posts[0].markdown, 'Original body');
  assert.ok(f.calls.every(call => !call.path.includes('/git/trees/') && !call.path.includes('/git/commits/') && !call.path.endsWith('.md')));
  assert.ok(f.calls.every(call => call.path !== '/repos/' + REPOSITORY));
});

test('a missing publication returns 503 instead of generating content in a read', async () => {
  const f = publicRepository();
  const { handlePublicRequest } = await import('../../app/server/src/public-content.mjs');
  const response = await handlePublicRequest(new Request('https://site.test/api/public?kind=index'), { env: {}, fetcher: f.fetcher });
  assert.equal(response.status, 503);
  assert.ok(f.calls.every(call => call.method === 'GET' && !call.path.endsWith('.md')));
});

test('CLI needs explicit publication intent and output mode makes no remote writes', async t => {
  const { runPublicPublication } = await import('../../app/content/scripts/publish-public-content.mjs');
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const directory = await mkdtemp(path.join(tmpdir(), 'public-output-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const f = publicRepository();
  await assert.rejects(runPublicPublication(['--commit', A], { env: {}, fetcher: f.fetcher }));
  await runPublicPublication(['--commit', A, '--output', directory], { env: {}, fetcher: f.fetcher });
  assert.equal(JSON.parse(await readFile(path.join(directory, 'index.json'))).contentCommit, A);
  assert.ok(f.calls.every(call => call.method === 'GET'));
  assert.equal(f.refs.has('public-data/' + A), false);
});

test('an incomplete existing publication is rejected instead of being reused', async () => {
  const f = publicRepository();
  const artifact = await publication.ensurePublicPublication(options(f));
  const entries = f.trees.get(f.commits.get(artifact).tree.sha);
  f.trees.set(f.commits.get(artifact).tree.sha, entries.filter(entry => entry.path !== `posts/${ID}.json`));
  await assert.rejects(publication.ensurePublicPublication(options(f)), error => error.status === 502);
});

test('a changed source crossing the summary boundary keeps the previous full-transform semantics', async () => {
  const f = publicRepository({ [`posts/${ID}/Title.md`]: document('x'.repeat(1380) + ` [linked](../${ID}/Title.md)`) });
  const files = await publication.generatePublicFiles({ ...options(f), catalog: { version: 1, documents: [] } });
  const summary = JSON.parse(files.get('index.json')).posts[0].markdown;
  assert.equal(summary.slice(1380), ` [linked](#/post/${ID})`.slice(0, 20));
});

test('large publications upload bounded trees before exposing the complete ref', async () => {
  const files = {};
  for (let index = 1; index <= 205; index++) {
    const id = `12345678-1234-1234-1234-${String(index).padStart(12, '0')}`;
    files[`posts/${id}/Title.md`] = document('Body', {}, id);
  }
  const f = publicRepository(files);
  const github = async (path, options) => {
    if (path === '/git/trees' && options?.method === 'POST') {
      assert.ok(options.body.tree.length <= 200, 'GitHub cannot process an unbounded tree, including SHA-only entries');
      for (const entry of options.body.tree) {
        if (entry.sha) assert.ok(f.blobs.has(entry.sha), 'Final tree must reference uploaded blobs');
      }
      assert.equal(f.refs.has('public-data/' + A), false);
    }
    return f.github(path, options);
  };
  const settings = { ...options(f), github };
  const artifact = await publication.ensurePublicPublication(settings);
  assert.equal(await publication.verifyPublicPublication(settings, artifact), artifact);
  const indexEntry = f.trees.get(f.commits.get(artifact).tree.sha).find(entry => entry.path === 'index.json');
  assert.equal(JSON.parse(f.blobs.get(indexEntry.sha)).posts.length, 206);
});

test('oversized and escaped generated files use blob upload instead of oversized inline trees', async () => {
  const f = publicRepository({ [`posts/${ID}/Title.md`]: document('"'.repeat(1200000)) });
  let blobUploads = 0;
  const github = async (path, options) => {
    if (path === '/git/blobs' && options?.method === 'POST') blobUploads++;
    if (path === '/git/trees' && options?.method === 'POST') {
      assert.ok(Buffer.byteLength(JSON.stringify(options.body)) <= 2 * 1024 * 1024, 'Serialized tree request must stay bounded');
    }
    return f.github(path, options);
  };
  const settings = { ...options(f), github };
  const artifact = await publication.ensurePublicPublication(settings);
  assert.ok(blobUploads > 0, 'Large files require the blob endpoint');
  assert.equal(await publication.verifyPublicPublication(settings, artifact), artifact);
});

const OTHER = '22345678-1234-1234-1234-123456789abc';
function nextSource(f, commit, parent, changes = {}, removed = []) {
  f.addSource(commit, changes);
  const record = f.commits.get(commit);
  const entries = f.trees.get(record.tree.sha).filter(entry => !removed.includes(entry.path));
  const tree = createHash('sha1').update(JSON.stringify(entries)).digest('hex');
  f.trees.set(tree, entries);
  record.tree = { sha: tree };
  f.commits.get(commit).parents = [{ sha: parent }];
  f.refs.set('main', commit);
}
function artifactFile(f, artifact, path) {
  const entry = f.trees.get(f.commits.get(artifact).tree.sha).find(entry => entry.path === path);
  if (!entry) return undefined;
  let value = JSON.parse(f.blobs.get(entry.sha));
  if (path === 'generation.json' && value.version === 2) value = JSON.parse(gunzipSync(Buffer.from(value.data, 'base64')));
  return { sha: entry.sha, value };
}

test('writer cache compresses without changing public JSON and legacy cache still reuses bodies', async () => {
  const f = publicRepository({ [`posts/${OTHER}/Other.md`]: document('Other body', {title:'Other'}, OTHER) });
  const first = await publication.ensurePublicPublication(options(f));
  const tree = f.commits.get(first).tree.sha;
  const cacheEntry = f.trees.get(tree).find(entry => entry.path === 'generation.json');
  const envelope = JSON.parse(f.blobs.get(cacheEntry.sha));
  assert.equal(envelope.version, 2);
  assert.equal(envelope.encoding, 'gzip+base64');
  const state = gunzipSync(Buffer.from(envelope.data, 'base64'));
  assert.ok(cacheEntry.size < state.length, 'Compression must shrink the shared cache');
  const indexBefore = artifactFile(f, first, 'index.json').sha;
  // Model a previous v1 artifact with a matching manifest, not an unchecked cache.
  const manifest = artifactFile(f, first, 'manifest.json').value;
  manifest.files['generation.json'] = {size:state.length, sha:createHash('sha1').update(`blob ${state.length}\0`).update(state).digest('hex')};
  const legacyTree = await f.github('/git/trees', {method:'POST', body:{base_tree:tree, tree:[
    {path:'generation.json',mode:'100644',type:'blob',content:state.toString()},
    {path:'manifest.json',mode:'100644',type:'blob',content:JSON.stringify(manifest)},
  ]}});
  const legacy = await f.github('/git/commits', {method:'POST',body:{message:'legacy',tree:legacyTree.sha,parents:[]}});
  f.refs.set('public-data/' + A, legacy.sha);
  assert.equal(artifactFile(f,legacy.sha,'index.json').sha,indexBefore);
  nextSource(f, B, A, {[`posts/${ID}/Title.md`]:document('Changed')});
  f.calls.length = 0;
  const second = await publication.ensurePublicPublication({...options(f),commit:B});
  assert.equal(f.calls.filter(call=>call.path.endsWith('.md')).length,1);
  assert.equal(artifactFile(f,second,`posts/${OTHER}.json`).sha,artifactFile(f,first,`posts/${OTHER}.json`).sha);
});

test('large JSON chooses the smaller lossless blob encoding', async () => {
  const summaries = {};
  for (let n=1;n<=1550;n++) {
    const id=`12345678-1234-1234-1234-${String(n).padStart(12,'0')}`;
    summaries[`posts/${id}/Title.md`]=document('한글 text '.repeat(175),{},id);
  }
  for (const files of [summaries, {[`posts/${ID}/Title.md`]:document('"'.repeat(1200000))}]) {
    const f = publicRepository(files);
    const github = async (path, settings) => {
      if (path === '/git/blobs' && settings?.method === 'POST') {
        const sent = settings.body;
        const bytes = Buffer.from(sent.content, sent.encoding === 'base64' ? 'base64' : 'utf8');
        const alternatives = [
          {content:bytes.toString('utf8'),encoding:'utf-8'},
          {content:bytes.toString('base64'),encoding:'base64'},
        ].map(value=>Buffer.byteLength(JSON.stringify(value)));
        assert.equal(Buffer.byteLength(JSON.stringify(sent)), Math.min(...alternatives));
      }
      return f.github(path, settings);
    };
    const artifact = await publication.ensurePublicPublication({...options(f),github});
    assert.equal(await publication.verifyPublicPublication({...options(f),github},artifact),artifact);
  }
});

test('independent large blobs overlap with a two-upload bound before ready publication', {timeout:10000}, async () => {
  const files = {};
  for (let n=1;n<=3;n++) {
    const id = `12345678-1234-1234-1234-${String(n).padStart(12,'0')}`;
    files[`posts/${id}/Title.md`] = document('"'.repeat(1100000),{},id);
  }
  const f = publicRepository(files);
  let active=0,peak=0,finished=0;
  const github = async (path,settings) => {
    if (path==='/git/blobs' && settings?.method==='POST') {
      active++;peak=Math.max(peak,active);
      try {
        await new Promise(resolve=>setTimeout(resolve,10));
        return await f.github(path,settings);
      } finally {active--;finished++;}
    }
    if (path==='/git/trees' && settings?.method==='POST') assert.equal(active,0);
    return f.github(path,settings);
  };
  const artifact=await publication.ensurePublicPublication({...options(f),github});
  assert.equal(peak,2);
  assert.equal(finished,3);
  assert.equal(f.refs.get('public-data/'+A),artifact);
});

test('failed concurrent blob uploads drain in-flight work and never publish a ready ref', {timeout:10000}, async () => {
  const f=publicRepository({[`posts/${ID}/Title.md`]:document('"'.repeat(1100000)),[`posts/${OTHER}/Other.md`]:document('"'.repeat(1100000),{title:'Other'},OTHER)});
  let started=0,finished=0;
  const github=async(path,settings)=>{
    if(path==='/git/blobs'&&settings?.method==='POST') {
      const ordinal=++started;
      try {
        await new Promise(resolve=>setTimeout(resolve,ordinal===1?5:25));
        if(ordinal===1) throw Error('upload failed');
        return await f.github(path,settings);
      } finally {finished++;}
    }
    return f.github(path,settings);
  };
  await assert.rejects(publication.ensurePublicPublication({...options(f),github}),/upload failed/);
  assert.equal(started,2,'Both independent uploads start before the failure');
  assert.equal(finished,2,'No request may escape the rejected publication');
  assert.equal(f.refs.has('public-data/'+A),false);
});

test('matching request-local source snapshots reuse inventory and still validate every source boundary', async () => {
  const f=publicRepository();
  const record=f.commits.get(A);
  const sourceSnapshot={commit:A,record,entries:f.trees.get(record.tree.sha)};
  const artifact=await publication.ensurePublicPublication({...options(f),sourceSnapshot});
  assert.equal(f.calls.filter(call=>call.path.includes('/git/commits/'+A)||call.path.includes('/git/trees/'+record.tree.sha)).length,0);
  assert.equal(artifactFile(f,artifact,`posts/${ID}.json`).value.markdown,'Original body');
  const invalid=publicRepository();
  await assert.rejects(publication.ensurePublicPublication({...options(invalid),sourceSnapshot:{...sourceSnapshot,commit:B}}));
  assert.equal(invalid.refs.has('public-data/'+A),false);
  await assert.rejects(publication.ensurePublicPublication({...options(invalid),sourceSnapshot:{...sourceSnapshot,entries:sourceSnapshot.entries.map(entry=>({...entry,size:-1}))}}));
  assert.equal(invalid.refs.has('public-data/'+A),false);
});

test('incremental publication reads one changed source and reuses unchanged JSON blobs', async () => {
  const f = publicRepository({ [`posts/${OTHER}/Other.md`]: document('Other body', {title:'Other',private_note:'SECRET'}, OTHER) });
  const first = await publication.ensurePublicPublication(options(f));
  nextSource(f, B, A, { [`posts/${ID}/Title.md`]: document('Changed body') });
  f.calls.length = 0;
  const second = await publication.ensurePublicPublication({ ...options(f), commit: B });
  const reads = f.calls.filter(call => call.host === 'raw.githubusercontent.com' && call.path.endsWith('.md'));
  assert.deepEqual(reads.map(call => call.path.split('/').at(-2)), [ID]);
  assert.equal(artifactFile(f, first, `posts/${OTHER}.json`).sha, artifactFile(f, second, `posts/${OTHER}.json`).sha);
  assert.equal(artifactFile(f, second, `posts/${ID}.json`).value.markdown, 'Changed body');
  assert.equal(artifactFile(f, second, 'generation.json').value.reusedPosts, 1);
  assert.ok(!JSON.stringify(artifactFile(f, second, 'generation.json').value).includes('SECRET'));
});

test('unchanged source push reads no Markdown and reuses every public body', async () => {
  const f = publicRepository();
  const first = await publication.ensurePublicPublication(options(f));
  nextSource(f, B, A);
  f.calls.length = 0;
  const second = await publication.ensurePublicPublication({ ...options(f), commit: B });
  assert.equal(f.calls.filter(call => call.path.endsWith('.md')).length, 0);
  assert.equal(artifactFile(f, first, `posts/${ID}.json`).sha, artifactFile(f, second, `posts/${ID}.json`).sha);
  assert.equal(artifactFile(f, second, 'index.json').value.contentCommit, B);
});


async function assertFullParity(f, commit, artifact) {
  const full = await publication.generatePublicFiles({ ...options(f), commit });
  for (const [path, bytes] of full) {
    if (path === 'manifest.json' || path === 'generation.json') continue;
    assert.equal(JSON.stringify(artifactFile(f, artifact, path).value), JSON.stringify(JSON.parse(bytes)), path);
  }
}

test('new and deleted link targets regenerate unresolved Markdown/Notion dependents only', async () => {
  const third = '32345678-1234-1234-1234-123456789abc';
  const links = `[md](../${OTHER}/Other.md) [notion](https://notion.so/${OTHER.replaceAll('-', '')})`;
  const f = publicRepository({ [`posts/${ID}/Title.md`]: document(links), [`posts/${third}/Other.md`]: document('unrelated', {title:'Other'}, third) });
  const first = await publication.ensurePublicPublication(options(f));
  nextSource(f, B, A, { [`posts/${OTHER}/Other.md`]: document('new', {title:'Other'}, OTHER) });
  f.calls.length = 0;
  const second = await publication.ensurePublicPublication({ ...options(f), commit:B });
  assert.deepEqual(new Set(f.calls.filter(call => call.path.endsWith('.md')).map(call=>call.path.split('/').at(-2))),new Set([ID,OTHER]));
  assert.equal(artifactFile(f, second, `posts/${ID}.json`).value.markdown, `[md](#/post/${OTHER}) [notion](#/post/${OTHER})`);
  assert.equal(artifactFile(f,first,`posts/${third}.json`).sha,artifactFile(f,second,`posts/${third}.json`).sha);
  await assertFullParity(f,B,second);
  const c='c'.repeat(40);
  nextSource(f,c,B);
  f.calls.length=0;
  const deleted=await publication.ensurePublicPublication({...options(f),commit:c});
  assert.equal(artifactFile(f,deleted,`posts/${OTHER}.json`),undefined);
  assert.equal(artifactFile(f,deleted,`posts/${ID}.json`).value.markdown,links);
  assert.equal(f.calls.filter(call=>call.path.endsWith('.md')).length,1);
  await assertFullParity(f,c,deleted);
});

test('an ancestor category change regenerates inheriting children and leaves unrelated bodies reusable', async () => {
  const categories=[{id:'first',name:'First',parent_id:null,order:0,sources:[]},{id:'second',name:'Second',parent_id:null,order:1,sources:[]}];
  const f=publicRepository({'categories.json':JSON.stringify(categories),[`posts/${ID}/Title.md`]:document('root',{category_id:'first'}),[`posts/${OTHER}/Other.md`]:document('child',{title:'Other',parent_id:ID},OTHER)});
  await publication.ensurePublicPublication(options(f));
  nextSource(f,B,A,{[`posts/${ID}/Title.md`]:document('root',{category_id:'second'})});
  f.calls.length=0;
  const artifact=await publication.ensurePublicPublication({...options(f),commit:B});
  assert.equal(f.calls.filter(call=>call.path.endsWith('.md')).length,2);
  assert.equal(artifactFile(f,artifact,`posts/${OTHER}.json`).value.categoryId,'second');
  await assertFullParity(f,B,artifact);
});

test('unchanged attachments keep pinned URLs; changed attachment bytes invalidate only their owner', async () => {
  const f=publicRepository({[`posts/${ID}/Title.md`]:document('![asset](./image.png)',{cover:'./image.png'}),[`posts/${ID}/image.png`]:'old', [`posts/${OTHER}/Other.md`]:document('other',{title:'Other'},OTHER)});
  const first=await publication.ensurePublicPublication(options(f));
  nextSource(f,B,A,{[`posts/${OTHER}/Other.md`]:document('changed',{title:'Other'},OTHER)});
  const second=await publication.ensurePublicPublication({...options(f),commit:B});
  assert.equal(artifactFile(f,first,`posts/${ID}.json`).sha,artifactFile(f,second,`posts/${ID}.json`).sha);
  assert.ok(artifactFile(f,second,`posts/${ID}.json`).value.cover.includes('/'+A+'/'));
  const c='c'.repeat(40);nextSource(f,c,B,{[`posts/${ID}/image.png`]:'new',[`posts/${OTHER}/Other.md`]:document('changed',{title:'Other'},OTHER)});
  f.calls.length=0;
  const third=await publication.ensurePublicPublication({...options(f),commit:c});
  assert.deepEqual(f.calls.filter(call=>call.path.endsWith('.md')).map(call=>call.path.split('/').at(-2)),[ID]);
  assert.ok(artifactFile(f,third,`posts/${ID}.json`).value.cover.includes('/'+c+'/'));
  await assertFullParity(f,c,third);
});

test('renamed aliases preserve resolved links while removed aliases invalidate dependents', async () => {
  const alias=`posts/${OTHER}/Other.md`;
  const f=publicRepository({[`posts/${ID}/Title.md`]:document(`[other](../${OTHER}/Other.md)`),[alias]:document('other',{title:'Other'},OTHER)});
  const first=await publication.ensurePublicPublication(options(f));
  nextSource(f,B,A,{[`posts/${OTHER}/Renamed.md`]:document('other',{title:'Renamed',legacy_path:alias},OTHER)},[alias]);
  f.calls.length=0;
  const second=await publication.ensurePublicPublication({...options(f),commit:B});
  assert.equal(f.calls.filter(call=>call.path.endsWith('.md')).length,1);
  assert.equal(artifactFile(f,first,`posts/${ID}.json`).sha,artifactFile(f,second,`posts/${ID}.json`).sha);
  const c='c'.repeat(40);nextSource(f,c,B,{[`posts/${OTHER}/Renamed.md`]:document('other',{title:'Renamed'},OTHER)},[alias]);
  f.calls.length=0;
  const third=await publication.ensurePublicPublication({...options(f),commit:c});
  assert.equal(f.calls.filter(call=>call.path.endsWith('.md')).length,2);
  assert.equal(artifactFile(f,third,`posts/${ID}.json`).value.markdown,`[other](../${OTHER}/Other.md)`);
  await assertFullParity(f,c,third);
});

test('reused graph facts still reject cycles, missing references and unsafe changed content before publication', async () => {
  for (const kind of ['cycle','reference','unsafe']) {
    const f=publicRepository({[`posts/${OTHER}/Other.md`]:document('child',{title:'Other',parent_id:ID,related_ids:kind==='reference'?[ID]:[]},OTHER)});
    await publication.ensurePublicPublication(options(f));
    if(kind==='cycle') nextSource(f,B,A,{[`posts/${ID}/Title.md`]:document('root',{parent_id:OTHER})});
    if(kind==='reference') nextSource(f,B,A,{},[`posts/${ID}/Title.md`]);
    if(kind==='unsafe') nextSource(f,B,A,{[`posts/${ID}/Title.md`]:document('[bad](javascript:alert)')});
    await assert.rejects(publication.ensurePublicPublication({...options(f),commit:B}));
    assert.equal(f.refs.has('public-data/'+B),false);
  }
});

test('generation cache excludes arbitrary category metadata as well as document metadata', async () => {
  const category={id:'group:unclassified',name:'Other',parent_id:null,order:0,sources:[],private_note:'SECRET'};
  const f=publicRepository({'categories.json':JSON.stringify([category])});
  const files=await publication.generatePublicFiles(options(f));
  assert.ok([...files.values()].every(bytes=>!bytes.toString().includes('SECRET')),'No generated file may copy private category extensions');
});
