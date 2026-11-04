import { performance } from 'node:perf_hooks';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { loadEnv } from '/Users/igyeongseob/Develop/10_harness/subdev-blog/node_modules/vite/dist/node/index.js';
import { handlePublicRequest } from '/tmp/subdev-public-content-instrumented.mjs';
const root = '/Users/igyeongseob/Develop/10_harness/subdev-blog';
const env = loadEnv('development', root, ['GITHUB_']);
const catalog = JSON.parse(await readFile(root + '/server/content-catalog.json', 'utf8'));
const round = n => Math.round(n * 10) / 10;
const captured = new Map();
let events = [];
const makeFetcher = () => async (url, options) => {
  const start = performance.now();
  const response = await fetch(url, options);
  const headersMs = performance.now() - start;
  const bytes = Buffer.from(await response.arrayBuffer());
  const headers = Object.fromEntries(response.headers);
  delete headers['content-encoding']; delete headers['content-length'];
  captured.set(url, {bytes, status:response.status, headers});
  events.push({url, status:response.status, headersMs:round(headersMs), totalMs:round(performance.now()-start), bytes:bytes.length});
  return new Response(bytes, {status:response.status, headers});
};
const rows = [];
async function measure(label, query, fetcher) {
  events = [];
  const start = performance.now();
  const response = await handlePublicRequest(new Request('http://profile/api/public?' + query, {headers:{'Accept-Encoding':'gzip'}}), {env, fetcher, catalog});
  const handlerMs = performance.now()-start;
  const wire = Buffer.from(await response.arrayBuffer());
  const startDecode = performance.now();
  const raw = response.headers.get('content-encoding') === 'gzip' ? gunzipSync(wire) : wire;
  const data = JSON.parse(raw.toString());
  const row = {label,status:response.status,handlerMs:round(handlerMs),decodeParseMs:round(performance.now()-startDecode),wireBytes:wire.length,jsonBytes:raw.length,requests:events.length,events:[...events]};
  rows.push(row); console.log(JSON.stringify(row));
  if (!response.ok) throw new Error(data.error);
  return data;
}
const deadline = setTimeout(()=>{console.error('profile deadline 90s');process.exit(2)},90000);
try {
  const fetcher = makeFetcher();
  const index = await measure('cold-index','kind=index',fetcher);
  for (let i=1;i<=3;i++) await measure('warm-index-'+i,'kind=index',fetcher);
  const post = index.posts.find(p=>p.id==='3f4eda9b-0fe1-8004-89ff-c68ec5620797') ?? index.posts[0];
  const query = new URLSearchParams({kind:'post',id:post.id,commit:index.contentCommit}).toString();
  await measure('first-post',query,fetcher);
  for (let i=1;i<=3;i++) await measure('cached-post-'+i,query,fetcher);
  const replay = async url => { const saved=captured.get(url); if(!saved) throw new Error('uncaptured URL'); return new Response(saved.bytes,{status:saved.status,headers:saved.headers}); };
  await measure('cold-index-with-network-replayed','kind=index',replay);
  await measure('post-with-network-replayed',query,replay);
  const markdownBytes = index.posts.reduce((n,p)=>n+Buffer.byteLength(p.markdown),0);
  const result = {measuredAt:new Date().toISOString(),tokenConfigured:Boolean(env.GITHUB_PUBLIC_TOKEN),contentCommit:index.contentCommit,posts:index.posts.length,postId:post.id,catalogDocuments:catalog.documents.length,markdownBytes,rows};
  await writeFile('/tmp/subdev-read-profile-stages.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify({summary:{posts:index.posts.length,markdownBytes,postId:post.id,tokenConfigured:result.tokenConfigured}}));
} finally { clearTimeout(deadline); }
