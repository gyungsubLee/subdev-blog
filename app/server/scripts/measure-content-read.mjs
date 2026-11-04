// Deterministic local replay; no network or repository writes.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import { serializeMarkdownDocument } from '../../shared/document.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const blob = value => createHash('sha1').update(`blob ${Buffer.byteLength(value)}\0`).update(value).digest('hex');
const root = new URL('../../../', import.meta.url);
const source = await readFile(new URL('app/server/src/public-content.mjs', root), 'utf8');
const instrumented = source.replace(/from '([^']+)'/g, (match, specifier) => specifier.startsWith('.')
  ? `from '${new URL(specifier, new URL('app/server/src/public-content.mjs', root)).href}'` : match)
  + '\nexport const retained = fetcher => { const c = cacheFor(fetcher, "main"); return { bytes:c.snapshotBytes, snapshots:c.snapshots.size, blobBytes:c.blobBytes }; };';
const { handlePublicRequest, retained } = await import('data:text/javascript;base64,' + Buffer.from(instrumented).toString('base64'));
const A = 'a'.repeat(40), B = 'b'.repeat(40);
const categories = [{ id:'group:unclassified', name:'Other', parent_id:null, order:0, sources:[] }];
const files = { 'categories.json': JSON.stringify(categories) };
const records = [];
let seed = 42;
for (let i = 0; i < 1200; i++) {
  const id = `12345678-1234-1234-1234-${String(i).padStart(12, '0')}`;
  let markdown = '[section](#section)\n\n';
  for (let j = 0; j < 1300; j++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    markdown += String.fromCharCode(0xac00 + ((seed >>> 16) % 64));
  }
  const metadata = { schema_version:1, id, title:'Title', parent_id:null, created:'2026-10-24', updated:'2026-10-24' };
  const filename = `posts/${id}/Title.md`;
  const full = serializeMarkdownDocument({metadata, markdown:markdown + '\nFull body tail'.repeat(200)});
  files[filename] = full;
  records.push({filename, metadata, markdown, blobSha:blob(full), revision:digest(full)});
}
const catalog = {version:1, documents:records};
const changed = {...files, [records[0].filename]:serializeMarkdownDocument({metadata:records[0].metadata, markdown:'Saved body'})};
const rows = [];
function replay() {
  let head = A;
  let calls = 0;
  const fetcher = async input => {
    calls++;
    const url = new URL(input);
    const commit = url.pathname.includes(B) ? B : A;
    const values = commit === B ? changed : files;
    if (url.host === 'raw.githubusercontent.com') return new Response(values[url.pathname.split('/').slice(4).map(decodeURIComponent).join('/')]);
    if (url.pathname.endsWith('/git/ref/heads/main')) return Response.json({object:{type:'commit',sha:head}});
    if (url.pathname.includes('/git/commits/')) return Response.json({sha:commit,tree:{sha:commit}});
    if (url.pathname.includes('/git/trees/')) return Response.json({truncated:false,tree:Object.entries(values).map(([path,value])=>({path,type:'blob',mode:'100644',sha:blob(value),size:Buffer.byteLength(value)}))});
    if (url.pathname.includes('/compare/')) return Response.json({status:'ahead'});
    return Response.json({private:false});
  };
  return {fetcher, advance:()=>{head=B;}, calls:()=>calls};
}
async function measure(label, state, query='kind=index') {
  const calls = state.calls();
  const start = performance.now();
  const response = await handlePublicRequest(new Request('https://measure.test/api/public?' + query,{headers:{'Accept-Encoding':'gzip'}}),{env:{},fetcher:state.fetcher,catalog});
  const ms = performance.now()-start;
  const wire = Buffer.from(await response.arrayBuffer());
  const raw = response.headers.get('Content-Encoding') === 'gzip' ? gunzipSync(wire) : wire;
  if (response.status !== 200) throw new Error(raw.toString());
  rows.push({label,ms,status:response.status,digest:digest(raw),wireDigest:digest(wire),wireBytes:wire.length,jsonBytes:raw.length,calls:state.calls()-calls,retained:retained(state.fetcher)});
}
for(let i=0;i<5;i++) await measure('cold', replay());
const state = replay();
await measure('prepare',state);
for(let i=0;i<10;i++) await measure('warm',state);
await Promise.all([measure('concurrent',state),measure('concurrent',state)]);
for(let i=0;i<2;i++) await measure('post',state,`kind=post&id=${records[0].metadata.id}&commit=${A}`);
state.advance();
await measure('after-save',state,`kind=index&after=${B}`);
const hashes = {};
for(const name of ['app/content/src/content.mjs','app/server/src/public-content.mjs','app/server/src/github.mjs','package-lock.json','app/server/scripts/measure-content-read.mjs']) hashes[name]=digest(await readFile(new URL(name,root)));
const result = {node:process.version,platform:process.platform,arch:process.arch,inputHash:digest(JSON.stringify({files,catalog,changed})),sourceHashes:hashes,rows};
await writeFile(process.argv[2],JSON.stringify(result,null,2)+'\n');
const medians = {};
for (const label of ['cold', 'warm']) {
  const times = rows.filter(row => row.label === label).map(row => row.ms).sort((a, b) => a - b);
  const middle = Math.floor(times.length / 2);
  medians[label] = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
}
const postTimes = rows.filter(row => row.label === 'post').map(row => row.ms);
console.log(JSON.stringify({
  inputHash: result.inputHash,
  mediansMs: medians,
  observationsMs: {
    firstPost: postTimes[0],
    cachedPost: postTimes[1],
    afterSave: rows.find(row => row.label === 'after-save').ms,
  },
}));
