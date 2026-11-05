import { syncStore } from './sync-store.mjs';
import { createSyncEngine, DAY_MS, syncTarget, payloadHash, isSourcePending } from './sync-core.mjs';
import { requestApi, sendApi } from './api';
import { readPublicCache, writePublicCache } from '../../site/public-cache';

export const SYNC_EVENT = 'second-brain:sync';
export const syncScope = session => `${session.user?.id ?? 'owner'}:${session.connection?.repository ?? 'content'}:${session.connection?.branch ?? 'main'}`;
export const categorySourceKey = session => 'second-brain:category-source:' + syncScope(session);
let context;
let worker;
let cleanupTimer;
let workerDeadline;
let started = false;
let channel;
let cacheWork = Promise.resolve();
let publicationTimer;
let checkingPublications;
let publicationController;
const serializeCache = work => { const next=cacheWork.then(work);cacheWork=next.catch(()=>{});return next; };

function emit(detail) {
  if (typeof window !== 'undefined') window.dispatchEvent(new window.CustomEvent(SYNC_EVENT,{detail}));
}
function postFromOperation(operation, previous, categories, posts) {
  const document = operation.document;
  const metadata = document?.metadata ?? {};
  const changes = operation.changes ?? {};
  const id = syncTarget(operation);
  const categoryId = changes.category_id ?? metadata.category_id ?? previous?.categoryId ?? posts.get(metadata.parent_id)?.categoryId ?? 'group:unclassified';
  const category = categories.find(item=>item.id===categoryId);
  const legacy = metadata.legacy_category ?? previous?.category;
  const compatible = legacy && category?.sources?.includes(legacy) ? legacy : categoryId==='group:unclassified' ? '미분류' : categoryId;
  return {
    parentId: metadata.parent_id ?? previous?.parentId ?? null, createdAt: metadata.created ?? '',
    updatedAt: new Date().toISOString(), path: '', url: '', excerpt: '',
    ...previous, updatedAt:new Date().toISOString(), id, title: changes.title ?? metadata.title ?? previous?.title ?? '',
    markdown: operation.markdown ?? document?.markdown ?? previous?.markdown ?? '',
    categoryId, category:compatible,
    bodyLoaded: true,
  };
}
function applyOperations(index, operations) {
  if (!index || !Array.isArray(index.posts)) return index;
  const posts = new Map(index.posts.map(post=>[post.id,post]));
  let categories = index.categories;
  const changedCategories=operations.find(operation=>operation.type==='categories.save');
  if(changedCategories)categories=changedCategories.categories.map(({parent_id,...item})=>({...item,parentId:parent_id}));
  for (const operation of operations) {
    if (operation.type === 'categories.save') {
      categories = operation.categories.map(({parent_id,...item})=>({...item,parentId:parent_id}));
    } else {
      const id = syncTarget(operation);
      posts.set(id,postFromOperation(operation,posts.get(id),categories,posts));
    }
  }
  return {...index,posts:[...posts.values()],categories};
}
export async function overlayContent(index) {
  if (!context) return index;
  const scope=syncScope(context);
  const state=await syncStore.read(scope);
  const reflected=state.history.filter(batch=>batch.state==='confirmed'&&isSourcePending(batch.result)&&
    !batch.publicApplied&&batch.publication?.state==='published'&&batch.publication.publicCommit===index.contentCommit);
  if(reflected.length)await syncStore.update(scope,current=>{
    for(const batch of current.history) {
      if(reflected.some(value=>value.payload.requestId===batch.payload.requestId)&&
        batch.publication?.state==='published'&&batch.publication.publicCommit===index.contentCommit)batch.publicApplied=true;
    }
  });
  const saved=state.history.filter(batch=>batch.state==='confirmed'&&isSourcePending(batch.result)&&
    !batch.publicApplied&&!reflected.includes(batch));
  const latest=new Map();
  for(const item of [...saved.flatMap(batch=>batch.items),...(state.active?.items??[]),...state.pending]) {
    if(!latest.has(item.target)||latest.get(item.target).version<item.version)latest.set(item.target,item);
  }
  let confirmed;
  let confirmedVersion=-1;
  for(const batch of saved) {
    const version=Math.max(...batch.items.map(item=>item.version));
    if(version>confirmedVersion){confirmed=batch;confirmedVersion=version;}
  }
  const sourceCommit=confirmed?.result.contentCommit??index.contentCommit;
  return {...applyOperations(index,[...latest.values()].map(item=>item.operation)),
    sourceCommit};
}

