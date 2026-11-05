import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {loadComponent} from '../../../../tests/support/load-component.mjs';
import {syncStore} from '../../../../tests/support/memory-sync-store.mjs';
import {cleanupConfirmed,payloadHash} from '../../../../app/web/src/features/content-management/sync-core.mjs';

const results=[];
const dom=new JSDOM('',{url:'https://reverify.test'});
const previous={window:globalThis.window,storage:globalThis.localStorage,channel:globalThis.BroadcastChannel};
globalThis.window=dom.window;globalThis.localStorage=dom.window.localStorage;
let channel;let service;
globalThis.BroadcastChannel=class {constructor(){channel=this;}postMessage(){}close(){}unref(){}};
try {
 service=await loadComponent('app/web/src/features/content-management/background-sync.mjs');
 const session={state:'ready',user:{id:42},csrfToken:'csrf'};
 const scope=service.syncScope(session),events=[];
 window.addEventListener(service.SYNC_EVENT,event=>events.push({state:event.detail.state,hasResult:Boolean(event.detail.result)}));
 await syncStore.update(scope,state=>{state.history=[{state:'failed',payload:{requestId:'archived-conflict'},items:[{target:'p',version:1}]}];});
 service.startContentSync(session);
 channel.onmessage({data:{scope,state:'failed',batchId:'archived-conflict'}});
 await new Promise(resolve=>setTimeout(resolve,20));
 const confirmed=events.filter(event=>event.state==='confirmed');
 try {assert.equal(confirmed.length,0);results.push({probe:'archived-failed-peer-event',policyPassed:true});}
 catch {results.push({probe:'archived-failed-peer-event',policyPassed:false,confirmedEvents:confirmed});}
} finally {
 service?.stopContentSync();dom.window.close();globalThis.window=previous.window;globalThis.localStorage=previous.storage;globalThis.BroadcastChannel=previous.channel;
}
const payload={requestId:'r',baseCommit:'a'.repeat(40),operations:[]};
const hash=await payloadHash(payload);
const state={history:[{state:'confirmed',applied:true,payload,hash,confirmedAt:Date.now(),receipt:{requestId:'r',payloadHash:hash,contentCommit:'c'.repeat(40)},result:{contentCommit:'b'.repeat(40)}}],cleanedAt:0,cleanupLease:null};
const store={read:async()=>structuredClone(state),update:async(_scope,edit)=>edit(state)};
const cleanup=await cleanupConfirmed(store,'scope');
try {assert.equal(cleanup.removed,0);results.push({probe:'mismatched-receipt-commit',policyPassed:true});}
catch {results.push({probe:'mismatched-receipt-commit',policyPassed:false,removed:cleanup.removed,remaining:state.history.length});}
await writeFile(new URL('./edge-probes-current.json',import.meta.url),JSON.stringify(results,null,2));
console.log(JSON.stringify(results));process.exitCode=results.some(result=>!result.policyPassed)?1:0;
