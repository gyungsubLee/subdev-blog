import { bulkResponse } from '../support/bulk-response.mjs';
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { loadComponent } from '../support/load-component.mjs';

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
const {default:ManagedCategories} = await loadComponent('app/web/src/features/content-management/ManagedCategories.tsx');
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
async function click(element) { assert.ok(Boolean(element)); const save=element.id==="save-all"; await act(async()=>element.click()); if(save) await act(async()=>new Promise(resolve=>setTimeout(resolve,5100))); }
async function rename(name,next) {
  await click(row(name).querySelector('[data-action="edit"]'));
  const field=document.querySelector('#inline-name');
  await act(async()=>{
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,next);
    field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  });
  await act(async()=>document.querySelector('#inline-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
}
async function mount(run,session=ready,posts=[],failureStatus=401) {
  const originalFetch=globalThis.fetch;
  const calls=[];
  let failure=true;
  let currentSource=source;
  globalThis.fetch=async(url,options={})=>{
    calls.push({url,...options});
    if(url.startsWith('/api/content?'))return reply(currentSource);
    if(url==='/api/content') {
      if(failure) return reply({error:failureStatus===409?'Canonical branch changed':'로그인이 필요합니다.'},failureStatus);
      const input=JSON.parse(options.body);
      if(input.operations) {
        const operation=input.operations.find(operation=>operation.type==='categories.save');
        const originals=new Map(currentSource.categories.map(category=>[category.id,category]));
        const savedCategories=operation.categories.map(category=>({
          ...(originals.get(category.id)??{id:category.id,sources:[category.id]}),
          name:category.name,parent_id:category.parent_id,order:category.order,
        }));
        currentSource={categories:savedCategories,revision:'f'.repeat(64),contentCommit:'c'.repeat(40)};
        return reply({...bulkResponse(input,{
          state:'saved',candidateCommit:currentSource.contentCommit,contentCommit:currentSource.contentCommit,publicationPending:true,
        },currentSource),categories:currentSource});
      }
      const deletedPostIds=input.operation.mode==='delete'
        ? posts.filter(post=>(post.categoryId??post.category)===input.operation.id).map(post=>post.id)
        : [];
      if(input.operation.type==='category.delete') currentSource={
        categories:currentSource.categories.filter(category=>category.id!==input.operation.id),
        revision:'d'.repeat(64),contentCommit:'c'.repeat(40),
      };
      return reply({state:input.operation.type==='category.delete'?'saved':'unchanged',requestId:input.requestId,candidateCommit:currentSource.contentCommit,contentCommit:currentSource.contentCommit,deletedPostIds});
    }
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
    dom.window.dispatchEvent(new dom.window.Event('pagehide'));
    localStorage.clear();
    globalThis.fetch=originalFetch;
  }
}

test('prior category tree UI renames canonical records and retries identical request after 401', {timeout:20000}, async()=>{
  await mount(async({calls,succeed})=>{
    assert.ok(Boolean(row('수학')));
    assert.ok(Boolean(document.querySelector('#add-bottom')));
    await rename('수학','수학 변경');
    assert.ok(Boolean(row('수학 변경')));
    await click(document.querySelector('#save-all'));
    assert.ok(Boolean(document.querySelector('a[href="/api/auth/github"]')));
    assert.equal(document.querySelector('.publish-status [role="status"]')?.textContent,'저장 실패','a rejected save must stop displaying validation');
    const first=calls.find(call=>call.url==='/api/content');
    const payload=JSON.parse(first.body);
    assert.equal(payload.baseCommit,source.contentCommit);
    assert.equal((payload.operations?.[0]??payload.operation).baseRevision,source.revision);
    const leaf=payload.operations[0].categories.find(category=>category.id==='leaf');
    assert.equal(leaf.name,'수학 변경');
    assert.equal(leaf.parent_id,'group:cs');
    assert.deepEqual(leaf.sources,['Math']);
    assert.deepEqual(leaf.opaque,{original:7});
    const persisted = JSON.parse(localStorage.getItem('second-brain:canonical-categories'));
    const outbox=JSON.parse(localStorage.getItem('test-sync:owner:content:main'));
    assert.equal(outbox.active.payload.requestId,payload.requestId);
    assert.equal(outbox.active.items[0].clientRequestId,persisted.requestId);
    assert.equal(JSON.stringify(outbox.active.payload),first.body);
    assert.equal(persisted.contentCommit,payload.baseCommit);
    assert.equal(persisted.revision,payload.operations[0].baseRevision);
    assert.equal(localStorage.getItem('second-brain:categories:v2'),'personal-settings');
    assert.equal(calls.filter(call=>call.url.startsWith('/api/content?')).length,1,'ordinary saves must reuse the loaded category source');
    succeed();
    await click(document.querySelector('#save-all'));
    assert.equal(calls.filter(call=>call.url==='/api/content')[1].body,first.body);
    assert.ok(Boolean(document.querySelector('.publish-status')));
  });
});

test('a failed category save restores reset after reopening and preserves edits until confirmed', {timeout:20000}, async()=>{
  await mount(async({calls,root})=>{
    await rename('수학','Conflict draft');
    await click(document.querySelector('#save-all'));
    assert.equal(document.querySelector('.publish-status [role="status"]')?.textContent,'저장 실패');
    assert.ok(row('Conflict draft') !== undefined,'a conflict must preserve the edited category');
    assert.equal(document.querySelector('#save-all').disabled,false);
    await act(async()=>root.render(React.createElement(ManagedCategories,{key:'failed-recovery',session:ready,categories:[]})));
    assert.equal(document.querySelector('.publish-status [role="status"]')?.textContent,'저장 실패');
    assert.ok(document.querySelector('[role="alert"]') === null,'reopening has no transient failure alert');
    const reset=[...document.querySelectorAll('button')].find(button=>button.textContent==='최신 원본으로 다시 시작');
    assert.ok(reset !== undefined,'a restored failed save must keep the existing reset action available');
    const bytes=localStorage.getItem('second-brain:canonical-categories');
    const previousConfirm=dom.window.confirm;
    let confirmations=0;
    try {
      dom.window.confirm=()=>{confirmations++;return false;};
      await click(reset);
      assert.equal(confirmations,1);
      assert.equal(localStorage.getItem('second-brain:canonical-categories'),bytes,'cancelling reset must preserve the exact category draft');
      assert.ok(row('Conflict draft') !== undefined);
      assert.equal(calls.filter(call=>call.url.includes('refresh=1')).length,0);
      dom.window.confirm=()=>{confirmations++;return true;};
      await click(reset);
      assert.equal(confirmations,2);
      assert.ok(row('수학') !== undefined,'confirming reset must restore the canonical category');
      assert.equal(document.querySelector('#save-all').disabled,true);
      assert.equal(calls.filter(call=>call.url==='/api/content?kind=categories&refresh=1').length,1);
      assert.equal(calls.filter(call=>call.url==='/api/content').length,1,'reset cannot submit the rejected draft again');
      assert.ok(JSON.parse(localStorage.getItem('test-sync:owner:content:main')).active === null,'reset must release the rejected category batch');
    } finally {
      dom.window.confirm=previousConfirm;
    }
  },ready,[],409);
});

test('a confirmed category save adopts canonical aliases and remains clean after reopening', {timeout:20000}, async()=>{
  await mount(async({calls,succeed,root})=>{
    await click(document.querySelector('#add-bottom'));
    const field=document.querySelector('#inline-name');
    await act(async()=>{
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,'Added category');
      field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
    });
    await act(async()=>document.querySelector('#inline-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
    succeed();
    await click(document.querySelector('#save-all'));
    const payload=JSON.parse(calls.find(call=>call.url==='/api/content').body);
    const added=payload.operations[0].categories.find(category=>category.name==='Added category');
    assert.deepEqual(added.sources,[],'the server assigns a canonical alias to a new category');
    assert.equal(document.querySelector('.publish-status [role="status"]')?.textContent,'원본 저장 완료');
    assert.equal(document.querySelector('#save-all').disabled,true,'the confirmed canonical source must clear the dirty state');
    assert.equal(row('Added category').querySelector('[data-action="delete"]').disabled,false);
    const saved=JSON.parse(localStorage.getItem('second-brain:canonical-categories'));
    assert.deepEqual(saved.categories.find(category=>category.id===added.id).sources,[added.id]);
    await act(async()=>root.render(React.createElement(ManagedCategories,{key:'reopened',session:ready,categories:[]})));
    assert.equal(document.querySelector('#save-all').disabled,true,'reopening must restore the normalized confirmed draft');
    assert.equal(row('Added category').querySelector('[data-action="delete"]').disabled,false);
    assert.equal(calls.filter(call=>call.url.startsWith('/api/content?')).length,1,'the save receipt must avoid another category fetch');
  });
});

test('an older category confirmation preserves edits made while the save is pending', {timeout:20000}, async()=>{
  await mount(async({succeed})=>{
    succeed();
    const previousFetch=globalThis.fetch;
    let release;
    globalThis.fetch=async(url,options)=>{
      if(url==='/api/content') await new Promise(resolve=>{release=resolve;});
      return previousFetch(url,options);
    };
    try {
      await rename('수학','Saved name');
      await click(document.querySelector('#save-all'));
      assert.equal(typeof release,'function','the category write must be waiting for confirmation');
      await rename('Saved name','Later name');
      await act(async()=>{
        release();
        await new Promise(resolve=>setTimeout(resolve,100));
      });
      assert.ok(row('Later name') !== undefined,'a receipt for an older request cannot replace later category edits');
      assert.equal(document.querySelector('#save-all').disabled,false);
      const saved=JSON.parse(localStorage.getItem('second-brain:canonical-categories'));
      assert.equal(saved.categories.find(category=>category.id==='leaf').name,'Later name');
      assert.equal(saved.revision,'f'.repeat(64));
      assert.equal(saved.contentCommit,'c'.repeat(40));
    } finally {
      release?.();
      globalThis.fetch=previousFetch;
    }
  });
});

test('a category confirmation received after navigation restores a clean canonical draft', {timeout:20000}, async()=>{
  await mount(async({calls,succeed,root})=>{
    succeed();
    const previousFetch=globalThis.fetch;
    let release;
    globalThis.fetch=async(url,options)=>{
      if(url==='/api/content') await new Promise(resolve=>{release=resolve;});
      return previousFetch(url,options);
    };
    try {
      await click(document.querySelector('#add-bottom'));
      const field=document.querySelector('#inline-name');
      await act(async()=>{
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,'Navigation category');
        field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
      });
      await act(async()=>document.querySelector('#inline-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));
      await click(document.querySelector('#save-all'));
      assert.equal(typeof release,'function','the category write must remain pending before navigation');
      await act(async()=>root.render(React.createElement('main',null,'Other screen')));
      await act(async()=>{
        release();
        await new Promise(resolve=>setTimeout(resolve,100));
      });
      await act(async()=>root.render(React.createElement(ManagedCategories,{key:'reopened-after-navigation',session:ready,categories:[]})));
      assert.equal(document.querySelector('#save-all').disabled,true,'a background confirmation must restore a clean category draft');
      assert.equal(row('Navigation category').querySelector('[data-action="delete"]').disabled,false);
      const saved=JSON.parse(localStorage.getItem('second-brain:canonical-categories'));
      const added=saved.categories.find(category=>category.name==='Navigation category');
      assert.deepEqual(added.sources,[added.id]);
      assert.equal(calls.filter(call=>call.url.startsWith('/api/content?')).length,1,'navigation must reuse the confirmed source without another fetch');
    } finally {
      release?.();
      globalThis.fetch=previousFetch;
    }
  });
});

test('canonical deletion confirms then saves the original immediately, preserving protected records', {timeout:20000}, async()=>{
  await mount(async({calls,succeed})=>{
    assert.equal(row('CS').querySelector('[data-action="delete"]').disabled,true);
    assert.equal(row('수학').querySelector('[data-action="delete"]').disabled,false);
    assert.equal(row('미분류').querySelector('[data-action="delete"]').disabled,true);
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    assert.match(document.querySelector('#delete-dialog').textContent,/원본/);
    await click([...document.querySelectorAll('#delete-dialog button')].find(button=>button.textContent==='취소'));
    assert.equal(calls.filter(call=>call.url==='/api/content').length,0);
    assert.ok(row('빈 분류') !== undefined);
    succeed();
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    await click(document.querySelector('#confirm-delete'));
    const saves=calls.filter(call=>call.url==='/api/content');
    assert.equal(saves.length,1,'modal confirmation persists canonical deletion');
    const payload=JSON.parse(saves[0].body);
    assert.equal(payload.operation.type,'category.delete');
    assert.equal(payload.operation.id,'free');
    assert.equal(payload.operation.mode,'move');
    assert.equal((payload.operations?.[0]??payload.operation).baseRevision,source.revision);
    assert.equal(payload.baseCommit,source.contentCommit);
    assert.ok(row('빈 분류') === undefined);
  },ready,[{id:'post',categoryId:'leaf',category:'Math'}]);
});

test('failed category deletion retains the row and retries the same request', {timeout:20000}, async()=>{
  await mount(async({calls,succeed,root})=>{
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    await click(document.querySelector('#confirm-delete'));
    assert.ok(row('빈 분류') !== undefined);
    assert.equal(document.querySelector('#delete-dialog').open,true);
    const first=calls.find(call=>call.url==='/api/content').body;
    await act(async()=>root.render(React.createElement(ManagedCategories,{key:'reopened',session:ready,categories:[]})));
    assert.ok(row('빈 분류') !== undefined,'a failed deletion cannot hide the original after reopening');
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    succeed();
    await click(document.querySelector('#confirm-delete'));
    assert.equal(calls.filter(call=>call.url==='/api/content')[1].body,first);
    assert.ok(row('빈 분류') === undefined);
  });
});

test('saving another category after deletion uses the confirmed source revision without restoring the deleted row', {timeout:20000}, async()=>{
  await mount(async({calls,succeed})=>{
    succeed();
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    await click(document.querySelector('#confirm-delete'));
    assert.equal(document.querySelector('.publish-status [role="status"]')?.textContent,'원본 저장 완료','source acceptance must remain distinct from public publication');
    await rename('수학','수학 변경');
    await click(document.querySelector('#save-all'));
    const payload=JSON.parse(calls.filter(call=>call.url==='/api/content')[1].body);
    assert.equal(payload.baseCommit,'c'.repeat(40),'the next save must use the post-deletion commit');
    assert.equal(payload.operations[0].baseRevision,'d'.repeat(64),'the next save must use the post-deletion categories revision');
    assert.ok(!payload.operations[0].categories.some(category=>category.id==='free'),'the next save must keep the deleted category absent');
    assert.deepEqual(calls.filter(call=>call.url.startsWith('/api/content?')).map(call=>call.url),[
      '/api/content?kind=categories',
      '/api/content?kind=categories&refresh=1',
    ],'a confirmed deletion needs exactly one source refresh, and the next save needs none');
  });
});

test('a failed category refresh preserves the exact completed deletion request for retry', {timeout:20000}, async()=>{
  await mount(async({calls,succeed})=>{
    succeed();
    const previousFetch=globalThis.fetch;
    let offline=true;
    globalThis.fetch=async(url,options)=>{
      if(url==='/api/content?kind=categories&refresh=1' && offline) throw new Error('refresh offline');
      return previousFetch(url,options);
    };
    try {
      await click(row('빈 분류').querySelector('[data-action="delete"]'));
      await click(document.querySelector('#confirm-delete'));
      assert.ok(row('빈 분류') !== undefined,'the unresolved source baseline must keep the row recoverable');
      assert.match(document.querySelector('[role="alert"]').textContent,/refresh offline/);
      const key='second-brain:category-deletion:free:move';
      const first=localStorage.getItem(key);
      assert.ok(typeof first === 'string','the completed remote write must retain its retry identity');
      offline=false;
      await click(document.querySelector('#confirm-delete'));
      const writes=calls.filter(call=>call.url==='/api/content');
      assert.equal(writes.length,2);
      assert.equal(writes[1].body,first,'refresh failure must retry the same completed remote write');
      assert.ok(row('빈 분류') === undefined);
      assert.equal(localStorage.getItem(key),null);
      const saved=JSON.parse(localStorage.getItem('second-brain:canonical-categories'));
      assert.equal(saved.revision,'d'.repeat(64));
      assert.equal(saved.contentCommit,'c'.repeat(40));
    } finally {
      globalThis.fetch=previousFetch;
    }
  });
});

test('signed out management renders nothing and never requests canonical content', {timeout:20000}, async()=>{
  await mount(async({calls})=>{
    assert.ok(document.querySelector('main') === null, 'signed out management must render no main element');
    assert.equal(calls.length,0);
  },{state:'signed_out'});
});

test('existing keyboard tree movement serializes canonical parent and sibling order', {timeout:20000}, async()=>{
  await mount(async({calls,succeed})=>{
    const grip = row('빈 분류').querySelector('.grip');
    await act(async()=>grip.dispatchEvent(new dom.window.KeyboardEvent('keydown',{
      key:'ArrowRight',bubbles:true,cancelable:true,
    })));
    succeed();
    await click(document.querySelector('#save-all'));
    const payload = JSON.parse(calls.find(call=>call.url==='/api/content').body);
    const moved = payload.operations[0].categories.find(category=>category.id==='free');
    assert.equal(moved.parent_id,'group:cs');
    assert.equal(moved.order,1);
    assert.deepEqual(moved.sources,['free-source']);
    const leaf = payload.operations[0].categories.find(category=>category.id==='leaf');
    assert.equal(leaf.order,0);
    assert.deepEqual(leaf.opaque,{original:7});
  });
});

test('malformed saved canonical records keep their bytes and fall back to safe source nodes', {timeout:20000}, async()=>{
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

test('canonical counts include stable category IDs and aliases once without changing sources', {timeout:20000}, async()=>{
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

test('local drafts neither count nor block deletion of canonical categories', {timeout:20000}, async()=>{
  await mount(async({succeed})=>{
    succeed();
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


test('a rejected category deletion releases its request so a refreshed source can be retried', {timeout:20000}, async()=>{
  await mount(async({calls,succeed})=>{
    await click(row('빈 분류').querySelector('[data-action="delete"]'));
    await click(document.querySelector('#confirm-delete'));
    assert.equal(localStorage.getItem('second-brain:category-deletion:free:move'),null);
    succeed();
    await click(document.querySelector('#confirm-delete'));
    const payloads=calls.filter(call=>call.url==='/api/content').map(call=>JSON.parse(call.body));
    assert.equal(payloads.length,2);
    assert.notEqual(payloads[0].requestId,payloads[1].requestId);
    assert.ok(row('빈 분류') === undefined);
  },ready,[],409);
});


for (const mode of ['move','delete']) {
  test('assigned category deletion selects '+mode+' then requires a separate final confirmation', {timeout:20000}, async()=>{
    await mount(async({calls,succeed})=>{
      localStorage.setItem('second-brain:canonical-draft:draft-alias',JSON.stringify({sourceDocument:{document:{metadata:{id:'post'}}}}));
      const trigger=row('수학').querySelector('[data-action="delete"]');
      assert.equal(trigger.disabled,false);
      await click(trigger);
      assert.ok(document.querySelector('input[value="move"]') !== null);
      assert.ok(document.querySelector('input[value="delete"]') !== null);
      assert.ok(document.querySelector('#confirm-delete') === null,'choosing a mode cannot immediately delete');
      await click(document.querySelector('input[value="'+mode+'"]'));
      document.querySelector('#category-delete-next').focus();
      await click(document.querySelector('#category-delete-next'));
      assert.ok(document.activeElement === document.querySelector('#delete-dialog .modal-footer button'),'advancing must focus cancellation rather than deletion');
      assert.equal(calls.filter(call=>call.url==='/api/content').length,0);
      assert.match(document.querySelector('#delete-dialog').textContent,mode==='move'?/미분류/:/첨부/);
      succeed();
      await click(document.querySelector('#confirm-delete'));
      const payload=JSON.parse(calls.find(call=>call.url==='/api/content').body);
      assert.equal(payload.operation.type,'category.delete');
      assert.equal(payload.operation.id,'leaf');
      assert.equal(payload.operation.mode,mode);
      assert.equal(localStorage.getItem('second-brain:canonical-draft:draft-alias')===null,mode==='delete');
      assert.ok(!document.querySelector('.save-bar').textContent.includes('저장하지 않은'),'confirmed deletion must report saved state');
    },ready,[{id:'post',categoryId:'leaf',category:'Math'}]);
  });
}
