// Scope: exactly two reviewed generator files on the existing dedicated branch,
// plus its existing content-repository pin. Application main is never changed.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const folder=new URL('./',import.meta.url);
const app='repos/gyungsubLee/subdev-blog',content='repos/gyungsubLee/subdev-blog-content';
const branch='codex/public-content-generator-20261104';
const expected='624cdbaa2076bb4db83839fb67985fa4838168b3';
const api=(path,input)=>JSON.parse(execFileSync('gh',['api',path,...(input?['--method',input.method??'POST','--input','-']:[])],{input:input?JSON.stringify(input.body):undefined,encoding:'utf8',timeout:30000,maxBuffer:3*1024*1024}));
const current=api(app+'/git/ref/heads/'+branch).object.sha;
const pin=api(content+'/actions/variables/PUBLIC_GENERATOR_APP_SHA').value;
if(current!==expected||pin!==expected)throw Error('Generator ref/pin changed; reconcile before writing');
const main=api(app+'/git/ref/heads/main').object.sha;
const base=api(app+'/git/commits/'+expected);
const paths=['app/server/src/public-publication.mjs','app/content/scripts/publish-public-content.mjs'];
const tree=await Promise.all(paths.map(async path=>({path,mode:'100644',type:'blob',content:await readFile(new URL('../../../'+path,folder),'utf8')})));
const createdTree=api(app+'/git/trees',{body:{base_tree:base.tree.sha,tree}});
const created=api(app+'/git/commits',{body:{message:'fix(content): publish verified source through monotonic ready ref',tree:createdTree.sha,parents:[expected]}});
const result={before:expected,commit:created.sha,tree:createdTree.sha,paths,appMain:main,branch};
await writeFile(new URL('remote-generator.json',folder),JSON.stringify(result,null,2)+'\n');
api(app+'/git/refs/heads/'+branch,{method:'PATCH',body:{sha:created.sha,force:false}});
// gh api PATCH returns an empty204 for repository variables.
execFileSync('gh',['api',content+'/actions/variables/PUBLIC_GENERATOR_APP_SHA','--method','PATCH','--input','-'],{input:JSON.stringify({name:'PUBLIC_GENERATOR_APP_SHA',value:created.sha}),encoding:'utf8',timeout:30000});
result.verifiedBranch=api(app+'/git/ref/heads/'+branch).object.sha;
result.verifiedPin=api(content+'/actions/variables/PUBLIC_GENERATOR_APP_SHA').value;
result.verifiedAppMain=api(app+'/git/ref/heads/main').object.sha;
if(result.verifiedBranch!==created.sha||result.verifiedPin!==created.sha||result.verifiedAppMain!==main)throw Error('Remote verification mismatch');
await writeFile(new URL('remote-generator.json',folder),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
