import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {loadEnv} from 'vite';
import {loadConfig} from '../../../app/server/src/auth.mjs';
import {handleContentRequest} from '../../../app/server/src/content.mjs';
const token=execFileSync('gh',['auth','token'],{encoding:'utf8',timeout:5000}).trim();
const config=loadConfig(loadEnv('production',process.cwd(),['CMS_','GITHUB_']));
const identity=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
if(!identity.ok||(await identity.json()).id!==config.adminUserId)throw Error('Credential is not configured owner');
let calls=[];
const fetcher=async(url,options)=>{
 const start=performance.now();const response=await fetch(url,options);const bytes=await response.arrayBuffer();
 calls.push({method:options.method,path:new URL(url).pathname,status:response.status,ms:performance.now()-start,bytes:bytes.byteLength});
 const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');return new Response(bytes,{status:response.status,headers});
};
const output={measuredAt:new Date().toISOString(),transport:'real GitHub read only; same owner credential and category contents',samples:[]};
for(let sample=1;sample<=5;sample++)for(const mode of ['direct','cached']){
 calls=[];const start=performance.now();
 const response=await handleContentRequest(new Request(config.origin+'/api/content?kind=categories'+(mode==='direct'?'&refresh=1':'')),{token,config,fetcher});
 const body=await response.json();if(!response.ok)throw Error('Category read failed '+response.status);
 output.samples.push({mode,sample,ms:performance.now()-start,count:body.categories.length,contentCommit:body.contentCommit,revision:body.revision,calls:[...calls]});
}
await writeFile(new URL('./live-category.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output.samples.map(({calls,...sample})=>({...sample,githubRequests:calls.length}))));
