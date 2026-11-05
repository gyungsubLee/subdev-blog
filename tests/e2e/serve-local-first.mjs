import path from 'node:path';
import {writeFile,mkdir} from 'node:fs/promises';
import {createPublicE2EServer} from '../support/public-e2e-server.mjs';
const root=path.resolve(import.meta.dirname,'../..');
const folder=path.join(root,'.tmp/local-first-e2e');await mkdir(folder,{recursive:true});
const before=await createPublicE2EServer({hostname:'localhost',webRoot:path.join(root,'.tmp/local-first-before-web'),apiLatencyMs:350});
const after=await createPublicE2EServer({hostname:'localhost',apiLatencyMs:350});
await writeFile(path.join(folder,'servers.json'),JSON.stringify({before:{origin:before.origin,key:before.controlKey},after:{origin:after.origin,key:after.controlKey}},null,2));
console.log(JSON.stringify({before:before.origin,after:after.origin}));
let closing=false;async function close(){if(closing)return;closing=true;await writeFile(path.join(folder,'report.json'),JSON.stringify({before:{api:before.apiRows,browser:before.browserRows},after:{api:after.apiRows,browser:after.browserRows}},null,2));await Promise.all([before.close(),after.close()]);process.exit(0);}
process.on('SIGTERM',close);process.on('SIGINT',close);setTimeout(close,30*60*1000);
