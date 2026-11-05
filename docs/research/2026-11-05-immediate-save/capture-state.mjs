import { execFileSync } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
const folder = new URL('./', import.meta.url);
const phase = process.argv[2];
if (!['before','after'].includes(phase)) throw Error('Use before or after');
const api = path => JSON.parse(execFileSync('gh',['api',path],{encoding:'utf8',timeout:30000,maxBuffer:12*1024*1024}));
const repository = 'repos/gyungsubLee/subdev-blog-content';
const head = api(repository+'/git/ref/heads/main').object.sha;
const record = api(repository+'/git/commits/'+head);
const tree = api(repository+'/git/trees/'+record.tree.sha+'?recursive=1');
if (tree.truncated) throw Error('Incomplete canonical tree');
const files = Object.fromEntries(tree.tree.filter(entry=>entry.type==='blob').map(({path,sha})=>[path,sha]));
const originals = Object.fromEntries(Object.entries(files).filter(([path])=>!path.startsWith('.github/')));
const posts = new Set(Object.keys(files).filter(path=>path.startsWith('posts/')).map(path=>path.split('/')[1])).size;
const result = {phase,at:new Date().toISOString(),head,tree:record.tree.sha,files,originals,blobFiles:Object.keys(files).length,posts,
  generator:api('repos/gyungsubLee/subdev-blog/git/ref/heads/codex/public-content-generator-20261104').object.sha,
  pin:api(repository+'/actions/variables/PUBLIC_GENERATOR_APP_SHA').value};
try { result.ready = api(repository+'/git/ref/heads/public-ready/main').object.sha; } catch { result.ready=null; }
if(phase==='after') {
  const before=JSON.parse(await readFile(new URL('state-before.json',folder),'utf8'));
  const paths=new Set(Object.keys(before.originals));
  result.addedFiles=Object.keys(files).filter(path=>!Object.hasOwn(before.files,path));
  result.originalDifferences=[...paths].filter(path=>before.originals[path]!==originals[path]);
  result.sameOriginals=result.originalDifferences.length===0;
  result.samePosts=before.posts===posts;
}
await writeFile(new URL('state-'+phase+'.json',folder),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({phase,head,blobFiles:result.blobFiles,posts,ready:result.ready,generator:result.generator,pin:result.pin,sameOriginals:result.sameOriginals,differences:result.originalDifferences?.length}));
