import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { loadComponent } from '../support/load-component.mjs';
const dom = new JSDOM('<div id="root"></div>', {url:'https://blog.test',pretendToBeVisual:true});
for(const name of ['window','document','navigator','HTMLElement']) Object.defineProperty(globalThis,name,{value:name==='window'?dom.window:dom.window[name],configurable:true});
globalThis.localStorage=dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const {default:React,act}=await import('react');
const {createRoot}=await import('react-dom/client');
const {usePosts}=await loadComponent('app/web/src/site/usePosts.ts');
const post={id:'p',title:'Cached title',markdown:'body',parentId:null,category:'c',createdAt:'',updatedAt:'',path:'',url:'',excerpt:''};
const data={posts:[post],categories:[{id:'c',name:'C',parentId:null,order:0,sources:[]}],contentCommit:'a'.repeat(40)};
let current;
function Harness(){current=usePosts(undefined);return React.createElement('p',null,current.loaded?current.posts[0]?.title:'loading');}
after(()=>dom.window.close());
test('a remounted public view renders stored data without waiting for or repeating the index download',{timeout:5000},async()=>{
 const previous=globalThis.fetch;let calls=0;let root;
 globalThis.fetch=async()=>{calls++;return Response.json(data);};
 try{
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Harness)));
  assert.equal(document.querySelector('p').textContent,'Cached title');
  await act(async()=>root.unmount());
  globalThis.fetch=async()=>{calls++;return new Promise(()=>{});};
  root=createRoot(document.getElementById('root'));
  await act(async()=>root.render(React.createElement(Harness)));
  assert.equal(document.querySelector('p').textContent,'Cached title');
  assert.equal(calls,1,'Repeat mounts must use the persisted index');
 }finally{if(root)await act(async()=>root.unmount());globalThis.fetch=previous;localStorage.clear();}
});
