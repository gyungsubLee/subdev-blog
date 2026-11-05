import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const folder=new URL('./',import.meta.url),repo='gyungsubLee/subdev-blog-content';
const state=JSON.parse(await readFile(new URL('state-after.json',folder),'utf8'));
const previous=JSON.parse(await readFile(new URL('../../../.tmp/optimistic-workflow/dispatch-before.json',folder),'utf8'));
const oldSource='6429b63738535b3013177c0ae0e44a00d20d73e8';
const api=p=>JSON.parse(execFileSync('gh',['api','repos/'+repo+'/'+p],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024}));
const beforeReady=api('git/ref/heads/public-ready/main').object.sha;
if(beforeReady!==state.head)throw Error('Latest deletion must already be the ready source');
execFileSync('gh',['workflow','run','public-content.yml','--repo',repo,'--ref','main','-f','source_commit='+oldSource],{encoding:'utf8',timeout:30000});
let runs=api('actions/workflows/public-content.yml/runs?event=workflow_dispatch&per_page=5').workflow_runs.filter(run=>!previous.some(item=>item.id===run.id));
if(runs.length===0){await new Promise(resolve=>setTimeout(resolve,5000));runs=api('actions/workflows/public-content.yml/runs?event=workflow_dispatch&per_page=5').workflow_runs.filter(run=>!previous.some(item=>item.id===run.id));}
if(runs.length!==1)throw Error('Dispatch accepted; reconcile exact new workflow identity before retrying');
const run=runs[0];console.log(JSON.stringify({id:run.id,url:run.html_url,oldSource,beforeReady}));
const child=spawn('gh',['run','watch',String(run.id),'--repo',repo,'--exit-status','--interval','10'],{stdio:['ignore','pipe','pipe']});
let watch='';for(const stream of[child.stdout,child.stderr])stream.on('data',part=>{if(watch.length<1024*1024)watch+=part;});
const timer=setTimeout(()=>child.kill('SIGTERM'),240000);
const exit=await new Promise(resolve=>child.once('close',resolve));clearTimeout(timer);
await writeFile(new URL('late-workflow-watch.log',folder),watch);
const final=api('actions/runs/'+run.id);
const logs=execFileSync('gh',['run','view',String(run.id),'--repo',repo,'--log'],{encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
const lines=logs.split('\n').filter(line=>line.includes('"requestBytes"')||line.includes('"sourceCommit"')||line.includes("'"+state.pin+"'"));
await writeFile(new URL('late-workflow-trace.log',folder),lines.join('\n')+'\n');
const calls=[];let result;
for(const line of lines){const at=line.indexOf('{');if(at<0)continue;const row=JSON.parse(line.slice(at));if('requestBytes'in row)calls.push(row);else if(row.sourceCommit)result=row;}
const afterReady=api('git/ref/heads/public-ready/main').object.sha,afterHead=api('git/ref/heads/main').object.sha;
const evidence={id:final.id,url:final.html_url,headSha:final.head_sha,attempt:final.run_attempt,conclusion:final.conclusion,oldSource,beforeReady,afterReady,afterHead,result,calls:calls.length,writes:calls.filter(call=>call.method!=='GET').length,requestBytes:calls.reduce((n,c)=>n+c.requestBytes,0),decodedResponseBytes:calls.reduce((n,c)=>n+c.responseBytes,0),watchExit:exit};
evidence.passed=final.conclusion==='success'&&result?.sourceCommit===oldSource&&result?.state==='superseded'&&afterReady===beforeReady&&afterHead===state.head&&evidence.writes===0;
await writeFile(new URL('late-workflow.json',folder),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));if(!evidence.passed)process.exitCode=1;
