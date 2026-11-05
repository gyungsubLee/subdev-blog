import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncEngine, cleanupConfirmed, payloadHash, DAY_MS } from '../../app/web/src/features/content-management/sync-core.mjs';
const base='a'.repeat(40),next='b'.repeat(40);
function fixture() {
 let time=DAY_MS+1000,sequence=0;
 const records=new Map(),timers=new Map(),sent=[];
 let chain=Promise.resolve();
 const store={read:async scope=>structuredClone(records.get(scope)??{version:0,dueAt:0,pending:[],active:null,history:[],lease:null,cleanupLease:null,cleanedAt:0}),update(scope,fn){
  const job=chain.then(async()=>{const state=await store.read(scope);const result=fn(state);records.set(scope,state);return result;});chain=job.catch(()=>{});return job;
 }};
 const options={store,now:()=>time,setTimer:(fn,delay)=>{timers.set(++sequence,{fn,at:time+delay});return sequence;},clearTimer:id=>timers.delete(id),send:async payload=>{
  sent.push(structuredClone(payload));return {state:'published',contentCommit:next,categories:{revision:'new',contentCommit:next},sources:{},receipt:{requestId:payload.requestId,payloadHash:await payloadHash(payload),contentCommit:next}};
 }};
 return {store,records,sent,timers,options,advance:ms=>{time+=ms;},get now(){return time;}};
}
const input=name=>({baseCommit:base,operation:{type:'post.update',id:'p',baseRevision:'original',changes:{title:name}},draftKey:'draft',clientRequestId:name});

test('durable saves schedule immediate dispatch and coalesce only before transmission', {timeout:3000}, async()=>{
 const f=fixture(),engine=createSyncEngine(f.options);
 try {
  const first=await engine.stage('scope',input('A'));
  await engine.stage('scope',input('B'));
  const latest=await engine.stage('scope',input('C'));
  const stored=await f.store.read('scope');
  assert.equal(stored.pending[0].operation.changes.title,'C');
  assert.equal(f.sent.length,0,'the durable pending record exists before dispatch');
  const scheduled=[...f.timers.values()][0];
  assert.equal(scheduled.at,f.now,'saving must not add a debounce delay');
  scheduled.fn();
  assert.equal((await latest.completion).contentCommit,next);
  assert.equal((await first.completion).contentCommit,next);
  assert.equal(f.sent.length,1);
  assert.equal(f.sent[0].operations[0].changes.title,'C');
 } finally {engine.stop();}
});

test('restored pending saves ignore a legacy future debounce without bypassing retry waits', {timeout:3000}, async()=>{
 const f=fixture(),before=createSyncEngine(f.options);
 await before.stage('scope',input('restored'));
 before.stop();
 await f.store.update('scope',state=>{state.dueAt=f.now+5000;});
 const restored=createSyncEngine(f.options);
 try {
  await restored.resume('scope');
  assert.equal([...f.timers.values()][0].at,f.now,'legacy save dueAt must not delay restart');
  await restored.flush('scope');
  assert.equal(f.sent.length,1);
 } finally {restored.stop();}
});

