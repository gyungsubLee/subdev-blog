import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
const exec=promisify(execFile),folder=new URL('./',import.meta.url);
const state=JSON.parse(await readFile(new URL('state-after.json',folder),'utf8'));
const content='repos/gyungsubLee/subdev-blog-content',app='repos/gyungsubLee/subdev-blog';
const api=async path=>JSON.parse((await exec('gh',['api',path],{encoding:'utf8',timeout:30000})).stdout);
const [head,ready,pin,generator,main]=await Promise.all([
  api(content+'/git/ref/heads/main'),api(content+'/git/ref/heads/public-ready/main'),
  api(content+'/actions/variables/PUBLIC_GENERATOR_APP_SHA'),api(app+'/git/ref/heads/codex/public-content-generator-20261104'),api(app+'/git/ref/heads/main'),
]);
if(head.object.sha!==state.head)throw Error('Canonical changed after immutable inventory capture');
state.finalMetadataAt=new Date().toISOString();state.finalHeadVerified=head.object.sha;
state.ready=ready.object.sha;state.pin=pin.value;state.generator=generator.object.sha;state.appMain=main.object.sha;
if(state.pin!==state.generator||state.ready!==state.head)throw Error('Final ready/generator verification mismatch');
await writeFile(new URL('state-after.json',folder),JSON.stringify(state,null,2)+'\n');
console.log(JSON.stringify({head:state.head,ready:state.ready,allFiles:state.blobFiles,posts:state.posts,sameOriginals:state.sameOriginals,generator:state.generator,appMain:state.appMain}));
