export const DEBOUNCE_MS = 5000;
export const DAY_MS = 86400000;
const LEASE_MS = 330000;
const RETRIES = [5000, 15000, 60000];
const MAX_STORAGE_BYTES = 50 * 1024 * 1024;
const MAX_BATCH_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();
export const syncTarget = operation => operation.type === 'categories.save' ? 'categories' : operation.id ?? operation.document?.metadata?.id;
export const isSourcePending = result => result?.state === 'saved' || (result?.state === 'unchanged' && result.publicationPending === true);
export const storageBytes = value => encoder.encode(JSON.stringify(value)).length;
export async function payloadHash(payload) {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(payload)));
  return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
}
function checkCapacity(state) {
  if (state.pending.length > 100 || state.history.length > 500 || storageBytes(state) > MAX_STORAGE_BYTES) {
    throw new Error('동기화 보관 한도에 도달했습니다. 기존 편집은 유지합니다. 전송 결과를 확인하거나 백업을 내보내십시오.');
  }
}
function rebasePending(state, batch, result) {
  for (const pending of state.pending) {
    if (pending.baseCommit !== batch.payload.baseCommit) continue;
    // Only our confirmed predecessor permits a rebase; superseded writes need review.
    if (result.state === 'superseded') continue;
    pending.baseCommit = result.contentCommit;
    if (pending.operation.type === 'categories.save' && batch.items.some(item => item.operation.type === 'categories.save')) {
      pending.operation.baseRevision = result.categories.revision;
    }
    const id = syncTarget(pending.operation);
    const source = result.sources?.[id];
    if (!source) continue;
    if (pending.operation.type === 'post.create') {
      const { document, ...rest } = pending.operation;
      pending.operation = { ...rest, type:'post.update', id,
        changes:{title:document.metadata.title,tags:document.metadata.tags ?? [],category_id:document.metadata.category_id}, markdown:document.markdown };
    }
    pending.operation.baseRevision = source.revision;
    pending.operation.baseEditorRevision = source.editorRevision;
  }
}

