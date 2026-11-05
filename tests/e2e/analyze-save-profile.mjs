import {readFile,writeFile} from 'node:fs/promises';
function union(intervals){const sorted=intervals.filter(([a,b])=>b>a).sort((a,b)=>a[0]-b[0]);let sum=0,end=-Infinity;for(const[a,b]of sorted){sum+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}return sum;}
const input=process.argv[2] ?? '.tmp/save-stage-real-github/report.json';
const report=JSON.parse(await readFile(input,'utf8'));
const data=report.sides?.after ?? report;
const updates=data.apiRows.filter(x=>x.operation==='post.update'&&x.status===200&&x.trace);
const samples=updates.map(row=>{
 const t=row.trace;
 const calls=t.calls.map(c=>({...c,awaitedEndMs:c.bodyComplete?c.endMs:c.startMs+c.headersMs}));
 const stages=t.stages.map(s=>{
  const own=calls.filter(c=>c.stage===s.name);
  const networkMs=union(own.map(c=>[Math.max(s.startMs,c.startMs),Math.min(s.endMs,c.awaitedEndMs)]));
  return {...s,wallMs:s.endMs-s.startMs,calls:own.length,networkMs,residualMs:s.endMs-s.startMs-networkMs,requestBytes:own.reduce((n,c)=>n+c.requestBytes,0),responseBytes:own.reduce((n,c)=>n+c.responseBytes,0)};
 });
 const networkMs=union(calls.map(c=>[c.startMs,Math.min(t.totalMs,c.awaitedEndMs)]));
 return {handlerMs:row.ms,traceMs:t.totalMs,calls:calls.length,networkMs,residualMs:t.totalMs-networkMs,requestBytes:calls.reduce((n,c)=>n+c.requestBytes,0),responseBytes:calls.reduce((n,c)=>n+c.responseBytes,0),stages,callsDetail:calls};
});
const result={samples};await writeFile(process.argv[3] ?? '.tmp/save-stage-profile/analysis.json',JSON.stringify(result,null,2));
for(const [index,s]of samples.entries())console.log(JSON.stringify({sample:index+1,totalSeconds:s.handlerMs/1000,requestMB:s.requestBytes/1e6,responseDecodedMB:s.responseBytes/1e6,networkSeconds:s.networkMs/1000,residualSeconds:s.residualMs/1000,stages:s.stages.map(({name,wallMs,calls,networkMs,residualMs})=>({name,ms:wallMs,calls,networkMs,residualMs}))}));
