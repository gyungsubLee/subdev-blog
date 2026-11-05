// Native IndexedDB is exercised by the connected Chrome E2E; component tests use
// the same transactional contract, backed by their isolated JSDOM storage.
const queues = new WeakMap();
function storage() { return globalThis.localStorage; }
function emptyQueue() { return {version:0,dueAt:0,pending:[],active:null,history:[],lease:null,cleanupLease:null,cleanedAt:0}; }
export const syncStore = {
  async read(scope) { return JSON.parse(storage().getItem('test-sync:'+scope) ?? 'null') ?? emptyQueue(); },
  async update(scope,edit) {
    const target=storage();
    const previous=queues.get(target) ?? Promise.resolve();
    const result=previous.then(()=>{
      const state=JSON.parse(target.getItem('test-sync:'+scope) ?? 'null') ?? emptyQueue();
      const value=edit(state);
      target.setItem('test-sync:'+scope,JSON.stringify(state));
      return value;
    });
    queues.set(target,result.catch(()=>{}));
    return result;
  },
};