export function createSyncEngine({store, send, prepare = async payload => payload, notify = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, owner = crypto.randomUUID()}) {
  let timer;
  let running;
  let stopped = false;
  const waiters = new Map();
  function schedule(scope, delay) {
    clearTimer(timer);
    if (stopped) return;
    timer = setTimer(() => { timer = undefined; void flush(scope).catch(error => notify({scope,error})); }, Math.max(0, delay));
    timer?.unref?.();
  }
  async function stage(scope, input) {
    const item = structuredClone(input);
    const target = syncTarget(item.operation);
    if (!target || !['categories.save','post.create','post.update'].includes(item.operation.type)) throw new Error('지원하지 않는 동기화 요청입니다.');
    if(storageBytes({requestId:crypto.randomUUID(),baseCommit:item.baseCommit,operations:[item.operation]})>MAX_BATCH_BYTES)throw new Error('저장 요청이4MiB를 넘습니다. 편집 내용을 나누거나 백업을 내보내십시오.');
    const staged = await store.update(scope, state => {
      const active = state.active?.items.find(previous => previous.target===target && previous.clientRequestId===item.clientRequestId &&
        previous.baseCommit===item.baseCommit && JSON.stringify(previous.operation)===JSON.stringify(item.operation));
      if(active) {
        const resuming=Boolean(state.active.blocked);
        if(resuming){state.active.blocked=false;state.active.retryAt=0;state.active.attempts=0;}
        return {version:active.version,activeBatch:state.active.payload.requestId,resuming};
      }
      item.version = ++state.version;
      item.target = target;
      state.pending = [...state.pending.filter(previous => previous.target !== target), item];
      state.dueAt = now() + DEBOUNCE_MS;
      checkCapacity(state);
      if (state.history.length >= 500 || storageBytes(state) > MAX_STORAGE_BYTES - MAX_BATCH_BYTES * 3 - 65536) throw new Error('전송 보관 한도에 도달했습니다. 동기화 결과를 확인하거나 백업을 내보내십시오.');
      return {version:item.version,activeBatch:null,resuming:false};
    });
    const {version} = staged;
    let waiter = [...waiters.values()].find(value => value.scope === scope && value.target === target && (staged.activeBatch ? value.activeBatch===staged.activeBatch : !value.activeBatch));
    if (!waiter) {
      waiter = {scope,target,version,activeBatch:staged.activeBatch};
      waiter.promise = new Promise((resolve,reject) => {waiter.resolve=resolve;waiter.reject=reject;});
      waiter.promise.catch(() => {});
      waiters.set(crypto.randomUUID(),waiter);
    }
    waiter.version = version;
    const completion = waiter.promise;
    notify({scope,state:'queued',item});
    if (!staged.activeBatch || staged.resuming) schedule(scope,staged.resuming ? 0 : DEBOUNCE_MS);
    return {version, completion};
  }
  async function flush(scope, explicit = false) {
    if (running) return running;
    running = run(scope,explicit).finally(() => {running = undefined;});
    return running;
  }
  async function run(scope, explicit) {
    const batch = await store.update(scope,state => {
      if (state.lease && state.lease.owner !== owner && state.lease.expires > now()) {
        schedule(scope,state.lease.expires-now());
        return null;
      }
      if (state.active?.blocked && !explicit) return null;
      if (state.active?.retryAt > now() && !explicit) {schedule(scope,state.active.retryAt-now());return null;}
      if (!state.active) {
        if (state.history.length >= 500) return null;
        const eligible = state.pending.filter(item=>!item.blocked);
        if (!eligible.length) return null;
        if (state.dueAt > now()) {schedule(scope,state.dueAt-now());return null;}
        const baseCommit = eligible[0].baseCommit;
        const items = [];
        const requestId = crypto.randomUUID();
        for (const item of eligible) {
          if (item.baseCommit !== baseCommit || items.length >= (state.pending.some(item=>item.pendingCategories?.length) ? 19 : 20)) continue;
          const candidate = {requestId,baseCommit,operations:[...items.map(value=>value.operation),item.operation]};
          if (storageBytes(candidate) > MAX_BATCH_BYTES) {
            if (!items.length) throw new Error('저장 묶음이4MiB를 넘습니다. 편집 내용을 나누거나 백업을 내보내십시오.');
            break;
          }
          items.push(item);
        }
        state.pending = state.pending.filter(item=>!items.some(chosen=>chosen.version===item.version));
        state.active = {items,payload:{requestId,baseCommit,operations:items.map(item=>item.operation)},attempts:0,hash:'',createdAt:now(),retryAt:0,blocked:false};
      }
      checkCapacity(state);
      state.lease = {owner,expires:now()+LEASE_MS};
      state.active.blocked = false;
      state.active.attempts++;
      return structuredClone(state.active);
    });
    if (!batch) return;
    for (const waiter of waiters.values()) {
      if (waiter.scope === scope && batch.items.some(item => item.target === waiter.target && item.version >= waiter.version)) waiter.activeBatch=batch.payload.requestId;
    }
    let heartbeat;
    try {
      if (!batch.prepared) {
        batch.payload = await prepare(batch.payload,batch.items);
        if (storageBytes(batch.payload)>MAX_BATCH_BYTES || batch.payload.operations.length>20) throw Object.assign(new Error('저장 묶음의 크기나 작업 수를 확인하십시오.'),{status:413});
      }
      batch.hash = await payloadHash(batch.payload);
      await store.update(scope,state=>{
        if (state.active?.payload.requestId !== batch.payload.requestId || state.lease?.owner !== owner) throw new Error('저장 요청 소유자가 바뀌었습니다.');
        state.active.payload = batch.payload;
        state.active.prepared = true;
        state.active.hash = batch.hash;
        checkCapacity(state);
      });
      const beat = async () => {
        await store.update(scope,state=>{if(state.lease?.owner===owner)state.lease.expires=now()+LEASE_MS;});
        if (!stopped) heartbeat = setTimer(()=>void beat().catch(()=>{}),30000);
        heartbeat?.unref?.();
      };
      heartbeat = setTimer(()=>void beat().catch(()=>{}),30000);
      heartbeat?.unref?.();
      notify({scope,state:'sending',batch});
      const result = await send(batch.payload);
      if (result.state === 'superseded') {
        throw Object.assign(new Error('저장 후 원격 내용이 다시 바뀌었습니다. 편집 내용은 보관합니다. 최신 원본을 확인하십시오.'), {status:409});
      }
      const receipt = result.receipt;
      if (!['saved','published','unchanged'].includes(result.state) || receipt?.requestId !== batch.payload.requestId ||
          receipt?.payloadHash !== batch.hash || receipt?.contentCommit !== result.contentCommit || !/^[a-f0-9]{40}$/.test(result.contentCommit)) {
        throw Object.assign(new Error('원격 반영을 확인하지 못했습니다. 전송 데이터는 보관합니다.'),{status:502});
      }
      await store.update(scope,state=>{
        if (state.active?.payload.requestId !== batch.payload.requestId) throw new Error('저장 요청이 일치하지 않습니다.');
        state.history.push({...state.active,receipt,confirmedAt:now(),state:'confirmed',applied:false,result:structuredClone(result)});
        rebasePending(state,batch,result);
        state.active = null;
        state.lease = null;
        checkCapacity(state);
      });
      notify({scope,state:'confirmed',batch,result});
      for (const [version,waiter] of waiters) {
        if (waiter.scope === scope && batch.items.some(item=>item.target===waiter.target&&item.version>=waiter.version)) {
          waiter.resolve(result);waiters.delete(version);
        }
      }
      const state = await store.read(scope);
      if (state.pending.length) schedule(scope,Math.max(0,state.dueAt-now()));
    } catch(error) {
      const status = Number(error.status)||0;
      await store.update(scope,state=>{
        if (state.active?.payload.requestId !== batch.payload.requestId) return;
        const retry = (!status || status >= 500) && batch.attempts <= RETRIES.length;
        state.active.error = error.message;
        state.active.errorStatus = status;
        state.active.blocked = !retry;
        state.active.retryAt = retry ? now()+RETRIES[batch.attempts-1] : 0;
        state.lease = null;
        if(retry)schedule(scope,RETRIES[batch.attempts-1]);
      });
      notify({scope,state:'failed',batch,error});
      for (const [version,waiter] of waiters) if(waiter.scope===scope&&batch.items.some(item=>item.target===waiter.target&&item.version>=waiter.version)) {
        waiter.reject(error);waiters.delete(version);
      }
    } finally { clearTimer(heartbeat); }
  }
  async function resume(scope, explicit = false) {
    stopped = false;
    const state = await store.read(scope);
    if(state.active || state.pending.length) schedule(scope,state.active ? 0 : Math.max(0,state.dueAt-now()));
    if(explicit)return flush(scope,true);
  }
  async function reconcile(scope) {
    const state = await store.read(scope);
    for (const [key,waiter] of waiters) {
      const done = state.history.find(batch=>batch.state==='confirmed'&&batch.items.some(item=>item.target===waiter.target&&item.version>=waiter.version));
      if (waiter.scope===scope && done) {waiter.resolve(done.result);waiters.delete(key);}
    }
    return state;
  }
  async function abandonConflict(scope,target) {
    await store.update(scope,state=>{
      if(state.active?.blocked&&state.active.items.some(item=>item.target===target)) {
        state.history.push({...state.active,state:'failed'});
        // Other documents require their own conflict decision. Keep their latest
        // local save, but never silently rebase or discard it with this editor.
        for (const item of state.active.items) {
          if (item.target !== target && !state.pending.some(pending=>pending.target===item.target)) {
            state.pending.push({...item,blocked:true});
          }
        }
        state.active=null;state.lease=null;
      }
      const discarded=state.pending.filter(item=>item.target===target);
      if(discarded.length)state.history.push({state:'failed',items:discarded,payload:{requestId:crypto.randomUUID(),baseCommit:discarded[0].baseCommit,operations:discarded.map(item=>item.operation)}});
      state.pending=state.pending.filter(item=>item.target!==target);
      checkCapacity(state);
    });
  }
  function stop() {stopped=true;clearTimer(timer);}
  return {stage,flush,resume,reconcile,abandonConflict,stop};
}

