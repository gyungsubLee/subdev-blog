import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { analyzeMeasurements, measurementTable } from '../2026-11-05-optimistic-workflow/analyze-measurements.mjs';
const folder=import.meta.dirname;
const analysis=await analyzeMeasurements(folder);
const previous=JSON.parse(await readFile(new URL('../2026-11-05-optimistic-workflow/analysis.json',import.meta.url),'utf8'));
const before=previous.sourcePostComparison.after;
analysis.sourcePostComparison={
  before:{medianMs:before.medianMs,calls:before.github.calls,writes:before.github.writes,requestBytes:before.github.requestBytes,decodedResponseBytes:before.github.decodedResponseBytes},
  after:analysis.sourcePostComparison.after,
  measuredImprovementPercent:analysis.sourcePostComparison.after.medianMs===null?null:(before.medianMs-analysis.sourcePostComparison.after.medianMs)/before.medianMs*100,
};
const beforeState=JSON.parse(await readFile(new URL('./state-before.json',import.meta.url),'utf8'));
const afterState=JSON.parse(await readFile(new URL('./state-after.json',import.meta.url),'utf8'));
const oldPaths=Object.keys(beforeState.files);
const changedOriginals=oldPaths.filter(path=>beforeState.files[path]!==afterState.files[path]);
const addedPaths=Object.keys(afterState.files).filter(path=>!Object.hasOwn(beforeState.files,path));
const receipts=analysis.operations.map(op=>'.cms/requests/'+op.requestId+'.json').sort();
const receiptCleanup=changedOriginals.length===0&&JSON.stringify([...addedPaths].sort())===JSON.stringify(receipts)&&beforeState.posts===afterState.posts;
analysis.inventory={...analysis.inventory,allOriginalFileShasMatch:changedOriginals.length===0,retainedTaskReceipts:addedPaths,changedOriginals,receiptCleanupVerified:receiptCleanup};
if(receiptCleanup)analysis.issues=analysis.issues.filter(issue=>issue!=='Final canonical file SHA and post-count cleanup is not verified');
else analysis.issues.push('Expected only5new immutable request receipts; every original path must stay unchanged');
const raw=JSON.parse(await readFile(new URL('./live-report.json',import.meta.url),'utf8'));
let parent=beforeState.head;
analysis.receiptProofs=analysis.operations.map(op=>{
  const row=raw.rows.find(row=>row.path==='/api/content'&&row.method==='POST'&&row.requestId===op.requestId);
  const bytes=Buffer.from(JSON.stringify({version:1,requestId:op.requestId,payloadHash:row?.payloadHash,baseCommit:parent}));
  const expected=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  const path='.cms/requests/'+op.requestId+'.json';
  const proof={path,baseCommit:parent,payloadHash:row?.payloadHash,expected,actual:afterState.files[path],matches:expected===afterState.files[path]};
  parent=op.sourceCommit;return proof;
});
if(analysis.receiptProofs.length!==5||analysis.receiptProofs.some(proof=>!proof.matches))analysis.issues.push('Durable marker bytes do not match the five exact request fingerprints and parent chain');
analysis.recoveryEvidence=JSON.parse(await readFile(new URL('./recovery.json',import.meta.url),'utf8'));
if(!analysis.recoveryEvidence.sourceUnchanged||analysis.recoveryEvidence.mutationRequests!==0)analysis.issues.push('Actual accepted recovery mutated source');
const oneCall=analysis.samples.length===3&&analysis.samples.every(sample=>sample.serverPost.github.calls===1&&sample.serverPost.github.writes===1);
if(!oneCall)analysis.issues.push('Prepared title samples must each use exactly one GitHub mutation');
analysis.singleRequestVerified=oneCall;
analysis.notes=analysis.notes.filter(note=>!note.includes('historical save baseline used 3033'));
analysis.notes.push('Comparison baseline is previous actual12call source POST6.122268s, not the older26call18.613s baseline.');
analysis.complete=analysis.issues.length===0;
await writeFile(new URL('./analysis.json',import.meta.url),JSON.stringify(analysis,null,2)+'\n');
console.log(measurementTable(analysis));
if(!analysis.complete)process.exitCode=2;
