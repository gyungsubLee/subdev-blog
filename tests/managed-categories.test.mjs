import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { loadComponent } from './support/load-component.mjs';

const dom = new JSDOM('<div id="root"></div>', {url:'https://blog.example/#/categories',pretendToBeVisual:true});
for (const name of ['window','document','navigator','HTMLElement']) {
  Object.defineProperty(globalThis,name,{value:name==='window'?dom.window:dom.window[name],configurable:true});
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.matchMedia = () => ({matches:false});
dom.window.scrollBy = () => {};
dom.window.HTMLDialogElement.prototype.showModal = function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close = function(){this.open=false;};
const {default:React,act} = await import('react');
const {createRoot} = await import('react-dom/client');
const {default:ManagedCategories} = await loadComponent('src/features/content-management/ManagedCategories.tsx');
const ready = {state:'ready',csrfToken:'csrf'};
const categories = [
  {id:'group:unclassified',name:'미분류',parent_id:null,order:0,sources:[],opaque:{keep:true}},
  {id:'group:cs',name:'CS',parent_id:null,order:1,sources:[]},
  {id:'leaf',name:'수학',parent_id:'group:cs',order:0,sources:['Math'],opaque:{original:7}},
  {id:'free',name:'빈 분류',parent_id:null,order:2,sources:['free-source']},
];
const source = {categories,revision:'a'.repeat(64),contentCommit:'b'.repeat(40)};
const reply = (data,status=200) => ({ok:status<400,status,json:async()=>data});
const row = name => [...document.querySelectorAll('.category-row')].find(item=>item.querySelector('.row-name').textContent.startsWith(name));
async function click(element) { assert.ok(Boolean(element)); await act(async()=>element.click()); }
async function rename(name,next) {
  await click(row(name).querySelector('[data-action="edit"]'));
  const field=document.querySelector('#inline-name');
  await act(async()=>{
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,next);
    field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  await act(async()=>document.querySelector('#inline-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
}
async function mount(run,session=ready,posts=[]) {
  const originalFetch=globalThis.fetch;
  const calls=[];
  let failure=true;
  globalThis.fetch=async(url,options={})=>{
    calls.push({url,...options});
    if(url.startsWith('/api/content?'))return reply(source);
    if(url==='/api/content')return failure?reply({error:'로그인이 필요합니다.'},401):reply({state:'unchanged',requestId:JSON.parse(options.body).requestId,contentCommit:source.contentCommit});
    throw Error('Unexpected '+url);
  };
  const root=createRoot(document.querySelector('#root'));
  localStorage.clear();
  localStorage.setItem('second-brain:categories:v2','personal-settings');
  try {
    await act(async()=>root.render(React.createElement(ManagedCategories,{session,categories:[],posts})));
    await run({calls,root,succeed(){failure=false;}});
  } finally {
    await act(async()=>root.unmount());
    localStorage.clear();
    globalThis.fetch=originalFetch;
  }
}

test('prior category tree UI renames canonical records and retries identical request after 401', {timeout:10000}, async()=>{
  await mount(async({calls,succeed})=>{
    assert.ok(Boolean(row('수학')));
    assert.ok(Boolean(document.querySelector('#add-bottom')));
    await rename('수학','수학 변경');
    assert.ok(Boolean(row('수학 변경')));
    await click(document.querySelector('#save-all'));
    assert.ok(Boolean(document.querySelector('a[href="/api/auth/github"]')));
    const first=calls.find(call=>call.url==='/api/content');
    const payload=JSON.parse(first.body);
    assert.equal(payload.baseCommit,source.contentCommit);
    assert.equal(payload.operation.baseRevision,source.revision);
    const leaf=payload.operation.categories.find(category=>category.id==='leaf');
    assert.equal(leaf.name,'수학 변경');
    assert.equal(leaf.parent_id,'group:cs');
    assert.deepEqual(leaf.sources,['Math']);
    assert.deepEqual(leaf.opaque,{original:7});
    const persisted = JSON.parse(localStorage.getItem('second-brain:canonical-categories'));
    assert.equal(persisted.requestId,payload.requestId);
    assert.equal(persisted.contentCommit,payload.baseCommit);
    assert.equal(persisted.revision,payload.operation.baseRevision);
    assert.equal(localStorage.getItem('second-brain:categories:v2'),'personal-settings');
    succeed();
    await click(document.querySelector('#save-all'));
    assert.equal(calls.filter(call=>call.url==='/api/content')[1].body,first.body);
    assert.ok(Boolean(document.querySelector('.publish-status')));
  });
});

test('canonical deletion protects parents, assigned leaves and unclassified without source redistribution', {timeout:10000}, async()=>{
  await mount(async({calls,succeed})=>{
    assert.equal(row('CS').querySelector('[data-action="delete"]').disabled,true);
    assert.equal(row('수학').querySelector('[data-action="delete"]').disabled,true);
    assert.equal(row('미분류').querySelector('[data-action="delete"]').disabled,true);
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    assert.doesNotMatch(document.querySelector('#delete-dialog').textContent,/한 단계 위|미분류에 유지/);
    await click(document.querySelector('#confirm-delete'));
    assert.ok(row('빈 분류') === undefined, 'Deleted category row must be absent');
    await click(document.querySelector('#undo'));
    assert.ok(Boolean(row('빈 분류')));
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    await click(document.querySelector('#confirm-delete'));
    succeed();
    await click(document.querySelector('#save-all'));
    const payload=JSON.parse(calls.find(call=>call.url==='/api/content').body);
    assert.deepEqual(payload.operation.categories.find(category=>category.id==='group:unclassified').sources,[]);
  },ready,[{id:'post',categoryId:'leaf',category:'Math'}]);
});

test('signed out management renders nothing and never requests canonical content', {timeout:10000}, async()=>{
  await mount(async({calls})=>{
    assert.ok(document.querySelector('main') === null, 'signed out management must render no main element');
    assert.equal(calls.length,0);
  },{state:'signed_out'});
});

test('existing keyboard tree movement serializes canonical parent and sibling order', {timeout:10000}, async()=>{
  await mount(async({calls,succeed})=>{
    const grip = row('빈 분류').querySelector('.grip');
    await act(async()=>grip.dispatchEvent(new dom.window.KeyboardEvent('keydown',{
      key:'ArrowRight',bubbles:true,cancelable:true,
    })));
    succeed();
    await click(document.querySelector('#save-all'));
    const payload = JSON.parse(calls.find(call=>call.url==='/api/content').body);
    const moved = payload.operation.categories.find(category=>category.id==='free');
    assert.equal(moved.parent_id,'group:cs');
    assert.equal(moved.order,1);
    assert.deepEqual(moved.sources,['free-source']);
    const leaf = payload.operation.categories.find(category=>category.id==='leaf');
    assert.equal(leaf.order,0);
    assert.deepEqual(leaf.opaque,{original:7});
  });
});

test('malformed saved canonical records keep their bytes and fall back to safe source nodes', {timeout:10000}, async()=>{
  await mount(async({root})=>{
    const bytes = JSON.stringify({
      ...source,
      requestId:'saved-request',
      categories:[{id:'broken',name:'Broken',parent_id:null,order:0}],
    });
    localStorage.setItem('second-brain:canonical-categories',bytes);
    await act(async()=>root.render(React.createElement(ManagedCategories,{key:'reload',session:ready,categories:[]})));
    assert.ok(Boolean(row('수학')));
    assert.equal(localStorage.getItem('second-brain:canonical-categories'),bytes);
    assert.match(document.querySelector('[role="alert"]').textContent,/보관한 편집 내용을 읽지 못했습니다/);
  });
});

test('canonical counts include stable category IDs and aliases once without changing sources', {timeout:10000}, async()=>{
  await mount(async()=>{
    assert.equal(row('수학').querySelector('.inline-count').textContent,'(2)');
    assert.equal(row('CS').querySelector('.inline-count').textContent,'(2)');
    assert.equal(row('빈 분류').querySelector('.inline-count').textContent,'(1)');
    const persisted = JSON.parse(localStorage.getItem('second-brain:canonical-categories'));
    assert.deepEqual(persisted.categories.find(category=>category.id==='leaf').sources,['Math']);
  },ready,[
    {id:'canonical',category:'leaf'},
    {id:'canonical-and-alias',categoryId:'leaf',category:'Math'},
    {id:'legacy',category:'free-source'},
  ]);
});

test('local drafts neither count nor block deletion of canonical categories', {timeout:10000}, async()=>{
  await mount(async()=>{
    assert.equal(row('빈 분류').querySelector('.inline-count').textContent,'(0)');
    assert.equal(row('빈 분류').querySelector('[data-action="delete"]').disabled,false);
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    await click(document.querySelector('#confirm-delete'));
    assert.ok(row('빈 분류') === undefined,'A draft-only category may be removed from the canonical draft');
  },ready,[
    {id:'draft-id',categoryId:'free',category:'free-source',draft:true},
  ]);
});

after(() => dom.window.close());
