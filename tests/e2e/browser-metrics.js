(() => {
  let routeStarted=0;
  const seen=new Set();
  let longTasks=0;
  new PerformanceObserver(list=>{longTasks+=list.getEntries().reduce((sum,entry)=>sum+entry.duration,0);}).observe({type:'longtask',buffered:true});
  const emit=(event,extra={})=>navigator.sendBeacon('/__e2e/metrics',new Blob([JSON.stringify({event,hash:location.hash||'#/',at:performance.now(),elapsedMs:performance.now()-routeStarted,longTaskMs:longTasks,...extra})],{type:'application/json'}));
  let savedAt=0;
  document.addEventListener('click',event=>{const button=event.target.closest?.('button');if(button&&(button.id==='save-all'||button.type==='submit')){savedAt=performance.now();emit('save-click');}},true);
  window.addEventListener('second-brain:sync',event=>{emit('sync-notification',{state:event.detail?.state,hasResult:Boolean(event.detail?.result),batchState:event.detail?.batch?.state});if(savedAt)emit('save-'+(event.detail?.state??'error'),{sinceSaveMs:performance.now()-savedAt});});
  window.addEventListener('hashchange',()=>{routeStarted=performance.now();seen.clear();});
  function inspect() {
    const ready=[];
    if(document.querySelector('.home-article-card')) ready.push('home-ready');
    if(document.querySelector('.records-page .post-card')) ready.push('records-ready');
    if(document.querySelector('.article-prose[aria-busy="false"]')) ready.push('post-ready');
    if(document.querySelector('[contenteditable="true"]')) ready.push('editor-ready');
    if(document.querySelector('.content-workspace')) ready.push('workspace-ready');
    for(const event of ready) {
      const key=event+location.hash;
      if(seen.has(key)) continue;
      seen.add(key);
      const domReadyMs=performance.now()-routeStarted;
      requestAnimationFrame(()=>requestAnimationFrame(()=>emit(event,{domReadyMs,resources:performance.getEntriesByType('resource').filter(entry=>entry.name.includes('/api/')).map(entry=>({name:new URL(entry.name).pathname+new URL(entry.name).search,duration:entry.duration,transferSize:entry.transferSize}))})));
    }
  }
  new MutationObserver(inspect).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-busy']});
  document.addEventListener('DOMContentLoaded',inspect);
  const checkImages=()=>{
    const images=[...document.images];
    if(!images.length||images.some(image=>!image.complete)) return;
    const key='images:'+location.hash+':'+images.map(image=>image.src).join('|');
    if(seen.has(key)) return;seen.add(key);
    emit('images-complete',{images:images.length,failed:images.filter(image=>image.naturalWidth===0).length});
  };
  document.addEventListener('load',event=>{
    if(event.target instanceof HTMLImageElement) emit('image-loaded',{src:new URL(event.target.src).pathname,width:event.target.naturalWidth,height:event.target.naturalHeight});
    checkImages();
  },true);
  document.addEventListener('error',event=>{if(event.target instanceof HTMLImageElement)checkImages();},true);
  window.addEventListener('error',event=>emit('page-error',{message:String(event.message).slice(0,300)}));
  window.addEventListener('unhandledrejection',event=>emit('unhandled-rejection',{message:String(event.reason).slice(0,300)}));
})();
