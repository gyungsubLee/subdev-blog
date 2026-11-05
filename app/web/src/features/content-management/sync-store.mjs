// ponytail: one transactional record per scope, capped at 50 MiB. Split records
// only if larger offline queues justify the extra transaction coordination.
const DB_NAME = 'second-brain-sync-v1';
let database;

function openDatabase() {
  if (!database) {
    database = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('기기 저장소를 사용할 수 없습니다. 편집 내용을 내보내십시오.'));
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('queues');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = undefined; };
        resolve(db);
      };
      request.onerror = () => { database = undefined; reject(request.error); };
      request.onblocked = () => { database = undefined; reject(new Error('다른 창의 기기 저장소 연결을 닫은 뒤 다시 시도하십시오.')); };
    });
  }
  return database;
}

export function emptyQueue() {
  return { version: 0, dueAt: 0, pending: [], active: null, history: [], lease: null, cleanupLease: null, cleanedAt: 0 };
}

export const syncStore = {
  async read(scope) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('queues', 'readonly');
      const request = transaction.objectStore('queues').get(scope);
      transaction.oncomplete = () => resolve(request.result ?? emptyQueue());
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  },
  async update(scope, edit) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('queues', 'readwrite');
      const store = transaction.objectStore('queues');
      const request = store.get(scope);
      let result;
      let failure;
      request.onsuccess = () => {
        try {
          const state = request.result ?? emptyQueue();
          result = edit(state);
          store.put(state, scope);
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? transaction.error);
      transaction.onerror = () => reject(failure ?? transaction.error);
    });
  },
};
