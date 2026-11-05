import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import {createPublicE2EServer} from '../support/public-e2e-server.mjs';
import {ID,document} from '../support/public-repository.mjs';

const second='22345678-1234-1234-1234-123456789abc';
test('HTTP E2E: a category and two posts use one atomic commit instead of three serial saves', {timeout:30000}, async()=>{
  const measurements=[];
  for(const mode of ['serial','bulk']) {
    const server=await createPublicE2EServer({apiLatencyMs:350,files:{['posts/'+second+'/Title.md']:document('Second body',{},second)}});
    try {
      const login=await fetch(server.origin+'/__e2e/login',{redirect:'manual',signal:AbortSignal.timeout(5000)});
      const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
      const call=async(path,body)=>{
        const response=await fetch(server.origin+path,{method:body?'POST':'GET',headers:{cookie,Origin:server.origin,'x-csrf-token':'e2e-csrf','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
        const value=await response.json();assert.equal(response.status,200,value.error);return value;
      };
      const category=await call('/api/content?kind=categories');
      const one=await call('/api/content?kind=post&id='+ID);
      const two=await call('/api/content?kind=post&id='+second);
      const added={id:'test-category',name:'Bulk category',parent_id:null,order:1,sources:[]};
      const operations=[{type:'categories.save',baseRevision:category.revision,categories:[...category.categories,added]},
        ...[one,two].map((source,index)=>({type:'post.update',id:source.document.metadata.id,baseRevision:source.revision,changes:{title:'Bulk '+index,category_id:added.id}}))];
      const start=performance.now();let commit=one.contentCommit;let result;let payload;
      if(mode==='serial') {
        for(const operation of operations) {result=await call('/api/content',{requestId:crypto.randomUUID(),baseCommit:commit,operation});commit=result.contentCommit;}
      } else {
        payload={requestId:crypto.randomUUID(),baseCommit:commit,operations};
        result=await call('/api/content',payload);commit=result.contentCommit;
      }
      const elapsedMs=performance.now()-start;
      const count=()=>[...server.f.commits.values()].filter(item=>item.message?.startsWith('cms-request:')).length;
      assert.equal(count(),mode==='bulk'?1:3);
      if(mode==='bulk') {
        const retried=await call('/api/content',payload);assert.equal(retried.contentCommit,commit);assert.equal(count(),1);
        assert.equal(result.receipt.requestId,payload.requestId);
      }
      for(const id of [ID,second])assert.equal((await call('/api/content?kind=post&id='+id)).document.metadata.category_id,added.id);
      measurements.push({mode,operations:3,requests:mode==='bulk'?1:3,sourceCommits:count(),elapsedMs,apiLatencyMs:350});
    } finally {await server.close();}
  }
  await mkdir('docs/research/2026-11-04-local-first-sync',{recursive:true});
  await writeFile('docs/research/2026-11-04-local-first-sync/http-bulk.json',JSON.stringify(measurements,null,2)+'\n');
});