export async function cleanupConfirmed(store,scope,now=Date.now(),owner=crypto.randomUUID()) {
  const snapshot = await store.update(scope,state=>{
    if(state.cleanedAt && now-state.cleanedAt<DAY_MS)return {skipped:true,retryAfterMs:DAY_MS-(now-state.cleanedAt),removed:0};
    if(state.cleanupLease&&state.cleanupLease.expires>now)return {skipped:true,retryAfterMs:state.cleanupLease.expires-now+1,removed:0};
    state.cleanupLease={owner,expires:now+60000};
    return state.history.filter(batch=>batch.state==='confirmed'&&batch.applied===true&&
      (!isSourcePending(batch.result)||batch.publicApplied===true));
  });
  if(!Array.isArray(snapshot))return snapshot;
  let removed=0;
  try {
    for(let offset=0;offset<snapshot.length;offset+=4) {
      const verified=await Promise.all(snapshot.slice(offset,offset+4).map(async batch=>({batch,hash:await payloadHash(batch.payload)})));
      await store.update(scope,state=>{
        if(state.cleanupLease?.owner!==owner)throw new Error('정리 작업 소유자가 바뀌었습니다.');
        state.cleanupLease.expires=Date.now()+60000;
        const before=state.history.length;
        state.history=state.history.filter(batch=>!verified.some(value=>value.batch.payload.requestId===batch.payload.requestId&&
          JSON.stringify(batch.payload)===JSON.stringify(value.batch.payload)&&batch.state==='confirmed'&&batch.applied===true&&
          (!isSourcePending(batch.result)||batch.publicApplied===true)&&batch.receipt?.requestId===batch.payload.requestId&&batch.receipt?.payloadHash===value.hash&&
          batch.hash===value.hash&&batch.receipt?.contentCommit===batch.result?.contentCommit&&
          /^[a-f0-9]{40}$/.test(batch.receipt?.contentCommit??'')&&Number.isFinite(batch.confirmedAt)));
        removed+=before-state.history.length;
      });
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    await store.update(scope,state=>{if(state.cleanupLease?.owner===owner){state.cleanedAt=now;state.cleanupLease=null;}});
    return {skipped:false,removed};
  } catch(error) {
    await store.update(scope,state=>{if(state.cleanupLease?.owner===owner)state.cleanupLease=null;});
    throw error;
  }
}
