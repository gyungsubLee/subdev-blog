import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
import {generatePublicFiles} from '../../app/server/src/public-publication.mjs';
import {handlePublicRequest as current} from '../../app/server/src/public-content.mjs';
const root=new URL('../../../',import.meta.url);
const sourceCommit='723231cd3cedd4702d2d77ced9190e63387e852d';
const content=new URL('content',root).pathname;
const git=(...args)=>execFileSync('git',['-C',content,...args],{maxBuffer:64*1024*1024,timeout:15000});
const treeSha=git('rev-parse',sourceCommit+'^{tree}').toString().trim();
const entries=git('ls-tree','-r','-l','-z',sourceCommit).toString().split('\0').filter(Boolean).map(line=>{
  const [header,path]=line.split('\t');
  const [mode,type,sha,size]=header.trim().split(/\s+/);
  return {path,mode,type,sha,size:Number(size)};
});
const sourceEntries=entries.filter(entry=>entry.path==='categories.json'||/^posts\/[^/]+\/[^/]+\.md$/i.test(entry.path));
const hashes=[...new Set(sourceEntries.map(entry=>entry.sha))];
const batch=execFileSync('git',['-C',content,'cat-file','--batch'],{input:hashes.join('\n')+'\n',maxBuffer:64*1024*1024,timeout:15000});
const blobs=new Map();
let cursor=0;
for(const hash of hashes) {
  const newline=batch.indexOf(10,cursor);
  const [actual,type,length]=batch.subarray(cursor,newline).toString().split(' ');
  assert.equal(actual,hash);assert.equal(type,'blob');
  const start=newline+1;
  blobs.set(hash,batch.subarray(start,start+Number(length)));
  cursor=start+Number(length)+1;
}
const paths=new Map(sourceEntries.map(entry=>[entry.path,blobs.get(entry.sha)]));
const repository='gyungsubLee/subdev-blog-content';
const artifact='f'.repeat(40);
let generated;
let requests=[];
const fetcher=async input=>{
  const url=new URL(input);
  const pathname=decodeURIComponent(url.pathname);
  requests.push(pathname);
  if(url.host==='api.github.com') {
    const path=pathname.replace('/repos/'+repository,'');
    if(path==='') return Response.json({private:false});
    if(path==='/git/ref/heads/main') return Response.json({object:{type:'commit',sha:sourceCommit}});
    if(path==='/git/ref/heads/public-data/'+sourceCommit) return generated?Response.json({object:{type:'commit',sha:artifact}}):Response.json({},{status:404});
    if(path==='/git/commits/'+sourceCommit) return Response.json({sha:sourceCommit,tree:{sha:treeSha}});
    if(path==='/git/trees/'+treeSha) return Response.json({truncated:false,tree:entries});
    throw Error('Unexpected fixture API request: '+path);
  }
  const [,owner,repo,commit,...parts]=pathname.split('/');
  assert.equal(owner+'/'+repo,repository);
  const path=parts.join('/');
  const bytes=commit===artifact?generated?.get(path):commit===sourceCommit?paths.get(path):undefined;
  return bytes?new Response(bytes):new Response('Missing',{status:404});
};
const github=async path=>(await fetcher('https://api.github.com/repos/'+repository+path)).json();
const catalog=JSON.parse(await readFile(new URL('app/server/generated/content-catalog.json',root)));
const digest=value=>createHash('sha256').update(value).digest('hex');
const sourcePaths=['app/server/src/public-content.mjs','app/server/src/public-publication.mjs','app/server/src/public-files.mjs','app/server/src/github.mjs','app/content/src/content.mjs','app/server/generated/content-catalog.json','package-lock.json'];
const sourceHashes={};
for(const path of sourcePaths) sourceHashes[path]=digest(await readFile(new URL(path,root)));
let oldSource=await readFile(new URL('docs/research/2026-11-04-precomputed-public-content/reader-before.mjs',root),'utf8');
oldSource=oldSource.replace(/from '([^']+)'/g,(match,name)=>name.startsWith('.')?`from '${new URL(name,new URL('app/server/src/public-content.mjs',root)).href}'`:match);
const {handlePublicRequest:previous}=await import('data:text/javascript;base64,'+Buffer.from(oldSource).toString('base64'));
requests=[];
const generationStart=performance.now();
generated=await generatePublicFiles({commit:sourceCommit,repository,github,fetcher,catalog});
const generation={ms:performance.now()-generationStart,requests:requests.length,files:generated.size,bytes:[...generated.values()].reduce((sum,bytes)=>sum+bytes.length,0),transport:'Exact local Git objects, not live network'};
const rows=[];
async function measure(label,handler,transport,query='kind=index') {
  requests=[];
  const start=performance.now();
  const response=await handler(new Request('https://measure.test/api/public?'+query,{headers:{'Accept-Encoding':'gzip'}}),{env:{},fetcher:transport,catalog});
  const ms=performance.now()-start;
  const wire=Buffer.from(await response.arrayBuffer());
  const raw=response.headers.get('content-encoding')==='gzip'?gunzipSync(wire):wire;
  assert.equal(response.status,200,label+': request must succeed');
  const data=JSON.parse(raw);
  const row={label,ms:Math.round(ms*10)/10,status:response.status,requests:requests.length,paths:[...requests],wireBytes:wire.length,jsonBytes:raw.length,digest:digest(raw)};
  rows.push(row);
  console.log(JSON.stringify({...row,paths:undefined}));
  return data;
}
for(let i=0;i<3;i++) {
  const old=await measure('before-cold-'+i,previous,(...args)=>fetcher(...args));
  const next=await measure('after-cold-'+i,current,(...args)=>fetcher(...args));
  assert.equal(digest(JSON.stringify(old)),digest(JSON.stringify(next)),'Index parity');
}
const oldTransport=(...args)=>fetcher(...args);
const newTransport=(...args)=>fetcher(...args);
const index=await measure('before-prepare',previous,oldTransport);
await measure('after-prepare',current,newTransport);
for(let i=0;i<3;i++) await measure('after-warm-'+i,current,newTransport);
const ids=['3f4eda9b-0fe1-8004-89ff-c68ec5620797',index.posts[0].id,index.posts.find(post=>post.cover)?.id].filter(Boolean);
for(const id of new Set(ids)) {
  const query=new URLSearchParams({kind:'post',id,commit:sourceCommit});
  const old=await measure('before-post-'+id,previous,oldTransport,query);
  const next=await measure('after-post-'+id,current,newTransport,query);
  assert.equal(digest(JSON.stringify(old)),digest(JSON.stringify(next)),'Full post parity');
}
for(const [path,hash] of Object.entries(sourceHashes)) assert.equal(digest(await readFile(new URL(path,root))),hash,'Source changed during final measurement');
const result={measuredAt:new Date().toISOString(),node:process.version,sourceCommit,posts:index.posts.length,sourceHashes,generation,rows,scope:'Controlled same-source Git-object replay. No remote writes or network timing; deployed startup, transport and rendering excluded.'};
await writeFile(new URL('docs/research/2026-11-04-precomputed-public-content/measurement-rerun.json',root),JSON.stringify(result,null,2)+'\n');
