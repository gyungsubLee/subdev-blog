import { authorizedSession } from './authorized-session.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { isEditorFilename } from '../../app/shared/editor-document.mjs';
import { handleRequest } from '../../app/server/src/handler.mjs';
import { loadConfig, seal, setCookie } from '../../app/server/src/auth.mjs';
import { createGitHubClient } from '../../app/server/src/github.mjs';
import { publishPublicSource } from '../../app/server/src/public-publication.mjs';
import { publicRepository, A, REPOSITORY } from './public-repository.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const defaultWebRoot = path.join(root, 'dist/web');

function loadCanonicalObjects(f) {
  const git = (...args) => execFileSync('git', ['-C', path.join(root,'content'), ...args], {maxBuffer:64*1024*1024, timeout:15000});
  const commit = git('rev-parse','HEAD').toString().trim();
  const tree = git('rev-parse',commit+'^{tree}').toString().trim();
  const entries = git('ls-tree','-r','-l','-z',commit).toString().split('\0').filter(Boolean).map(line=>{
    const [header,filename]=line.split('\t');
    const [mode,type,sha,size]=header.trim().split(/\s+/);
    return {path:filename,mode,type,sha,size:Number(size)};
  });
  const inputs=entries.filter(entry=>entry.path==='categories.json'||/^posts\/[^/]+\/[^/]+\.(?:md|json)$/i.test(entry.path));
  const hashes=[...new Set(inputs.map(entry=>entry.sha))];
  // cat-file needs a batch input; use one bounded process instead of one process per post.
  const output=execFileSync('git',['-C',path.join(root,'content'),'cat-file','--batch'],{input:hashes.join('\n')+'\n',maxBuffer:64*1024*1024,timeout:15000});
  let cursor=0;
  for(const hash of hashes) {
    const newline=output.indexOf(10,cursor);
    const [actual,type,length]=output.subarray(cursor,newline).toString().split(' ');
    if(actual!==hash||type!=='blob') throw Error('Invalid local Git object');
    const start=newline+1;
    f.blobs.set(hash,output.subarray(start,start+Number(length)));
    cursor=start+Number(length)+1;
  }
  f.commits.set(commit,{sha:commit,tree:{sha:tree},parents:[]});
  f.trees.set(tree,entries);
  f.refs.set('main',commit);
  return commit;
}

