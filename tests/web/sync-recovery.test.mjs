import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadComponent } from '../support/load-component.mjs';
import {payloadHash} from '../../app/web/src/features/content-management/sync-core.mjs';
import { syncStore } from '../support/memory-sync-store.mjs';

const dom = new JSDOM('', {url:'https://blog.test'});
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
const service = await loadComponent('app/web/src/features/content-management/background-sync.mjs');
const session = {state:'ready',user:{id:42},csrfToken:'csrf'};
const scope = service.syncScope(session);
const draftKey = 'second-brain:canonical-draft:p';
const commit = version => String(version).repeat(40);
const categories = version => [{id:'c',name:'C'+version,parent_id:null,order:0,sources:[]}];
async function confirmed(version) {
  const operation = {type:'post.update',id:'p',changes:{title:'Title'+version},markdown:'Body'+version};
  const payload = {requestId:'request'+version,baseCommit:commit(0),operations:[operation]};
  const hash=await payloadHash(payload);
  return {
    state:'confirmed',applied:false,hash,payload,receipt:{requestId:payload.requestId,payloadHash:hash,contentCommit:commit(version)},
    items:[{version,target:'p',operation,draftKey,clientRequestId:'client'+version}],
    result:{state:'published',requestId:payload.requestId,contentCommit:commit(version),
      categories:{categories:categories(version),revision:String(version).repeat(64),contentCommit:commit(version)},
      sources:{p:{revision:String(version).repeat(64),editorRevision:null,contentCommit:commit(version),updatedAt:'2026-11-04T00:00:00Z'}}},
  };
}

