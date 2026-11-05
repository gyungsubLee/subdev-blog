// Disposable real-GitHub measurement. Uses real OAuth/session/CSRF and production queue modules.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createServer as createVite, loadEnv } from 'vite';
import { handleRequest } from '../../app/server/src/handler.mjs';
import { traceRequest, profileFetch } from './save-trace.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const folder=path.resolve(root,process.env.MEASURE_FOLDER??'docs/research/2026-11-05-optimistic-workflow');
await mkdir(folder,{recursive:true});
const env=loadEnv('development',root,['CMS_','GITHUB_']);
env.GITHUB_PUBLIC_TOKEN=execFileSync('gh',['auth','token'],{encoding:'utf8',timeout:15000}).trim();
const ownerOrigin=env.CMS_ORIGIN;
const rows=[],browser=[];
const fetcher=(url,options)=>profileFetch(url,options,globalThis.fetch);
const vite=await createVite({configFile:false,root,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
let origin;
const requestHandler=async(incoming,response)=>{
  try {
    const url=new URL(incoming.url,origin??ownerOrigin);
    if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/__measure/')) {
      const chunks=[];let length=0;
      for await(const chunk of incoming){length+=chunk.length;if(length>4*1024*1024)throw Error('Oversized measurement request');chunks.push(chunk);}
      const body=chunks.length?Buffer.concat(chunks):undefined;
      if(url.pathname==='/__measure/events'&&incoming.method==='POST') {
        browser.push(JSON.parse(body));await persist();response.writeHead(204);response.end();return;
      }
      if(url.pathname==='/__measure/report') {response.setHeader('Content-Type','application/json');response.end(JSON.stringify({origin,rows,browser}));return;}
      if(url.pathname==='/__measure/control') {
        response.setHeader('Content-Type','text/html; charset=utf-8');response.setHeader('Cache-Control','no-store');
        response.end(await readFile(path.resolve(root,process.env.MEASURE_CONTROL??'tests/e2e/optimistic-control.html')));return;
      }
      if(url.pathname.startsWith('/api/')) {
        const headers=new Headers(incoming.headers);headers.delete('host');
        if(headers.get('origin')===origin)headers.set('origin',ownerOrigin);
        const started=performance.now(),at=new Date().toISOString();
        const measured=await traceRequest(()=>handleRequest(new Request(new URL(url.pathname+url.search,ownerOrigin),{method:incoming.method,headers,body}),{
          env,fetcher,
        }));
        const result=measured.result,bytes=Buffer.from(await result.arrayBuffer());
        let identity;
        if(url.pathname==='/api/content'&&incoming.method==='POST'&&result.ok){const data=JSON.parse(bytes);identity={state:data.state,contentCommit:data.contentCommit,candidateCommit:data.candidateCommit,requestId:data.requestId,payloadHash:createHash('sha256').update(JSON.stringify(JSON.parse(body))).digest('hex')};}
        rows.push({path:url.pathname+(url.pathname.startsWith('/api/auth/')?'':url.search),method:incoming.method,status:result.status,at,ms:performance.now()-started,requestBytes:body?.length??0,responseBytes:bytes.length,...identity,trace:measured.trace});
        for(const[name,value]of result.headers)if(name!=='set-cookie')response.setHeader(name,value);
        const cookies=result.headers.getSetCookie();if(cookies.length)response.setHeader('Set-Cookie',cookies);
        response.setHeader('Server-Timing',`handler;dur=${(performance.now()-started).toFixed(3)}`);
        response.writeHead(result.status);response.end(bytes);await persist();return;
      }
    }
    vite.middlewares(incoming,response,()=>{response.writeHead(404);response.end();});
  }catch(error){response.writeHead(500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:error.status?error.message:'Measurement failed'}));}
};
const server=createServer(requestHandler);
async function persist(){await writeFile(path.join(folder,'live-report.json'),JSON.stringify({origin,rows,browser},null,2));}
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(process.env.MEASURE_PORT??0),'127.0.0.1',resolve);});
origin='http://127.0.0.1:'+server.address().port;
await writeFile(path.join(root,'.tmp/optimistic-workflow/server.json'),JSON.stringify({origin,ownerOrigin}));
console.log(JSON.stringify({origin,ownerOrigin,modules:'current source',session:'real OAuth/CSRF; original origin binding retained'}));
// Own the normal OAuth callback port only when no process already listens there.
let callbackServer;
const ownerUrl=new URL(ownerOrigin);
if(ownerUrl.hostname==='127.0.0.1'||ownerUrl.hostname==='localhost'){
  const candidate=createServer(requestHandler);
  await new Promise(resolve=>{candidate.once('error',error=>{if(error.code!=='EADDRINUSE')console.error('Callback listener unavailable');resolve();});candidate.listen(Number(ownerUrl.port),'127.0.0.1',()=>{callbackServer=candidate;resolve();});});
}
let closing=false;
async function close(){if(closing)return;closing=true;await persist();server.closeAllConnections();callbackServer?.closeAllConnections();await Promise.all([vite.close(),new Promise(resolve=>server.close(resolve)),...(callbackServer?[new Promise(resolve=>callbackServer.close(resolve))]:[])]);process.exit(0);}
process.once('SIGINT',close);process.once('SIGTERM',close);setTimeout(close,45*60*1000);
