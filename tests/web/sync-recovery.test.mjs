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
