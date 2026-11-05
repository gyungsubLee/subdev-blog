import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const token=execFileSync('gh',['auth','token'],{encoding:'utf8',timeout:5000}).trim();
const fields='... on Commit { oid file(path:"categories.json") { mode type object { ... on Blob { text byteSize isBinary } } } }';
const queries={expression:`query { repository(owner:"gyungsubLee",name:"subdev-blog-content") { object(expression:"refs/heads/main") { ${fields} } } }`,ref:`query { repository(owner:"gyungsubLee",name:"subdev-blog-content") { ref(qualifiedName:"refs/heads/main") { target { ${fields} } } } }`};
const results=[];
for(let n=0;n<4;n++)for(const [kind,query] of Object.entries(queries)){
 const start=performance.now();
 const r=await fetch('https://api.github.com/graphql',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(15000)});
 const result=await r.json();
 const value=kind==='ref'?result.data?.repository?.ref?.target:result.data?.repository?.object;
 results.push({kind,n,ms:+(performance.now()-start).toFixed(2),status:r.status,ok:Boolean(value?.file?.object?.text),commit:value?.oid,error:Boolean(result.errors)});
}
await writeFile('docs/research/2026-11-04-category-direct-read/query-diagnostic.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results));