async function recordReceipt(event) {
  const {batch,result,scope} = event;
  const batchVersion = Math.max(...batch.items.map(item=>item.version));
  if (result.categories) {
    const key='second-brain:category-source:'+scope;
    const previous=JSON.parse(localStorage.getItem(key)??'null');
    if ((previous?.syncVersion??0)<=batchVersion) {
      localStorage.setItem(key,JSON.stringify({...result.categories,syncVersion:batchVersion}));
    }
  }
  for (const item of batch.items) {
    const raw = localStorage.getItem(item.draftKey);
    if (!raw) continue;
    let draft = JSON.parse(raw);
    if ((draft.syncVersion??0)>item.version) continue;
    const receipt = result.sources?.[item.target];
    let source;
    if(receipt) {
      const operation=item.operation;
      let original=draft.sourceDocument;
      if(!original && operation.type!=='post.create') {
        original=await requestApi('/api/content?kind=post&id='+encodeURIComponent(item.target),{signal:AbortSignal.timeout(30000)});
        if(original.contentCommit!==receipt.contentCommit)throw new Error('복구 원본의 버전이 다릅니다. 보관한 편집을 내보내고 최신 원본을 확인하십시오.');
      }
      const document=operation.document ?? {...original.document,metadata:{...original.document.metadata,...operation.changes},markdown:operation.markdown ?? original.document.markdown};
      document.metadata={...document.metadata,updated:receipt.updatedAt};
      const assets=new Map((original?.assets??[]).map(asset=>[asset.name,asset]));
      for(const asset of operation.assets??[])assets.set(asset.name,asset);
      source={...original,...receipt,document,editor:operation.editor??original?.editor??null,
        categories:result.categories.categories,assets:[...assets.values()]};
    }
    const baseline = source ?? result.categories;
    if (!baseline) continue;
    // Re-read after any source fetch: another tab may have applied a newer receipt.
    draft=JSON.parse(localStorage.getItem(item.draftKey)??'null');
    if (!draft || (draft.syncVersion??0)>item.version) continue;
    const same=draft.requestId===item.clientRequestId;
    localStorage.setItem(item.draftKey,JSON.stringify({
      ...draft, syncVersion:item.version, revision:baseline.revision,contentCommit:baseline.contentCommit,
      ...(source ? {sourceDocument:source,canonicalId:source.document.metadata.id} : {}),
      publication:same?{state:result.state,requestId:result.requestId,candidateCommit:result.candidateCommit,contentCommit:result.contentCommit,commitUrl:result.commitUrl,sourceOnly:result.sourceOnly,publicationPending:result.publicationPending,background:true}:undefined,
    }));
  }
  const index = await readPublicCache('/api/public?kind=index');
  if (index && Array.isArray(index.posts) && (index.syncVersion??0)<=batchVersion) {
    await writePublicCache('/api/public?kind=index',{...index,syncVersion:batchVersion});
  }
}
async function applyConfirmation(event) {
  const apply=()=>serializeCache(async()=>{
    const state=await syncStore.read(event.scope);
    const batch=state.history.find(item=>item.payload.requestId===event.batch.payload.requestId);
    if(!batch || batch.applied)return;
    if (batch.receipt?.requestId!==batch.payload.requestId || batch.receipt?.payloadHash!==batch.hash ||
        batch.receipt?.contentCommit!==batch.result?.contentCommit || await payloadHash(batch.payload)!==batch.hash) {
      throw new Error('보관한 원격 확인 기록이 일치하지 않습니다. 전송 데이터를 유지합니다.');
    }
    await recordReceipt({...event,batch,result:batch.result});
    await syncStore.update(event.scope,current=>{
      const stored=current.history.find(item=>item.payload.requestId===batch.payload.requestId&&item.hash===batch.hash);
      if(!stored)return;
      stored.applied=true;
      const result=stored.result;
      stored.result={state:result.state,requestId:result.requestId,contentCommit:result.contentCommit,candidateCommit:result.candidateCommit,commitUrl:result.commitUrl,receipt:result.receipt,sourceOnly:result.sourceOnly,publicationPending:result.publicationPending};
    });
  });
  // Native Web Locks serialize receipt/cache application across open tabs.
  if (typeof navigator!=='undefined' && navigator.locks) {
    return navigator.locks.request('second-brain:confirm:'+event.scope,apply);
  }
  return apply();
}
async function recoverConfirmations(scope) {
  const state=await syncStore.read(scope);
  for(const batch of state.history) {
    if(batch.state==='confirmed'&&!batch.applied) {
      try { await applyConfirmation({scope,batch,result:batch.result}); }
      catch(error) { emit({scope,error}); }
    }
  }
}
function schedulePublications(scope,delay=1500,explicit=false) {
  clearTimeout(publicationTimer);
  if(!started)return;
  publicationTimer=setTimeout(()=>{publicationTimer=undefined;void checkPublications(scope,explicit).catch(error=>emit({scope,error}));},delay);
  publicationTimer?.unref?.();
}
async function checkPublications(scope,explicit) {
  if(checkingPublications)return;
  checkingPublications=true;
  const controller=new AbortController();
  publicationController=controller;
  try {
    const state=await syncStore.read(scope);
    const waiting=state.history.filter(batch=>batch.state==='confirmed'&&batch.applied&&isSourcePending(batch.result)&&!batch.publicApplied&&
      (explicit||(!batch.publicationBlocked&&batch.publication?.state!=='failed')));
    for(const batch of waiting) {
      if(!started||controller.signal.aborted||!context||syncScope(context)!==scope)break;
      try {
        const sourceOnly=batch.result.sourceOnly===true||batch.result.state==='unchanged';
        const params=new URLSearchParams(sourceOnly?{sourceCommit:batch.result.contentCommit}:
          {requestId:batch.payload.requestId,candidateCommit:batch.result.candidateCommit??batch.result.contentCommit});
        const result=await requestApi('/api/publish?'+params,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
        const matchesSource=sourceOnly?result.sourceCommit===batch.result.contentCommit:
          result.requestId===batch.payload.requestId&&result.candidateCommit===(batch.result.candidateCommit??batch.result.contentCommit);
        if(!matchesSource||
          !['saved','published','failed','superseded'].includes(result.state)||
          (result.state==='published'&&!/^[a-f0-9]{40}$/.test(result.publicCommit??'')))throw new Error('공개 반영을 확인하지 못했습니다.');
        await syncStore.update(scope,current=>{
          const saved=current.history.find(item=>item.payload.requestId===batch.payload.requestId&&item.hash===batch.hash);
          if(saved){saved.publication=result;saved.publicationBlocked=false;}
        });
        for(const item of batch.items) {
          const draft=JSON.parse(localStorage.getItem(item.draftKey)??'null');
          if(draft?.requestId===item.clientRequestId)localStorage.setItem(item.draftKey,JSON.stringify({...draft,publication:{...batch.result,...result,background:true}}));
        }
        emit({scope,state:'publication',batch,result:{...batch.result,...result,background:true}});
      } catch(error) {
        if(controller.signal.aborted)break;
        const blocked=[401,403,409].includes(Number(error.status));
        await syncStore.update(scope,current=>{
          const saved=current.history.find(item=>item.payload.requestId===batch.payload.requestId&&item.hash===batch.hash);
          if(saved){saved.publicationBlocked=blocked;saved.publicationError=error.message;}
        });
        emit({scope,state:'publication',batch,result:{...batch.result,background:true,error:error.message}});
      }
    }
    const current=await syncStore.read(scope);
    if(current.history.some(batch=>batch.state==='confirmed'&&isSourcePending(batch.result)&&!batch.publicApplied&&!batch.publicationBlocked&&batch.publication?.state!=='failed'))schedulePublications(scope,30000);
  } finally {
    checkingPublications=false;
    if(publicationController===controller)publicationController=undefined;
  }
}
const engine = createSyncEngine({
  store:syncStore,
  prepare:async (payload,items)=>{
    const needing = items.filter(item=>item.pendingCategories?.length);
    if(!needing.length)return payload;
    let categoryOperation = payload.operations.find(operation=>operation.type==='categories.save');
    if(!categoryOperation) {
      const source=await requestApi('/api/content?kind=categories',{signal:AbortSignal.timeout(30000)});
      if(source.contentCommit!==payload.baseCommit)throw Object.assign(new Error('원본이 바뀌었습니다. 편집 내용은 보관합니다.'),{status:409});
      categoryOperation={type:'categories.save',baseRevision:source.revision,categories:source.categories};
    }
    const categories=[...categoryOperation.categories];
    for(const item of needing) {
      const selected=item.operation.document?.metadata.category_id ?? item.operation.changes?.category_id;
      let current=item.pendingCategories.find(category=>category.id===selected);
      const path=[],seen=new Set();
      while(current&&!categories.some(category=>category.id===current.id)) {
        if(seen.has(current.id))throw Object.assign(new Error('분류 경로를 확인하십시오.'),{status:422});
        seen.add(current.id);path.unshift(current);
        const parent=current.parent_id;
        current=parent===null?undefined:item.pendingCategories.find(category=>category.id===parent);
        if(parent&&!current&&!categories.some(category=>category.id===parent))throw Object.assign(new Error('상위 분류를 찾지 못했습니다.'),{status:422});
      }
      for(const category of path)if(!categories.some(item=>item.id===category.id))categories.push(category);
    }
    return {...payload,operations:[{...categoryOperation,categories},...payload.operations.filter(operation=>operation.type!=='categories.save')]};
  },
  send:(payload,{reconcile=false}={})=>{
    if (!context) throw Object.assign(new Error('로그인이 필요합니다.'),{status:401});
    return sendApi('/api/content',payload,context.csrfToken,undefined,reconcile?{'X-Content-Reconcile':'1'}:{});
  },
  notify:event=>{
    void (async()=>{
      if (event.state === 'confirmed') {
        await applyConfirmation(event);
        if(isSourcePending(event.result))schedulePublications(event.scope);
      }
      if(event.state==='confirmed') {
        const sources={};
        for(const item of event.batch.items) {
          if(!event.result.sources?.[item.target])continue;
          const saved=JSON.parse(localStorage.getItem(item.draftKey)??'null');
          if(saved?.sourceDocument)sources[item.target]=saved.sourceDocument;
        }
        event={...event,result:{...event.result,sources}};
      }
      emit(event);
      channel?.postMessage({scope:event.scope,state:event.state,batchId:event.batch?.payload.requestId});
    })().catch(error=>emit({...event,error}));
  },
});

function scheduleCleanup(delay = DAY_MS) {
  clearTimeout(cleanupTimer);
  cleanupTimer = setTimeout(()=>{cleanupTimer=undefined;runCleanup();},delay);
  cleanupTimer?.unref?.();
}
function runCleanup() {
  if (!started || !context || typeof Worker === 'undefined') return;
  if (!worker) {
    worker = new Worker(new URL('./sync-cleanup.worker.mjs',import.meta.url),{type:'module'});
    worker.onmessage = event=>{
      clearTimeout(workerDeadline);workerDeadline=undefined;
      scheduleCleanup(event.data.error ? 60001 : event.data.retryAfterMs ?? DAY_MS);
      if(event.data.removed>0)online();
    };
    worker.onerror = ()=>{
      clearTimeout(workerDeadline);worker?.terminate();worker=undefined;scheduleCleanup(60001);
    };
  }
  clearTimeout(workerDeadline);
  workerDeadline = setTimeout(()=>{worker?.terminate();worker=undefined;scheduleCleanup(60001);},60000);
  workerDeadline?.unref?.();
  worker.postMessage({scope:syncScope(context)});
}
function online() {if(context)void engine.resume(syncScope(context)).catch(error=>emit({error}));}
export function startContentSync(session) {
  const changedLogin = context && context.csrfToken !== session.csrfToken;
  context = session;
  if (!started) {
    started = true;
    window.addEventListener('online',online);
    window.addEventListener('pagehide',stopContentSync);
    if(typeof BroadcastChannel !== 'undefined') {
      channel=new BroadcastChannel('second-brain:sync');
      channel.onmessage=event=>{if(context&&event.data.scope===syncScope(context))void engine.reconcile(event.data.scope).then(state=>{
        const batch=state.history.find(item=>item.payload.requestId===event.data.batchId);
        if(batch?.state==='confirmed' && batch.applied===true)emit({scope:event.data.scope,state:'confirmed',batch,result:batch.result,peer:true});
        else emit({scope:event.data.scope,state:event.data.state});
      }).catch(error=>emit({error}));};
      channel.unref?.();
    }
  }
  void recoverConfirmations(syncScope(session)).then(()=>engine.resume(syncScope(session),Boolean(changedLogin)))
    .then(()=>{emit({scope:syncScope(session),state:'restored'});schedulePublications(syncScope(session),1500,Boolean(changedLogin));if(!worker&&!cleanupTimer)runCleanup();}).catch(error=>emit({error}));
}
export function stopContentSync() {
  started = false;
  engine.stop();
  clearTimeout(publicationTimer);publicationTimer=undefined;
  publicationController?.abort();
  clearTimeout(cleanupTimer);clearTimeout(workerDeadline);
  cleanupTimer=undefined;workerDeadline=undefined;
  worker?.terminate();worker=undefined;
  channel?.close();channel=undefined;
  if(typeof window!=='undefined'){
    window.removeEventListener('online',online);window.removeEventListener('pagehide',stopContentSync);
  }
}
export async function enqueueContentSync(input,session,draftKey,clientRequestId) {
  startContentSync(session);
  const queued = await engine.stage(syncScope(session),{...input,draftKey,clientRequestId});
  await serializeCache(async()=>{
    const index=await readPublicCache('/api/public?kind=index');
    if(index)await writePublicCache('/api/public?kind=index',await overlayContent(index));
  });
  emit({scope:syncScope(session),state:'queued'});
  return queued;
}
export function retryContentSync(session) {
  startContentSync(session);
  void checkPublications(syncScope(session),true).catch(error=>emit({error}));
  return engine.resume(syncScope(session),true);
}

export async function discardContentConflict(session,target) {
  await engine.abandonConflict(syncScope(session),target);
}
