import { syncStore } from './sync-store.mjs';
import { cleanupConfirmed } from './sync-core.mjs';
let running;
self.onmessage = event => {
  if (running || typeof event.data?.scope !== 'string') return;
  const scope = event.data.scope;
  running = cleanupConfirmed(syncStore,scope).then(result=>self.postMessage({scope,...result}),error=>self.postMessage({scope,error:error.message}))
    .finally(()=>{running=undefined;});
};