test('restart applies confirmed recovery data, and late older receipts cannot overwrite a newer baseline', {timeout:3000}, async () => {
  const previousFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {networkCalls++;throw Error('unexpected download');};
  try {
    localStorage.setItem('second-brain:public:v1:/api/public?kind=index',JSON.stringify({posts:[{id:'p',title:'Original',markdown:'old',updatedAt:'2026-01-01',categoryId:'c'}],categories:[],contentCommit:commit(0)}));
    localStorage.setItem(draftKey,JSON.stringify({requestId:'client2',title:'still editing',markdown:'local unsaved',
      sourceDocument:{document:{metadata:{id:'p',title:'Original'},markdown:'Original'},assets:[]}}));
    const newer=await confirmed(2),older=await confirmed(1);
    const corrupted=structuredClone(older);corrupted.payload.requestId='mismatched';
    await syncStore.update(scope,state=>{state.history=[newer,older,corrupted];});
    service.startContentSync(session);
    const deadline=Date.now()+2000;
    while (!(await syncStore.read(scope)).history.slice(0,2).every(batch=>batch.applied)) {
      assert.ok(Date.now()<deadline,'confirmation replay deadline');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const saved=JSON.parse(localStorage.getItem(draftKey));
    assert.equal(saved.title,'still editing');
    assert.equal(saved.markdown,'local unsaved');
    assert.equal(saved.sourceDocument.document.markdown,'Body2');
    assert.equal(saved.revision,'2'.repeat(64));
    assert.equal(saved.contentCommit,commit(2));
    assert.equal(saved.syncVersion,2);
    assert.equal(JSON.parse(localStorage.getItem(service.categorySourceKey(session))).categories[0].name,'C2');
    assert.equal(JSON.parse(localStorage.getItem('second-brain:public:v1:/api/public?kind=index')).contentCommit,commit(0));
    assert.equal(networkCalls,0);
    const history=(await syncStore.read(scope)).history;
    assert.ok(history.slice(0,2).every(batch=>!batch.result.sources),'applied receipts shed reconstruction data');
    assert.equal(history[2].applied,false,'corrupted confirmation remains recoverable and cannot block other batches');
    await service.enqueueContentSync({baseCommit:commit(2),operation:{type:'post.update',id:'p',changes:{title:'Queued title'}}},session,draftKey,'queued');
    const cached=JSON.parse(localStorage.getItem('second-brain:public:v1:/api/public?kind=index'));
    assert.equal(cached.posts[0].title,'Queued title');
    assert.ok(cached.posts[0].updatedAt!=='2026-01-01','optimistic updates refresh the displayed timestamp');
  } finally {
    service.stopContentSync();
    globalThis.fetch=previousFetch;
    localStorage.clear();
    dom.window.close();
  }
});

for (const scenario of [
  {name:'the confirmed category draft',requestId:'client1',syncVersion:0,expectedSources:['added'],expectedName:'Added',expectedVersion:1},
  {name:'later category edits',requestId:'later-edit',syncVersion:0,expectedSources:[],expectedName:'Later edit',expectedVersion:1},
  {name:'a newer category baseline',requestId:'client1',syncVersion:2,expectedSources:['newer-alias'],expectedName:'Newer',expectedVersion:2},
]) test('category receipt recovery preserves '+scenario.name, {timeout:3000}, async()=>{
  const currentDom=new JSDOM('',{url:'https://category-recovery.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;
  globalThis.window=currentDom.window;
  globalThis.localStorage=currentDom.window.localStorage;
  let networkCalls=0;
  globalThis.fetch=async()=>{networkCalls++;throw Error('category recovery must not download content');};
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    const categoryDraftKey='second-brain:canonical-categories';
    const authored={id:'added',name:'Added',parent_id:null,order:0,sources:[]};
    const operation={type:'categories.save',baseRevision:'0'.repeat(64),categories:[authored]};
    const payload={requestId:'category-request1',baseCommit:commit(0),operations:[operation]};
    const hash=await payloadHash(payload);
    const baseline={categories:[{...authored,sources:['added']}],revision:'1'.repeat(64),contentCommit:commit(1)};
    const batch={
      state:'confirmed',applied:false,hash,payload,
      receipt:{requestId:payload.requestId,payloadHash:hash,contentCommit:commit(1)},
      items:[{version:1,target:'categories',operation,draftKey:categoryDraftKey,clientRequestId:'client1'}],
      result:{state:'saved',requestId:payload.requestId,candidateCommit:commit(1),contentCommit:commit(1),publicationPending:true,categories:baseline,sources:{}},
    };
    const currentCategories=[{...authored,name:scenario.expectedName,sources:scenario.syncVersion===2?['newer-alias']:[]}];
    localStorage.setItem(categoryDraftKey,JSON.stringify({requestId:scenario.requestId,syncVersion:scenario.syncVersion,
      categories:currentCategories,revision:String(scenario.syncVersion).repeat(64),contentCommit:commit(scenario.syncVersion)}));
    if(scenario.syncVersion===2)localStorage.setItem(currentService.categorySourceKey(session),JSON.stringify({
      categories:currentCategories,revision:'2'.repeat(64),contentCommit:commit(2),syncVersion:2,
    }));
    await syncStore.update(currentScope,state=>{state.history=[batch];});
    currentService.startContentSync(session);
    const deadline=Date.now()+2000;
    while(!(await syncStore.read(currentScope)).history[0].applied) {
      assert.ok(Date.now()<deadline,'category confirmation replay deadline');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const saved=JSON.parse(localStorage.getItem(categoryDraftKey));
    assert.deepEqual(saved.categories[0].sources,scenario.expectedSources);
    assert.equal(saved.categories[0].name,scenario.expectedName);
    assert.equal(saved.requestId,scenario.requestId);
    assert.equal(saved.syncVersion,scenario.expectedVersion);
    assert.equal(saved.revision,String(scenario.expectedVersion).repeat(64));
    assert.equal(saved.contentCommit,commit(scenario.expectedVersion));
    const cached=JSON.parse(localStorage.getItem(currentService.categorySourceKey(session)));
    assert.equal(cached.syncVersion,scenario.expectedVersion);
    assert.equal(networkCalls,0);
  } finally {
    currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

test('a delayed peer failure cannot announce an archived failed batch as confirmed', {timeout:3000}, async(t)=>{
  const peerDom=new JSDOM('',{url:'https://peer.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,channel:globalThis.BroadcastChannel};
  let channel,peerService;
  globalThis.window=peerDom.window;
  globalThis.localStorage=peerDom.window.localStorage;
  globalThis.BroadcastChannel=class {
    constructor(){channel=this;}
    postMessage(){}
    close(){}
    unref(){}
  };
  try {
    peerService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const peerScope=peerService.syncScope(session);
    await syncStore.update(peerScope,state=>{
      state.history=[{state:'failed',payload:{requestId:'archived-conflict'},items:[{target:'p',version:1}]}];
    });
    const received=new Promise((resolve,reject)=>{
      t.signal.addEventListener('abort',()=>reject(new Error('Peer notification deadline exceeded')),{once:true});
      peerDom.window.addEventListener(peerService.SYNC_EVENT,event=>{
        if(event.detail.state!=='restored')resolve({state:event.detail.state,hasResult:Boolean(event.detail.result)});
      });
    });
    peerService.startContentSync(session);
    channel.onmessage({data:{scope:peerScope,state:'failed',batchId:'archived-conflict'}});
    const event=await received;
    await syncStore.update(peerScope,state=>{
      state.history=[{state:'confirmed',applied:false,payload:{requestId:'applying'},items:[{target:'p',version:2}],result:{state:'published'}}];
    });
    const applyingReceived=new Promise((resolve,reject)=>{
      t.signal.addEventListener('abort',()=>reject(new Error('Peer notification deadline exceeded')),{once:true});
      peerDom.window.addEventListener(peerService.SYNC_EVENT,notification=>{
        if(notification.detail.state!=='restored')resolve({state:notification.detail.state,hasResult:Boolean(notification.detail.result)});
      });
    });
    channel.onmessage({data:{scope:peerScope,state:'sending',batchId:'applying'}});
    const applyingEvent=await applyingReceived;
    assert.deepEqual([event.state,applyingEvent.state],['failed','sending']);
    assert.deepEqual([event.hasResult,applyingEvent.hasResult],[false,false]);
  } finally {
    peerService?.stopContentSync();
    peerDom.window.close();
    globalThis.window=previous.window;
    globalThis.localStorage=previous.storage;
    globalThis.BroadcastChannel=previous.channel;
  }
});

test('source confirmation preserves the public snapshot identity and overlays an older public index after restart', {timeout:3000}, async () => {
  const currentDom=new JSDOM('',{url:'https://source-recovery.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;
  globalThis.window=currentDom.window;
  globalThis.localStorage=currentDom.window.localStorage;
  globalThis.fetch=async()=>{throw Error('source recovery must not wait for a download');};
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    const index={posts:[{id:'p',title:'Old public title',markdown:'old body',categoryId:'c'}],categories:[],contentCommit:commit(0)};
    localStorage.setItem('second-brain:public:v1:/api/public?kind=index',JSON.stringify(index));
    localStorage.setItem(draftKey,JSON.stringify({requestId:'client1',title:'Title1',markdown:'Body1',
      sourceDocument:{document:{metadata:{id:'p',title:'Original'},markdown:'Original'},assets:[]}}));
    const batch=await confirmed(1);
    batch.result.state='saved';batch.result.candidateCommit=commit(1);
    await syncStore.update(currentScope,state=>{state.history=[batch];});
    currentService.startContentSync(session);
    const deadline=Date.now()+2000;
    while (!(await syncStore.read(currentScope)).history[0].applied) {
      assert.ok(Date.now()<deadline,'source confirmation replay deadline');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const cached=JSON.parse(localStorage.getItem('second-brain:public:v1:/api/public?kind=index'));
    assert.equal(cached.contentCommit,commit(0),'public body identities remain pinned to generated artifacts');
    const overlaid=await currentService.overlayContent(index);
    assert.equal(overlaid.posts[0].title,'Title1','confirmed source edits remain visible while the workflow is pending');
    assert.equal(overlaid.posts[0].markdown,'Body1');
    assert.equal(overlaid.contentCommit,commit(0));
    assert.equal(overlaid.sourceCommit,commit(1));
    const saved=JSON.parse(localStorage.getItem(draftKey));
    assert.equal(saved.sourceDocument.contentCommit,commit(1),'subsequent saves use the acknowledged source baseline');
    assert.equal(saved.publication.state,'saved');
    await syncStore.update(currentScope,state=>{state.history[0].publication={state:'published',publicCommit:commit(1)};});
    const ready=await currentService.overlayContent({...index,contentCommit:commit(1),posts:[{...index.posts[0],title:'Published title'}]});
    assert.equal(ready.posts[0].title,'Published title','the matching public snapshot retires its local overlay');
    assert.equal(ready.sourceCommit,commit(1));
    assert.equal((await syncStore.read(currentScope)).history[0].publicApplied,true);
  } finally {
    currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

test('background publication checks survive navigation and retire overlays only at the verified public commit', {timeout:5000}, async t => {
  const currentDom=new JSDOM('',{url:'https://publication-recovery.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;
  globalThis.window=currentDom.window;
  globalThis.localStorage=currentDom.window.localStorage;
  const queries=[];
  globalThis.fetch=async path=>{
    queries.push(path);
    return Response.json({state:'published',requestId:'request1',candidateCommit:commit(1),contentCommit:commit(1),publicCommit:commit(2)});
  };
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    const batch=await confirmed(1);
    batch.applied=true;batch.result.state='saved';batch.result.candidateCommit=commit(1);
    await syncStore.update(currentScope,state=>{state.history=[batch];});
    localStorage.setItem(draftKey,JSON.stringify({requestId:'client1',publication:{state:'saved',requestId:'request1',candidateCommit:commit(1),background:true}}));
    let eventDeadline;
    const published=new Promise((resolve,reject)=>{
      eventDeadline=setTimeout(()=>resolve(null),2200);
      t.signal.addEventListener('abort',()=>reject(new Error('publication check deadline')),{once:true});
      currentDom.window.addEventListener(currentService.SYNC_EVENT,event=>{
        if(event.detail.state==='publication')resolve(event.detail.result.publicCommit);
      });
    });
    t.after(()=>clearTimeout(eventDeadline));
    currentService.startContentSync(session);
    assert.equal(await published,commit(2));
    assert.equal(queries.length,1);
    assert.ok(queries[0].startsWith('/api/publish?'));
    assert.equal(new URL(queries[0],'https://blog.test').searchParams.get('candidateCommit'),commit(1));
    const index={posts:[{id:'p',title:'Old public title',markdown:'old body',categoryId:'c'}],categories:[],contentCommit:commit(0)};
    assert.equal((await currentService.overlayContent(index)).posts[0].title,'Title1','a stale index cannot retire a published overlay');
    assert.equal((await currentService.overlayContent({...index,contentCommit:commit(2),posts:[{...index.posts[0],title:'Latest public title'}]})).posts[0].title,'Latest public title');
    assert.equal((await syncStore.read(currentScope)).history[0].publicApplied,true);
    assert.equal(JSON.parse(localStorage.getItem(draftKey)).publication.state,'published');
  } finally {
    currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

for (const verified of [true, false]) test('a fresh index '+(verified?'retires a missed published overlay after an ancestry proof':'keeps a saved overlay without a matching publication proof'), {timeout:3000}, async () => {
  const currentDom=new JSDOM('',{url:'https://missed-publication.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;
  const queries=[];const publications=[];
  globalThis.window=currentDom.window;
  globalThis.localStorage=currentDom.window.localStorage;
  globalThis.fetch=async path=>{
    queries.push(path);
    return Response.json({state:'published',requestId:'request1',candidateCommit:commit(1),contentCommit:commit(3),publicCommit:commit(verified?3:2)});
  };
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    currentDom.window.addEventListener(currentService.SYNC_EVENT,event=>{
      if(event.detail.state==='publication')publications.push(event.detail.result.state);
    });
    const currentScope=currentService.syncScope(session);
    const batch=await confirmed(1);
    batch.applied=true;batch.result.state='saved';batch.result.candidateCommit=commit(1);
    batch.publication={state:'published',publicCommit:commit(2)};
    await syncStore.update(currentScope,state=>{state.history=[batch];});
    currentService.startContentSync(session);
    const index={posts:[],categories:[],contentCommit:commit(3)};
    const cached=await currentService.overlayContent(index);
    assert.equal(cached.posts.length,1,'cache paint keeps the source overlay without a request');
    assert.equal(queries.length,0);
    const [result,duplicate]=await Promise.all([
      currentService.overlayContent(index,{revalidate:true,signal:AbortSignal.timeout(1500)}),
      currentService.overlayContent(index,{revalidate:true,signal:AbortSignal.timeout(1500)}),
    ]);
    assert.equal(result.posts.length,verified?0:1,'only an exact verified public snapshot can retire the saved operation');
    assert.equal(duplicate.posts.length,result.posts.length);
    assert.equal(Boolean((await syncStore.read(currentScope)).history[0].publicApplied),verified);
    assert.equal(queries.length,1,'the fresh index verifies only its unresolved source batch');
    assert.deepEqual(publications,['published'],'all callers share one completion event for open editors');
    if(verified)assert.equal(result.sourceCommit,commit(3));
  } finally {
    currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

test('a source-only save clears inherited pending state when publication completes through a fresh index', {timeout:3000}, async()=>{
  const currentDom=new JSDOM('',{url:'https://source-only-complete.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;
  globalThis.window=currentDom.window;globalThis.localStorage=currentDom.window.localStorage;
  globalThis.fetch=async()=>Response.json({state:'published',sourceCommit:commit(1),contentCommit:commit(1),publicCommit:commit(3)});
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    const batch=await confirmed(1);
    batch.applied=true;batch.result={state:'saved',requestId:'request1',contentCommit:commit(1),sourceOnly:true,publicationPending:true};
    await syncStore.update(currentScope,state=>{state.history=[batch];});
    localStorage.setItem(draftKey,JSON.stringify({requestId:'client1',publication:{...batch.result,background:true}}));
    currentService.startContentSync(session);
    await currentService.overlayContent({posts:[],categories:[],contentCommit:commit(3)},{revalidate:true,signal:AbortSignal.timeout(1500)});
    const publication=JSON.parse(localStorage.getItem(draftKey)).publication;
    assert.equal(publication.state,'published');
    assert.equal(publication.publicationPending,false,'a completed public artifact is no longer awaiting publication');
    assert.equal(publication.sourceOnly,true,'source-only save identity must remain intact');
    assert.equal((await syncStore.read(currentScope)).history[0].result.publicationPending,true,'the accepted source receipt remains unchanged');
  } finally {
    currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

for(const action of ['logout','session replacement'])test('fresh index verification stops old work on '+action,{timeout:3000},async()=>{
  const currentDom=new JSDOM('',{url:'https://publication-session.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;let finish;let requestSignal;let calls=0;
  globalThis.window=currentDom.window;globalThis.localStorage=currentDom.window.localStorage;
  globalThis.fetch=async(path,options)=>{
    calls++;requestSignal=options.signal;
    const params=new URL(path,'https://blog.test').searchParams;
    const response=()=>Response.json({state:'published',requestId:params.get('requestId'),candidateCommit:params.get('candidateCommit'),publicCommit:commit(3)});
    return calls===1?new Promise(resolve=>{finish=()=>resolve(response());}):response();
  };
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    const batches=await Promise.all([confirmed(1),confirmed(2)]);
    for(const batch of batches){batch.applied=true;batch.result.state='saved';batch.result.candidateCommit=batch.result.contentCommit;}
    await syncStore.update(currentScope,state=>{state.history=batches;});
    const bytes=JSON.stringify({requestId:'client1',title:'keep recovery'});
    localStorage.setItem(draftKey,bytes);
    currentService.startContentSync(session);
    const index={posts:[],categories:[],contentCommit:commit(3)};
    const pending=currentService.overlayContent(index,{revalidate:true,signal:AbortSignal.timeout(1500)});
    const deadline=Date.now()+1000;
    while(!finish){assert.ok(Date.now()<deadline,'publication request must start');await new Promise(resolve=>setTimeout(resolve,5));}
    if(action==='logout')currentService.stopContentSync();
    else currentService.startContentSync({...session,user:{id:43},csrfToken:'next-session'});
    assert.equal(requestSignal.aborted,true,'the old session owns and cancels its network request');
    finish();
    const result=await pending;
    assert.equal(result.posts.length,0,'old account overlays must not reach the next session');
    assert.equal(calls,1,'the old backlog must not send another request');
    assert.equal((await syncStore.read(currentScope)).history[0].publication,undefined,'a late response cannot update the old publication');
    assert.equal(localStorage.getItem(draftKey),bytes);
  } finally {
    finish?.();currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

test('canceling one index reader does not cancel another reader of its shared publication request',{timeout:3000},async()=>{
  const currentDom=new JSDOM('',{url:'https://publication-readers.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;let finish;let requestSignal;let calls=0;
  globalThis.window=currentDom.window;globalThis.localStorage=currentDom.window.localStorage;
  globalThis.fetch=async(path,options)=>{
    calls++;requestSignal=options.signal;
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(new DOMException('Aborted','AbortError'));
      options.signal.addEventListener('abort',abort,{once:true});
      finish=()=>{options.signal.removeEventListener('abort',abort);resolve(Response.json({state:'published',requestId:'request1',candidateCommit:commit(1),publicCommit:commit(3)}));};
    });
  };
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    const batch=await confirmed(1);batch.applied=true;batch.result.state='saved';batch.result.candidateCommit=commit(1);
    await syncStore.update(currentScope,state=>{state.history=[batch];});
    currentService.startContentSync(session);
    const index={posts:[],categories:[],contentCommit:commit(3)};
    const reader=new AbortController();
    const first=currentService.overlayContent(index,{revalidate:true,signal:reader.signal});
    const second=currentService.overlayContent(index,{revalidate:true,signal:AbortSignal.timeout(1500)});
    const deadline=Date.now()+1000;
    while(!finish){assert.ok(Date.now()<deadline,'shared publication request must start');await new Promise(resolve=>setTimeout(resolve,5));}
    reader.abort();
    assert.equal(requestSignal.aborted,false,'reader cancellation must not abort service-owned work');
    finish();
    const [canceled,result]=await Promise.all([first,second]);
    assert.equal(canceled.posts.length,0,'an aborted index read must not apply a saved overlay');
    assert.equal(result.posts.length,0);
    assert.equal(calls,1);
    assert.equal((await syncStore.read(currentScope)).history[0].publicApplied,true);
  } finally {
    finish?.();currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

test('an old checker finishing its last read cannot replace the new session publication timer',{timeout:6000},async()=>{
  const currentDom=new JSDOM('',{url:'https://publication-timer-session.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;let releaseRead;let holdFinalRead=false;let finalReadHeld=false;let nextPublished=false;
  globalThis.window=currentDom.window;globalThis.localStorage=currentDom.window.localStorage;
  const nextSession={...session,user:{id:43},csrfToken:'next-session'};
  globalThis.fetch=async path=>{
    const params=new URL(path,'https://blog.test').searchParams;
    return Response.json(params.get('requestId')==='next-request'?
      {state:'published',requestId:'next-request',candidateCommit:commit(2),publicCommit:commit(3)}:
      {state:'saved',requestId:'request1',candidateCommit:commit(1)});
  };
  let originalRead;
  try {
    currentService=await loadComponent('tests/support/content-sync.mjs');
    const currentScope=currentService.syncScope(session);const nextScope=currentService.syncScope(nextSession);
    const batch=await confirmed(1);batch.applied=true;batch.result.state='saved';batch.result.candidateCommit=commit(1);
    const nextBatch=await confirmed(2);nextBatch.applied=true;nextBatch.payload.requestId='next-request';nextBatch.result.state='saved';nextBatch.result.candidateCommit=commit(2);
    await currentService.syncStore.update(currentScope,state=>{state.history=[batch];});
    await currentService.syncStore.update(nextScope,state=>{state.history=[nextBatch];});
    originalRead=currentService.syncStore.read;
    currentService.syncStore.read=async scope=>{
      const state=await originalRead(scope);
      if(scope===currentScope&&holdFinalRead){holdFinalRead=false;finalReadHeld=true;await new Promise(resolve=>{releaseRead=resolve;});}
      return state;
    };
    currentDom.window.addEventListener(currentService.SYNC_EVENT,event=>{
      if(event.detail.state==='publication'&&event.detail.scope===currentScope)holdFinalRead=true;
      if(event.detail.state==='publication'&&event.detail.scope===nextScope)nextPublished=true;
    });
    currentService.startContentSync(session);
    let deadline=Date.now()+2300;
    while(!finalReadHeld){assert.ok(Date.now()<deadline,'old checker must reach its last read');await new Promise(resolve=>setTimeout(resolve,5));}
    let restored=false;
    currentDom.window.addEventListener(currentService.SYNC_EVENT,event=>{if(event.detail.scope===nextScope&&event.detail.state==='restored')restored=true;});
    currentService.startContentSync(nextSession);
    deadline=Date.now()+1000;
    while(!restored){assert.ok(Date.now()<deadline,'new session must schedule its first publication check');await new Promise(resolve=>setTimeout(resolve,5));}
    releaseRead();
    deadline=Date.now()+2100;
    while(!nextPublished&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(nextPublished,true,'an old read cannot postpone the new 1.5-second publication check to 30 seconds');
  } finally {
    releaseRead?.();if(currentService&&originalRead)currentService.syncStore.read=originalRead;
    currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

test('fresh index publication checks preserve the sequential request limit for a backlog', {timeout:3000}, async()=>{
  const currentDom=new JSDOM('',{url:'https://publication-backlog.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService;let calls=0;let active=0;let peak=0;
  globalThis.window=currentDom.window;globalThis.localStorage=currentDom.window.localStorage;
  globalThis.fetch=async path=>{
    calls++;active++;peak=Math.max(peak,active);
    try {
      await new Promise(resolve=>setTimeout(resolve,10));
      const params=new URL(path,'https://blog.test').searchParams;
      return Response.json({state:'published',requestId:params.get('requestId'),candidateCommit:params.get('candidateCommit'),publicCommit:commit(3)});
    } finally {active--;}
  };
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    const batches=await Promise.all([confirmed(1),confirmed(2)]);
    for(const batch of batches){batch.applied=true;batch.result.state='saved';batch.result.candidateCommit=batch.result.contentCommit;}
    await syncStore.update(currentScope,state=>{state.history=batches;});
    currentService.startContentSync(session);
    const result=await currentService.overlayContent({posts:[],categories:[],contentCommit:commit(3)},{revalidate:true,signal:AbortSignal.timeout(1500)});
    assert.equal(result.posts.length,0);
    assert.equal(calls,2,'each unresolved source is checked once');
    assert.equal(peak,1,'an offline backlog must not burst all publication requests concurrently');
  } finally {
    currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});

for(const publicationState of ['published','unchanged'])test('retained '+publicationState+' receipts cannot replace a fresher public source baseline', {timeout:3000}, async () => {
  const currentDom=new JSDOM('',{url:'https://fresh-source.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage};
  let currentService;
  globalThis.window=currentDom.window;
  globalThis.localStorage=currentDom.window.localStorage;
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    currentService.startContentSync(session);
    const batch=await confirmed(1);
    batch.applied=true;batch.result.state=publicationState;
    await syncStore.update(currentScope,current=>{current.history=[batch];});
    const index={posts:[],categories:[],contentCommit:commit(2)};
    assert.equal((await currentService.overlayContent(index)).sourceCommit,commit(2),publicationState+' history must not regress the source baseline');
  } finally {
    currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;
  }
});

test('an unchanged source awaiting publication survives recovery and retires at the verified public snapshot', {timeout:5000}, async t => {
  const currentDom=new JSDOM('',{url:'https://unchanged-publication.test'});
  const previous={window:globalThis.window,storage:globalThis.localStorage,fetch:globalThis.fetch};
  let currentService,eventDeadline;
  globalThis.window=currentDom.window;
  globalThis.localStorage=currentDom.window.localStorage;
  const queries=[];
  globalThis.fetch=async path=>{
    queries.push(path);
    return Response.json({state:'published',sourceCommit:commit(1),contentCommit:commit(1),publicCommit:commit(2)});
  };
  try {
    currentService=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
    const currentScope=currentService.syncScope(session);
    const batch=await confirmed(1);
    batch.result.state='unchanged';batch.result.publicationPending=true;
    await syncStore.update(currentScope,state=>{state.history=[batch];});
    localStorage.setItem(draftKey,JSON.stringify({requestId:'client1',title:'Title1',markdown:'Body1',
      sourceDocument:{document:{metadata:{id:'p',title:'Original'},markdown:'Original'},assets:[]}}));
    const published=new Promise((resolve,reject)=>{
      eventDeadline=setTimeout(()=>resolve(null),2200);
      t.signal.addEventListener('abort',()=>reject(new Error('unchanged publication deadline')),{once:true});
      currentDom.window.addEventListener(currentService.SYNC_EVENT,event=>{
        if(event.detail.state==='publication')resolve(event.detail.result.publicCommit);
      });
    });
    published.catch(()=>{});
    currentService.startContentSync(session);
    const deadline=Date.now()+1000;
    while(!(await syncStore.read(currentScope)).history[0].applied) {
      assert.ok(Date.now()<deadline,'unchanged source replay deadline');
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const index={posts:[{id:'p',title:'Old public title',markdown:'old body',categoryId:'c'}],categories:[],contentCommit:commit(0)};
    const overlay=await currentService.overlayContent(index);
    assert.equal(overlay.posts[0].title,'Title1','a no-op source response still preserves unpublished device content');
    assert.equal(overlay.contentCommit,commit(0));
    assert.equal(overlay.sourceCommit,commit(1));
    assert.equal((await syncStore.read(currentScope)).history[0].result.publicationPending,true,'receipt compaction keeps pending-public identity');
    assert.equal(await published,commit(2));
    assert.equal(queries.length,1);
    const query=new URL(queries[0],'https://blog.test').searchParams;
    assert.equal(query.get('sourceCommit'),commit(1));
    assert.equal(query.has('candidateCommit'),false,'no-op source checks do not invent candidate provenance');
    const fresh=await currentService.overlayContent({...index,contentCommit:commit(2),posts:[{...index.posts[0],title:'Latest public title'}]});
    assert.equal(fresh.posts[0].title,'Latest public title');
    assert.equal(fresh.sourceCommit,commit(2));
    assert.equal((await syncStore.read(currentScope)).history[0].publicApplied,true);
  } finally {
    clearTimeout(eventDeadline);currentService?.stopContentSync();currentDom.window.close();
    globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.fetch=previous.fetch;
  }
});
