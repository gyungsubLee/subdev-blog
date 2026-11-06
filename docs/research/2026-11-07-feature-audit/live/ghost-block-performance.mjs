import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadComponent } from '../../../../tests/support/load-component.mjs';

const dom=new JSDOM('<!doctype html><html><body></body></html>');
for(const name of ['window','document','navigator','Node','Element','HTMLElement','MutationObserver','DOMParser']) {
  Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});
}
const {BlockNoteEditor}=await import('@blocknote/core');
const {editorSchema}=await loadComponent('app/web/src/features/post-editor/code-block.ts');
const {serializeEditorMarkdown}=await loadComponent('app/web/src/features/post-editor/document-markdown.ts');
const editor=BlockNoteEditor.create({schema:editorSchema,initialContent:[
  ...Array.from({length:100},(_,index)=>({type:'paragraph',content:'Snapshot performance paragraph '+index})),
  {type:'image',props:{url:'https://example.test/image.png',name:'sample'}},
]});
try {
  const baseline=editor.prosemirrorState.doc;
  const initialMarkdown=serializeEditorMarkdown(editor);
  editor.updateBlock(editor.document.at(-1),{props:{previewWidth:200}});
  assert.equal(serializeEditorMarkdown(editor),initialMarkdown);
  function snapshot(markChanges) {
    const value={blocks:JSON.parse(JSON.stringify(editor.document)),markdown:serializeEditorMarkdown(editor)};
    if(markChanges)value.blocksChanged=!editor.transact(transaction=>baseline.eq(transaction.doc));
    return JSON.stringify(value);
  }
  if(process.argv.includes('--profile')) {
    const measure=(work,count)=>{
      for(let index=0;index<20;index++)work();
      const started=performance.now();
      for(let index=0;index<count;index++)work();
      return (performance.now()-started)/count;
    };
    const current=editor.prosemirrorState.doc;
    const blocks=JSON.parse(JSON.stringify(editor.document));
    const markdown=serializeEditorMarkdown(editor);
    console.log(JSON.stringify({
      directEqMs:measure(()=>baseline.eq(current),20000),
      transactionEqMs:measure(()=>editor.transact(transaction=>baseline.eq(transaction.doc)),20000),
      blocksSnapshotMs:measure(()=>JSON.parse(JSON.stringify(editor.document)),100),
      markdownMs:measure(()=>serializeEditorMarkdown(editor),100),
      beforeFinalJsonMs:measure(()=>JSON.stringify({blocks,markdown}),1000),
      afterFinalJsonMs:measure(()=>JSON.stringify({blocks,markdown,blocksChanged:true}),1000),
      firstParagraphShared:baseline.firstChild.firstChild===current.firstChild.firstChild,
    },null,2));
  } else {
  const runs={before:[],after:[]};
  for(let round=0;round<7;round++) {
    for(const markChanges of round%2?[true,false]:[false,true]) {
      const started=performance.now();
      for(let iteration=0;iteration<100;iteration++)snapshot(markChanges);
      if(round>0)runs[markChanges?'after':'before'].push((performance.now()-started)/100);
    }
  }
  const median=values=>[...values].sort((first,second)=>first-second)[Math.floor(values.length/2)];
  console.log(JSON.stringify({
    inputBlocks:101,iterationsPerRound:100,measuredRounds:6,
    beforeMedianMsPerSnapshot:median(runs.before),afterMedianMsPerSnapshot:median(runs.after),
    addedSerializedBytes:Buffer.byteLength(snapshot(true))-Buffer.byteLength(snapshot(false)),
    changed:JSON.parse(snapshot(true)).blocksChanged,markdownBytesUnchanged:true,
  },null,2));
  }
} finally {editor._tiptapEditor.destroy();dom.window.close();}