test('another coordinator cannot duplicate an in-flight batch, and later edits survive old response',async()=>{
 const f=fixture();let release;
 const response=f.options.send;
 f.options.send=async payload=>{await new Promise(resolve=>{release=resolve;});return response(payload);};
 const one=createSyncEngine({...f.options,owner:'one'}),two=createSyncEngine({...f.options,owner:'two'});
 await one.stage('scope',input('A'));
 const running=one.flush('scope');
 for(let n=0;n<20&&!release;n++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(typeof release==='function');
 await one.stage('scope',input('C'));await two.flush('scope');assert.equal(f.sent.length,0);
 release();await running;
 const stored=await f.store.read('scope');assert.equal(stored.pending[0].operation.changes.title,'C');assert.equal(stored.pending[0].baseCommit,next);
 assert.equal(f.sent.length,1);
 const ready=[...f.timers.values()].filter(timer=>timer.at===f.now);
 assert.ok(ready.length>0,'the next saved edit must be scheduled at the same clock');
 // Complete the queued follow-up without advancing the wall clock.
 release=undefined;
 const following=one.flush('scope');
 for(let n=0;n<20&&!release;n++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(typeof release==='function');
 release();await following;
 assert.equal(f.sent.length,2);
 assert.equal(f.sent[1].operations[0].changes.title,'C');
 assert.equal(f.sent[1].baseCommit,next);
 one.stop();two.stop();
});
test('a lost response retains the same payload and resumes after reload without duplicate identity',async()=>{
 const f=fixture();let fail=true;
 const response=f.options.send;const attempts=[],reconcile=[];
 f.options.send=async (payload,options)=>{attempts.push(JSON.stringify(payload));reconcile.push(options?.reconcile);if(fail)throw Error('lost');return response(payload);};
 const first=createSyncEngine({...f.options,owner:'first'});
 await first.stage('scope',input('A'));f.advance(5000);await first.flush('scope');first.stop();
 const stored=await f.store.read('scope');assert.ok(stored.active);assert.equal(stored.history.length,0);
 fail=false;f.advance(5000);const reloaded=createSyncEngine({...f.options,owner:'reloaded'});await reloaded.flush('scope');
 assert.deepEqual(reconcile,[false,true]);assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);assert.equal((await f.store.read('scope')).history.length,1);reloaded.stop();
});
test('daily cleanup verifies receipts and never deletes failed, pending or mismatched data',async()=>{
 const f=fixture(),engine=createSyncEngine(f.options);await engine.stage('scope',input('A'));f.advance(5000);await engine.flush('scope');
 await f.store.update('scope',state=>{state.history[0].applied=true;state.history.push({...structuredClone(state.history[0]),state:'failed'});state.history.push({...structuredClone(state.history[0]),receipt:{payloadHash:'wrong'}});});
 const result=await cleanupConfirmed(f.store,'scope',f.now);assert.equal(result.removed,1);assert.equal((await f.store.read('scope')).history.length,2);
 assert.equal((await cleanupConfirmed(f.store,'scope',f.now+1000)).skipped,true);engine.stop();
});

test('daily cleanup preserves a record whose receipt commit differs from its saved result',async()=>{
 const f=fixture(),engine=createSyncEngine(f.options);
 try {
  await engine.stage('scope',input('A'));f.advance(5000);await engine.flush('scope');
  await f.store.update('scope',state=>{
   state.history[0].applied=true;
   state.history[0].receipt.contentCommit='c'.repeat(40);
  });
  const result=await cleanupConfirmed(f.store,'scope',f.now);
  assert.equal(result.removed,0,'a mismatched remote commit is not confirmed cleanup evidence');
  assert.equal((await f.store.read('scope')).history.length,1);
 } finally {engine.stop();}
});

test('discarding one conflict retains other documents as blocked recoverable saves',async()=>{
 const f=fixture();f.options.send=async()=>{throw Object.assign(Error('conflict'),{status:409});};
 const engine=createSyncEngine(f.options);
 await engine.stage('scope',input('A'));
 await engine.stage('scope',{...input('B'),operation:{...input('B').operation,id:'other'}});
 f.advance(5000);await engine.flush('scope');
 await engine.abandonConflict('scope','p');
 const state=await f.store.read('scope');
 assert.equal(state.pending.length,1);assert.equal(state.pending[0].target,'other');assert.equal(state.pending[0].blocked,true);
 assert.equal(state.history[0].items.length,2);
 await engine.flush('scope');assert.equal((await f.store.read('scope')).active,null);
 engine.stop();
});


test('cleanup preserves remotely confirmed payloads until their local recovery state is applied',async()=>{
 const f=fixture(),engine=createSyncEngine(f.options);await engine.stage('scope',input('A'));f.advance(5000);await engine.flush('scope');
 assert.equal((await cleanupConfirmed(f.store,'scope',f.now)).removed,0);
 const record=(await f.store.read('scope')).history[0];assert.equal(record.applied,false);assert.ok(record.result.receipt);
 await f.store.update('scope',state=>{state.history[0].applied=true;});
 assert.equal((await cleanupConfirmed(f.store,'scope',f.now+DAY_MS)).removed,1);engine.stop();
});

test('repeated saves coalesce without growing callback or pending queues; capacity rejects only the new request',async()=>{
 const f=fixture(),engine=createSyncEngine(f.options);
 const first=await engine.stage('scope',input('0'));
 let last;
 for(let index=1;index<300;index++)last=await engine.stage('scope',input(String(index)));
 const state=await f.store.read('scope');assert.equal(state.pending.length,1);assert.ok(first.completion===last.completion);
 for(let index=0;index<99;index++)await engine.stage('scope',{...input('x'),operation:{...input('x').operation,id:'p'+index}});
 await assert.rejects(engine.stage('scope',{...input('extra'),operation:{...input('extra').operation,id:'overflow'}}),/한도/);
 assert.equal((await f.store.read('scope')).pending.length,100);engine.stop();
});
test('transient retry schedule is5,15,60 seconds and then stops; manual retry reuses the frozen batch',async()=>{
 const f=fixture();const payloads=[];let fail=true;
 const response=f.options.send;
 f.options.send=async payload=>{payloads.push(JSON.stringify(payload));if(fail)throw Error('offline');return response(payload);};
 const engine=createSyncEngine(f.options);await engine.stage('scope',input('A'));
 f.advance(5000);await engine.flush('scope');
 for(const delay of [5000,15000,60000]){f.advance(delay-1);await engine.flush('scope');const before=payloads.length;f.advance(1);await engine.flush('scope');assert.equal(payloads.length,before+1);}
 assert.equal(payloads.length,4);assert.equal((await f.store.read('scope')).active.blocked,true);
 f.advance(DAY_MS);await engine.flush('scope');assert.equal(payloads.length,4);
 fail=false;await engine.stage('scope',input('A'));await engine.flush('scope');
 assert.equal(payloads.length,5);assert.ok(payloads.every(value=>value===payloads[0]));assert.equal((await f.store.read('scope')).pending.length,0);engine.stop();
});

test('a superseded lost-response retry cannot attach the latest revision to an older operation',async()=>{
 const f=fixture();let sends=0;
 f.options.send=async()=>{sends++;return {state:'superseded',contentCommit:next};};
 const engine=createSyncEngine(f.options);
 await engine.stage('scope',input('old body'));f.advance(5000);await engine.flush('scope');
 const state=await f.store.read('scope');
 assert.equal(state.active.blocked,true);assert.equal(state.active.errorStatus,409);
 assert.equal(state.active.items[0].operation.baseRevision,'original');assert.equal(state.history.length,0);
 f.advance(60000);await engine.flush('scope');assert.equal(sends,1);engine.stop();
});

test('oversized saves and a full retained history stop new work without deleting older requests',async()=>{
 const f=fixture(),engine=createSyncEngine(f.options);
 await engine.stage('scope',input('kept'));
 await assert.rejects(engine.stage('scope',{...input('large'),operation:{...input('large').operation,markdown:'x'.repeat(4*1024*1024)}}),/4MiB/);
 assert.equal((await f.store.read('scope')).pending[0].operation.changes.title,'kept');
 await f.store.update('scope',state=>{state.history=Array.from({length:500},()=>({state:'failed'}));});
 await assert.rejects(engine.stage('scope',input('overflow')),/한도/);
 f.advance(5000);await engine.flush('scope');assert.equal(f.sent.length,0);
 assert.equal((await f.store.read('scope')).pending.length,1);
 engine.stop();
});

test('a verified source save confirms the queue before public generation and retains its overlay', {timeout:3000}, async () => {
 const f=fixture();
 const response=f.options.send;
 f.options.send=async payload=>({...await response(payload),state:'saved',candidateCommit:next});
 const engine=createSyncEngine(f.options);
 try {
  const queued=await engine.stage('scope',input('saved title'));
  f.advance(5000);await engine.flush('scope');
  const state=await f.store.read('scope');
  assert.ok(state.active===null,'a valid source receipt ends source transmission');
  assert.equal(state.history[0].result.state,'saved','source completion must not claim public completion');
  assert.equal((await queued.completion).state,'saved');
  await f.store.update('scope',current=>{current.history[0].applied=true;});
  assert.equal((await cleanupConfirmed(f.store,'scope',f.now+DAY_MS)).removed,0,'unpublished local overlays remain recoverable');
  await f.store.update('scope',current=>{current.history[0].publicApplied=true;});
  assert.equal((await cleanupConfirmed(f.store,'scope',f.now+DAY_MS*2)).removed,1);
 } finally {engine.stop();}
});

test('a source save with a mismatched receipt stays recoverable rather than confirming', {timeout:3000}, async () => {
 const f=fixture();
 f.options.send=async payload=>({state:'saved',candidateCommit:next,contentCommit:next,receipt:{requestId:payload.requestId,payloadHash:'wrong',contentCommit:next}});
 const engine=createSyncEngine(f.options);
 try {
  await engine.stage('scope',input('kept'));f.advance(5000);await engine.flush('scope');
  const state=await f.store.read('scope');
  assert.equal(state.history.length,0);
  assert.equal(state.active.items[0].operation.changes.title,'kept');
  assert.equal(state.active.errorStatus,502);
 } finally {engine.stop();}
});

test('authorization and conflict failures never automatically resend a source batch', {timeout:3000}, async () => {
 for(const status of [401,403,409]) {
  const f=fixture();let sends=0;
  f.options.send=async()=>{sends++;throw Object.assign(Error('blocked'),{status});};
  const engine=createSyncEngine(f.options);
  try {
   await engine.stage('scope',input('kept'));f.advance(5000);await engine.flush('scope');
   f.advance(DAY_MS);await engine.flush('scope');
   const state=await f.store.read('scope');
   assert.equal(sends,1);
   assert.equal(state.active.errorStatus,status);
   assert.equal(state.active.items[0].operation.changes.title,'kept');
  } finally {engine.stop();}
 }
});

test('cleanup retains unchanged source receipts only while their flagged publication is pending', {timeout:3000}, async () => {
 const f=fixture();const response=f.options.send;
 f.options.send=async payload=>({...await response(payload),state:'unchanged',publicationPending:true});
 const engine=createSyncEngine(f.options);
 try {
  await engine.stage('scope',input('same source'));f.advance(5000);await engine.flush('scope');
  await f.store.update('scope',state=>{state.history[0].applied=true;});
  assert.equal((await cleanupConfirmed(f.store,'scope',f.now)).removed,0,'no-op source completion is not public completion');
  await f.store.update('scope',state=>{state.history[0].publicApplied=true;});
  assert.equal((await cleanupConfirmed(f.store,'scope',f.now+DAY_MS)).removed,1);
 } finally {engine.stop();}
});