export async function createPublicE2EServer({canonical=false, files={}, port=0, hostname='127.0.0.1', legacyPublicHandler, webRoot=defaultWebRoot, apiLatencyMs=0}={}) {
  const f=publicRepository(files);
  const sourceCommit=canonical?loadCanonicalObjects(f):A;
  const apiRows=[];
  const browserRows=[];
  const controlKey=randomBytes(16).toString('hex');
  const env={
    CMS_ORIGIN:'http://127.0.0.1',GITHUB_CLIENT_ID:'e2e-client',GITHUB_CLIENT_SECRET:'e2e-secret',CMS_SESSION_KEY:randomBytes(32).toString('hex'),
    GITHUB_ADMIN_USER_ID:'42',GITHUB_APP_ID:'11',GITHUB_INSTALLATION_ID:'12',GITHUB_APP_REPOSITORY_ID:'13',GITHUB_CONTENT_REPOSITORY_ID:'14',GITHUB_APP_BRANCH:'main',GITHUB_CONTENT_BRANCH:'main',
  };
  let githubCalls=0;
  let githubMutations=0;
  const gateway=async (url, options={})=>{
    githubCalls++;
    const parsed=new URL(url);
    const graphqlQuery=parsed.pathname==='/graphql'&&/^\s*(query\b|\{)/.test(options.body?JSON.parse(options.body).query??'':'');
    if((options.method??'GET')!=='GET'&&!graphqlQuery)githubMutations++;
    const pathname=decodeURIComponent(parsed.pathname);
    const app='/repos/gyungsubLee/subdev-blog';
    const content='/repos/'+REPOSITORY;
    if(pathname==='/user') return Response.json({id:42,login:'e2e-owner',name:'E2E owner'});
    if(pathname==='/user/installations') return Response.json({installations:[{id:12,app_id:11,permissions:{contents:'write',metadata:'read'}}]});
    if(pathname==='/user/installations/12/repositories') return Response.json({total_count:2,repositories:[{id:13},{id:14}]});
    if(pathname===app||pathname===content) return Response.json({id:pathname===app?13:14,default_branch:'main',private:false,permissions:{push:true}});
    if(pathname===app+'/branches/main'||pathname===content+'/branches/main') return Response.json({commit:{sha:pathname.startsWith(app+'/')?'b'.repeat(40):f.refs.get('main')}});
    if(pathname===app+'/contents/content') return Response.json({type:'submodule',sha:sourceCommit,submodule_git_url:'https://github.com/'+REPOSITORY+'.git'});
    if(pathname===app+'/contents/.gitmodules') return Response.json({content:Buffer.from('[submodule "content"]\n path = content\n url = https://github.com/'+REPOSITORY+'.git\n').toString('base64')});
    if(pathname.startsWith(content+'/contents/')) return Response.json({type:pathname.endsWith('/posts')?'dir':'file'});
    return f.fetcher(url,options);
  };
  let activeFetcher=(...args)=>gateway(...args);
  const client=createGitHubClient('test-only',gateway);
  const scoped=(pathname, options)=>client('/repos/'+REPOSITORY+pathname,options);
  const started=performance.now();
  const catalog=JSON.parse(await readFile(path.join(root,'app/server/generated/content-catalog.json'),'utf8'));
  const publication=legacyPublicHandler ? null : await publishPublicSource({commit:sourceCommit,repository:REPOSITORY,github:scoped,fetcher:gateway,catalog});
  const artifact=publication?.publicationCommit;
  const bootstrap={sourceCommit,artifact,ms:performance.now()-started,transport:'Local disposable GitHub protocol fixture',posts:artifact ? JSON.parse(f.blobs.get(f.trees.get(f.commits.get(artifact).tree.sha).find(entry=>entry.path==='index.json').sha)).posts.length : f.trees.get(f.commits.get(sourceCommit).tree.sha).filter(entry=>/\.md$/i.test(entry.path)&&entry.path.startsWith('posts/')).length};
  f.calls.length=0;
  const server=createServer(async (incoming,response)=>{
    try {
      const url=new URL(incoming.url,env.CMS_ORIGIN);
      const chunks=[];
      let size=0;
      for await(const chunk of incoming) {size+=chunk.length;if(size>4*1024*1024) throw Error('Oversized test request');chunks.push(chunk);}
      const body=chunks.length?Buffer.concat(chunks):undefined;
      if(url.pathname.startsWith('/__e2e/assets/')) {
        const [commit,...parts]=decodeURIComponent(url.pathname).slice('/__e2e/assets/'.length).split('/');
        const filename=parts.join('/');
        const entry=f.trees.get(f.commits.get(commit)?.tree.sha)?.find(item=>item.path===filename);
        if(!entry || entry.type!=='blob' || entry.mode!=='100644' || parts.length!==3 || parts[0]!=='posts' || /\.md$/i.test(parts[2]) || isEditorFilename(parts[2])) {
          response.writeHead(404);response.end();return;
        }
        let bytes=f.blobs.get(entry.sha);
        if(!bytes && canonical && /^[a-f0-9]{40}$/.test(entry.sha) && entry.size<=8*1024*1024) {
          bytes=execFileSync('git',['-C',path.join(root,'content'),'cat-file','blob',entry.sha],{timeout:5000,maxBuffer:8*1024*1024});
          f.blobs.set(entry.sha,bytes);
        }
        if(!bytes) {response.writeHead(404);response.end();return;}
        const types={'.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml'};
        response.setHeader('Content-Type',types[path.extname(filename).toLowerCase()]??'application/octet-stream');
        response.end(bytes);return;
      }
      if(url.pathname==='/__e2e/login') {
        const config=loadConfig(env);
        response.setHeader('Set-Cookie',setCookie(seal(authorizedSession(config, {token:'test-only',csrfToken:'e2e-csrf',expires:Date.now()+3600000}),config),config));
        response.writeHead(302,{location:'/'});response.end();return;
      }
      if(url.pathname==='/__e2e/metrics'&&incoming.method==='POST') {
        browserRows.push(JSON.parse(body));response.writeHead(204);response.end();return;
      }
      if(url.pathname==='/__e2e/control'&&incoming.method==='POST'&&incoming.headers['x-e2e-key']===controlKey) {
        const settings=JSON.parse(body);
        if(['before','lost','conflict',null].includes(settings.fault))f.controls.syncFault=settings.fault;
        if(Number.isFinite(settings.delayMs))f.controls.syncDelayMs=Math.max(0,Math.min(10000,settings.delayMs));
        response.writeHead(204);response.end();return;
      }
      if(url.pathname==='/__e2e/sync-control') {
        const { readdir }=await import('node:fs/promises');
        const worker=(await readdir(path.join(webRoot,'assets'))).find(name=>name.startsWith('sync-cleanup.worker-'));
        const template=await readFile(path.join(root,'tests/e2e/sync-control.html'),'utf8');
        response.setHeader('Content-Type','text/html');response.end(template.replaceAll('WORKER_URL',JSON.stringify('/assets/'+worker)));return;
      }
      if(url.pathname==='/__e2e/report') {
        response.setHeader('Content-Type','application/json');response.end(JSON.stringify({bootstrap,apiRows,browserRows,head:f.refs.get('main'),sourceCommits:[...f.commits.values()].filter(commit=>commit.message?.startsWith('cms-request:')).length}));return;
      }
      if(url.pathname==='/__e2e/cold'&&incoming.method==='POST'&&incoming.headers['x-e2e-key']===controlKey) {
        activeFetcher=(...args)=>gateway(...args);response.writeHead(204);response.end();return;
      }
      if(url.pathname.startsWith('/api/')) {
        if(apiLatencyMs)await new Promise(resolve=>setTimeout(resolve,apiLatencyMs));
        const isSync=url.pathname==='/api/content'&&incoming.method==='POST';
        if(isSync&&f.controls.syncDelayMs)await new Promise(resolve=>setTimeout(resolve,f.controls.syncDelayMs));
        const fault=isSync?f.controls.syncFault:null;
        if(isSync)f.controls.syncFault=null;
        if(fault==='before'||fault==='conflict') {
          response.writeHead(fault==='conflict'?409:503,{'Content-Type':'application/json'});response.end(JSON.stringify({error:'Injected '+fault}));return;
        }
        const start=performance.now();
        const before=githubCalls;
        const mutationsBefore=githubMutations;
        const request=new Request(url,{method:incoming.method,headers:incoming.headers,body});
        const result=url.pathname==='/api/public' && legacyPublicHandler
          ? await legacyPublicHandler(request,{env,fetcher:activeFetcher,catalog})
          : await handleRequest(request,{env,fetcher:activeFetcher});
        let bytes=Buffer.from(await result.arrayBuffer());
        if(url.pathname==='/api/public' && result.ok) {
          // Only the external asset transport is substituted; product generation remains unchanged.
          const compressed=result.headers.get('content-encoding')==='gzip';
          const source=compressed?gunzipSync(bytes):bytes;
          const mapped=Buffer.from(source.toString('utf8').replaceAll('https://raw.githubusercontent.com/'+REPOSITORY+'/',env.CMS_ORIGIN+'/__e2e/assets/'));
          bytes=compressed?gzipSync(mapped):mapped;
        }
        const ms=performance.now()-start;
        const operation=body&&incoming.method==='POST'?JSON.parse(body).operation?.type:undefined;
        apiRows.push({path:url.pathname+url.search,method:incoming.method,operation,operations:body&&isSync?JSON.parse(body).operations?.length:undefined,requestId:body&&isSync?JSON.parse(body).requestId:undefined,status:result.status,ms,bytes:bytes.length,githubFixtureCalls:githubCalls-before,githubFixtureWrites:githubMutations-mutationsBefore});
        if(fault==='lost'){response.destroy();f.calls.length=0;return;}
        for(const [name,value] of result.headers) if(name!=='set-cookie') response.setHeader(name,value);
        const cookies=result.headers.getSetCookie();if(cookies.length) response.setHeader('Set-Cookie',cookies);
        response.setHeader('Server-Timing',`handler;dur=${ms.toFixed(3)}`);
        response.writeHead(result.status);response.end(bytes);f.calls.length=0;return;
      }
      if(url.pathname==='/__e2e/metrics.js') {
        response.setHeader('Content-Type','text/javascript');response.end(await readFile(path.join(root,'tests/e2e/browser-metrics.js')));return;
      }
      const filename=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1);
      const absolute=path.resolve(webRoot,filename);
      if(!absolute.startsWith(webRoot+path.sep)) {response.writeHead(404);response.end();return;}
      let bytes=await readFile(absolute);
      const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'};
      response.setHeader('Content-Type',types[path.extname(absolute)]??'application/octet-stream');
      response.setHeader('Cache-Control','no-store');
      if(filename==='index.html') bytes=Buffer.from(bytes.toString().replace('<head>','<head><script src="/__e2e/metrics.js"></script>'));
      response.end(bytes);
    } catch(error) {
      response.writeHead(500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:error.message}));
    }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  env.CMS_ORIGIN='http://'+hostname+':'+server.address().port;
  return {server,origin:env.CMS_ORIGIN,controlKey,f,gateway,env,bootstrap,apiRows,browserRows,close:()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);})};
}
