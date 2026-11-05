import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createPublicE2EServer } from '../support/public-e2e-server.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const folder=path.join(root,'.tmp/public-data-e2e');
await mkdir(folder,{recursive:true});
const originalLocation=new URL('../../app/server/src/public-content.mjs',import.meta.url);
const beforeLocation=new URL('../../docs/research/2026-11-04-precomputed-public-content/reader-before.mjs',import.meta.url);
const source=(await readFile(beforeLocation,'utf8')).replace(/from '([^']+)'/g,(match,name)=>name.startsWith('.')?`from '${new URL(name,originalLocation).href}'`:match);
const legacy=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const before=await createPublicE2EServer({canonical:true,hostname:'localhost',legacyPublicHandler:legacy.handlePublicRequest});
const after=await createPublicE2EServer({canonical:true,hostname:'localhost'});
await writeFile(path.join(folder,'servers.json'),JSON.stringify({before:{origin:before.origin,key:before.controlKey},after:{origin:after.origin,key:after.controlKey}},null,2));
console.log(JSON.stringify({before:before.origin,after:after.origin,bootstrap:after.bootstrap}));
let closed=false;
async function cleanup() {
  if(closed)return;closed=true;
  await writeFile(path.join(folder,'browser-report.json'),JSON.stringify({before:{bootstrap:before.bootstrap,apiRows:before.apiRows,browserRows:before.browserRows},after:{bootstrap:after.bootstrap,apiRows:after.apiRows,browserRows:after.browserRows}},null,2));
  await Promise.all([before.close(),after.close()]);
  process.exit(0);
}
process.once('SIGTERM',cleanup);process.once('SIGINT',cleanup);
setTimeout(cleanup,15*60*1000);
