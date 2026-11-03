from pathlib import Path
import subprocess, resource, json, time
p = Path('tests/managed-block-editor.test.mjs').read_text()
setup = p[p.index('const dom ='):p.index('const { default: React, act }')]
script = Path('tests/.benchmark-approved-editor.mjs')
script.write_text('''import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createHash } from 'node:crypto';
import { loadComponent } from './support/load-component.mjs';
'''+setup+'''
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const mode=process.argv[2];
const entry=mode==='baseline'?'src/features/content-management/.benchmark-baseline.tsx':'src/features/content-management/ManagedPostEditor.tsx';
const { default: Editor }=await loadComponent(entry);
const id='12345678-1234-8234-9234-123456789012';
const blocks=Array.from({length:100},(_,n)=>({id:'paragraph-'+n,type:'paragraph',content:[{type:'text',text:'Paragraph '+n+' bounded editor performance fixture with ordinary words.',styles:{}}],children:[]}));
const markdown=blocks.map(block=>block.content[0].text).join('\\n\\n');
const source={document:{metadata:{id,title:'Benchmark',category_id:'notes',tags:[]},markdown},editor:{schemaVersion:1,documentId:id,markdownHash:createHash('sha256').update(markdown).digest('hex'),blocks},categories:[{id:'notes',name:'Notes',parent_id:null,order:0,sources:[]}],assets:[],revision:'a'.repeat(64),editorRevision:'d'.repeat(64),contentCommit:'b'.repeat(40)};
const session={state:'ready',csrfToken:'csrf',connection:{repository:'owner/content',branch:'main',contentCommit:'b'.repeat(40)}};
let writes=0,writeMs=0,network=0;
const nativeSetItem=dom.window.Storage.prototype.setItem;
dom.window.Storage.prototype.setItem=function(key,value){const start=performance.now();const result=nativeSetItem.call(this,key,value);writeMs+=performance.now()-start;writes++;return result;};
globalThis.fetch=async url=>{network++;assert.ok(url.startsWith('/api/content?'),'editing must not publish');return{ok:true,status:200,json:async()=>source};};
const root=createRoot(document.getElementById('root'));
let result;
try{
 const started=performance.now();
 await act(async()=>root.render(React.createElement(Editor,{post:{id,title:'Benchmark',markdown,category:'notes',categoryId:'notes'},session,onClose(){}})));
 const deadline=Date.now()+5000;
 while(document.querySelector('.bn-editor[contenteditable="true"]')===null){assert.ok(Date.now()<deadline,'editor load deadline');await act(async()=>new Promise(resolve=>setTimeout(resolve,10)));}
 const mountMs=performance.now()-started;
 const view=document.querySelector('.bn-editor[contenteditable="true"]').editor.view;
 let textPosition;
 view.state.doc.descendants((node,pos)=>{if(node.isText&&textPosition===undefined)textPosition=pos;});
 assert.equal(typeof textPosition,'number');
 await act(async()=>view.dispatch(view.state.tr.insertText('w',textPosition)));
 writes=0;writeMs=0;
 const durations=[];
 for(let n=0;n<20;n++){const start=performance.now();await act(async()=>view.dispatch(view.state.tr.insertText('x',textPosition)));durations.push(performance.now()-start);}
 const settleStarted=performance.now();
 await act(async()=>new Promise(resolve=>setTimeout(resolve,220)));
 const settleMs=performance.now()-settleStarted;
 if(mode==='current') assert.ok(document.querySelector('[aria-label=\"독자 화면 미리보기\"]').textContent.includes('x'.repeat(20)),'preview settles to final edit');
 const value=JSON.parse(localStorage.getItem('second-brain:canonical-draft:'+id));
 assert.equal(value.blocks.length,100);
 assert.ok(value.markdown.includes('x'.repeat(20)),'recovery contains all edits');
 assert.ok(value.blocks[0].content[0].text.includes('x'.repeat(20)),'recovery blocks match all edits');
 assert.equal(network,1,'body edits reuse loaded source');
 result={mode,settleWaitMs:220,settleMs,previewParity:mode==='current'?true:null,paragraphs:100,edits:20,mountMs,editTotalMs:durations.reduce((a,b)=>a+b,0),editMedianMs:[...durations].sort((a,b)=>a-b)[10],editMaxMs:Math.max(...durations),localRecoveryWrites:writes,localStorageWriteMs:writeMs,recoveryBytes:JSON.stringify(value).length,recoveryParity:true,network,previewVisible:document.querySelector('[aria-label="독자 화면 미리보기"]')!==null,memoryRssBytes:process.memoryUsage().rss};
}finally{await act(async()=>root.unmount());dom.window.close();}
console.log(JSON.stringify(result));
''')
baseline=Path('src/features/content-management/.benchmark-baseline.tsx')
baseline.write_bytes(subprocess.check_output(['git','show','HEAD:src/features/content-management/ManagedPostEditor.tsx']))
def limit():
 resource.setrlimit(resource.RLIMIT_CPU,(45,45))
 resource.setrlimit(resource.RLIMIT_FSIZE,(1024*1024,1024*1024))
try:
 results=[]
 sample=int(__import__('sys').argv[1])
 for mode in ['baseline','current']:
  log=Path('/tmp/approved-editor-benchmark')/(mode+'-final-'+str(sample)+'.log')
  with log.open('w') as output:
   started=time.monotonic()
   proc=subprocess.Popen(['node','--max-old-space-size=768',str(script),mode],stdout=output,stderr=subprocess.STDOUT,preexec_fn=limit)
   try:code=proc.wait(timeout=55)
   except subprocess.TimeoutExpired:proc.kill();proc.wait();raise
  result={'mode':mode,'exitCode':code,'elapsedSeconds':round(time.monotonic()-started,3),'log':str(log)}
  results.append(result);print(json.dumps(result),flush=True)
  if code:break
 Path('/tmp/approved-editor-benchmark/process-results-final-'+str(sample)+'.json').write_text(json.dumps(results,indent=2))
finally:
 baseline.unlink(missing_ok=True)
 script.unlink(missing_ok=True)
