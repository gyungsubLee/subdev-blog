import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createSyncEngine,cleanupConfirmed,payloadHash,storageBytes,DAY_MS} from '../../../../app/web/src/features/content-management/sync-core.mjs';
const commit='a'.repeat(40),body='x'.repeat(50000);
let data={version:450,dueAt:0,pending:[],active:null,history:[],lease:null,cleanupLease:null,cleanedAt:0};
for(let i=0;i<450;i++){
 const operation={type:'post.update',id:'p'+i,markdown:body,changes:{title:'T'+i}};
 const payload={requestId:'r'+i,baseCommit:commit,operations:[operation]};
 const hash=await payloadHash(payload);
 data.history.push({state:'confirmed',applied:true,payload,items:[{operation,target:'p'+i,version:i+1}],hash,receipt:{requestId:payload.requestId,payloadHash:hash,contentCommit:commit},result:{contentCommit:commit},confirmedAt:1});
}
const initialBytes=storageBytes(data);
const store={read:async()=>structuredClone(data),update:async(_scope,edit)=>{const copy=structuredClone(data);const result=edit(copy);data=copy;return result;}};
let sent=0;
const engine=createSyncEngine({store,send:async()=>{sent++;throw Error('must not send');}});
const start=performance.now();
try{await assert.rejects(engine.stage('scope',{baseCommit:commit,operation:{type:'post.update',id:'new',changes:{title:'new'}},draftKey:'draft',clientRequestId:'new'}),/한도/);}finally{engine.stop();}
const rejectedInMs=performance.now()-start;
assert.equal(data.history.length,450);assert.equal(data.pending.length,0);assert.equal(sent,0);
const cleanupStart=performance.now();const result=await cleanupConfirmed(store,'scope',DAY_MS+1);
assert.equal(result.removed,450);assert.equal(data.history.length,0);
const output={initialBytes,confirmedRecords:450,rejectedInMs,cleanupMs:performance.now()-cleanupStart,removed:result.removed,maxRssKiB:process.resourceUsage().maxRSS,heapLimitMiB:512,model:'Node core, copy-on-write transactional adapter; not browser IndexedDB or UI latency'};
await writeFile(new URL('./capacity-current.json',import.meta.url),JSON.stringify(output,null,2));console.log(JSON.stringify(output));
