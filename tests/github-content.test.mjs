import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleContentRequest } from '../server/content.mjs';
import { serializeMarkdownDocument, parseMarkdownDocument } from '../src/shared/document.mjs';
const id = '12345678-1234-1234-1234-123456789abc';
const requestId = 'abcdefab-1234-1234-1234-123456789abc';
const sha = value => createHash('sha1').update(value).digest('hex');
const revision = value => createHash('sha256').update(value).digest('hex');
const document = { metadata: {
        schema_version: 1, id, title: 'Old', parent_id: null, created: '2026-01-01', updated: '2026-01-01', opaque: { value: 7 }
    }, markdown: '\r\n# Untouched\r\n![image](image.png)\r\n' };
const raw = serializeMarkdownDocument(document);
function setup(options = {}) {
    const blobs = new Map();
    const put = value => {
        const key = sha(value);
        blobs.set(key, Buffer.from(value));
        return key;
    };
    const base = 'a'.repeat(40);
    const entries = [{
            path: `posts/${id}/Old.md`, type: 'blob', mode: '100644', sha: put(raw)
        }, {
            path: `posts/${id}/image.png`, type: 'blob', mode: '100644', sha: put('image'), size: 5
        }, {
            path: 'categories.json', type: 'blob', mode: '100644', sha: put(JSON.stringify(options.categories ?? [{
                    id: 'group:unclassified', name: 'Other', parent_id: null, order: 0, sources: ['Other'], opaque: true
                }]))
        }];
    const commits = new Map([[base, {
                sha: base, tree: { sha: 'b'.repeat(40) }, parents: []
            }]]);
    const refs = new Map([['heads/main', base]]);
    const trees = new Map([['b'.repeat(40), entries]]);
    const runs = [];
    const calls = [];
    const controls = {};
    const fetcher = async (url, options = {}) => {
        const path = new URL(url).pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
        const body = options.body ? JSON.parse(options.body) : undefined;
        const method = options.method || 'GET';
        calls.push({
            path, method, body
        });
        let result;
        if (path.startsWith('/git/ref/')) {
            const key = path.slice(9);
            if (!refs.has(key))
                return Response.json({ message: 'Not Found' }, { status: 404 });
            result = { object: { sha: refs.get(key) } };
        }
        else if (path === '/git/refs') {
            if (refs.has(body.ref.slice(5)))
                return Response.json({ message: 'Exists' }, { status: 422 });
            refs.set(body.ref.slice(5), body.sha);
            result = { object: { sha: body.sha } };
        }
        else if (path.startsWith('/git/commits/'))
            result = commits.get(path.split('/').at(-1));
        else if (path === '/git/commits') {
            const key = sha(JSON.stringify(body));
            result = {
                ...body, sha: key, tree: { sha: body.tree }, parents: body.parents.map(sha => ({ sha }))
            };
            commits.set(key, result);
        }
        else if (path.startsWith('/git/trees/'))
            result = { tree: trees.get(path.split('/').at(-1)), truncated: false };
        else if (path === '/git/trees') {
            const key = sha(JSON.stringify(body));
            trees.set(key, body.tree);
            result = { sha: key };
        }
        else if (path.startsWith('/git/blobs/')) {
            const bytes = blobs.get(path.split('/').at(-1));
            result = {
                content: bytes.toString('base64'), encoding: 'base64', size: bytes.length
            };
        }
        else if (path === '/git/blobs') {
            result = { sha: put(Buffer.from(body.content, body.encoding === 'base64' ? 'base64' : 'utf8')) };
        }
        else if (path.endsWith('/dispatches')) {
            result = { workflow_run_id: 17, html_url: 'https://github.com/run/17' };
            runs.push({
                id: 17, name: `cms:${body.inputs.request_id}:${body.inputs.candidate_sha}`, display_title: `cms:${body.inputs.request_id}:${body.inputs.candidate_sha}`, status: 'queued', html_url: 'https://github.com/run/17'
            });
        }
        else if (path.endsWith('/runs'))
            result = { workflow_runs: runs };
        else if (path === '/actions/runs/17')
            result = runs[0];
        else if (/^\/actions\/runs\/17\/(?:attempts\/\d+\/)?jobs$/.test(path))
            result = {jobs:[{steps:controls.steps ?? [{name:'Deploy preview',conclusion:'success'}]}]};
        else if (path.startsWith('/compare/'))
            result = { status: controls.compareStatus ?? 'diverged' };
        else
            throw Error('Unexpected ' + method + ' ' + path);
        if (controls.dropDispatchResponse && path.endsWith('/dispatches')) {
            controls.dropDispatchResponse = false;
            throw Error('Response lost');
        }
        return Response.json(result);
    };
    const config = {
        app: {
            owner: 'owner', repo: 'app', branch: 'main'
        }, content: {
            owner: 'owner', repo: 'content', branch: 'main'
        }, workflow: 'publish-content.yml'
    };
    const call = async (path, body) => {
        const response = await handleContentRequest(new Request('https://site.test/api/' + path, body ? { method: 'POST', body: JSON.stringify(body) } : {}), {
            token: 'token', config, fetcher
        });
        return { status: response.status, cacheControl: response.headers.get('cache-control'), ...await response.json() };
    };
    return {
        call, refs, blobs, commits, trees, calls, base, runs, controls
    };
}
test('reads canonical original, preserving exact markdown and revision', async () => {
    const f = setup();
    const result = await f.call('content?kind=post&id=' + id);
    assert.equal(result.status, 200);
    assert.equal(result.cacheControl, 'no-store');
    assert.equal(result.document.markdown, document.markdown);
    assert.equal(result.revision, revision(raw));
    assert.equal(result.assets[0].name, 'image.png');
});
test('authenticated content errors also disable response caching', async () => {
    const result = await setup().call('content?kind=invalid');
    assert.equal(result.status, 400);
    assert.equal(result.cacheControl, 'no-store');
});
test('title candidate preserves body and opaque metadata, attachments and main; retry is idempotent', async () => {
    const f = setup();
    const payload = {
        requestId, baseCommit: f.base, operation: {
            type: 'post.update', id, baseRevision: revision(raw), changes: { title: 'New' }
        }
    };
    const result = await f.call('content', payload);
    assert.equal(result.status, 200);
    assert.equal(f.refs.get('heads/main'), f.base);
    const commit = f.commits.get(result.candidateCommit);
    const tree = f.trees.get(commit.tree.sha);
    const md = tree.find(e => e.path.endsWith('/New.md'));
    assert.ok(md);
    const parsed = parseMarkdownDocument(f.blobs.get(md.sha).toString());
    assert.equal(parsed.markdown, document.markdown);
    assert.deepEqual(parsed.metadata.opaque, { value: 7 });
    assert.ok(!tree.some(e => e.path.endsWith('/Old.md') && e.sha));
    assert.ok(!tree.some(e => e.path.endsWith('/image.png') && e.sha === null));
    assert.equal((await f.call('content', payload)).candidateCommit, result.candidateCommit);
    assert.equal((await f.call('content', { ...payload, operation: { ...payload.operation, changes: { title: 'Different' } } })).status, 409);
});
test('stale revisions and path escaping IDs fail before candidate creation', async () => {
    const f = setup();
    for (const operation of [{
            type: 'post.update', id, baseRevision: '0'.repeat(64), changes: { title: 'New' }
        }, {
            type: 'post.delete', id: '../escape', baseRevision: revision(raw)
        }]) {
        assert.ok((await f.call('content', {
            requestId, baseCommit: f.base, operation
        })).status >= 400);
    }
    assert.equal(f.refs.size, 1);
});
test('uploads validate strict base64, size, SHA and join chunk bytes', async () => {
    const f = setup();
    assert.equal((await f.call('assets', { content: '%%%%' })).status, 400);
    assert.equal((await f.call('assets', { content: 'AB==' })).status, 400);
    assert.equal((await f.call('assets', { chunks: ['../bad'] })).status, 400);
    const a = await f.call('assets', { content: Buffer.from('hello').toString('base64') });
    const b = await f.call('assets', { content: Buffer.from('world').toString('base64') });
    const combined = await f.call('assets', { chunks: [a.sha, b.sha] });
    assert.equal(combined.size, 10);
    assert.equal(f.blobs.get(combined.sha).toString(), 'helloworld');
});
test('category update preserves sources and opaque fields and rejects unclassified deletion', async () => {
    const f = setup();
    const current = await f.call('content?kind=categories');
    const payload = {
        requestId, baseCommit: f.base, operation: {
            type: 'categories.save', baseRevision: current.revision, categories: [{
                    id: 'group:unclassified', name: 'Renamed', parent_id: null, order: 0
                }]
        }
    };
    const result = await f.call('content', payload);
    assert.equal(result.status, 200);
    const tree = f.trees.get(f.commits.get(result.candidateCommit).tree.sha);
    const categories = JSON.parse(f.blobs.get(tree.find(e => e.path === 'categories.json').sha));
    assert.deepEqual(categories[0].sources, ['Other']);
    assert.equal(categories[0].opaque, true);
    const g = setup();
    assert.equal((await g.call('content', { ...payload, operation: { ...payload.operation, categories: [] } })).status, 422);
});
test('candidate alone is validating; forged run IDs rejected', async () => {
    const f = setup();
    const created = await f.call('content', {
        requestId, baseCommit: f.base, operation: {
            type: 'post.delete', id, baseRevision: revision(raw)
        }
    });
    const result = await f.call(`publish?requestId=${requestId}&candidateCommit=${created.candidateCommit}&runId=17`);
    assert.equal(result.state, 'validating');
    f.runs[0].display_title = 'another request';
    assert.equal((await f.call(`publish?requestId=${requestId}&candidateCommit=${created.candidateCommit}&runId=17`)).status, 409);
});
test('new documents enforce canonical ID and preserve asset data', async () => {
    const f = setup();
    const freshId = '98765432-1234-1234-1234-123456789abc';
    const asset = await f.call('assets', { content: Buffer.from('new image').toString('base64') });
    const result = await f.call('content', {
        requestId, baseCommit: f.base, operation: {
            type: 'post.create', document: { ...document, metadata: { ...document.metadata, id: freshId } }, assets: [{ name: 'new.png', ...asset }]
        }
    });
    assert.equal(result.status, 200);
    const tree = f.trees.get(f.commits.get(result.candidateCommit).tree.sha);
    assert.ok(tree.some(e => e.path === `posts/${freshId}/new.png`));
});
test('5 MiB total chunk ceiling and complete wire ceiling are enforced', async () => {
    const f = setup();
    const chunk = await f.call('assets', { content: Buffer.alloc(2 * 1024 * 1024).toString('base64') });
    assert.equal(chunk.status, 200);
    assert.equal((await f.call('assets', { chunks: [chunk.sha, chunk.sha, chunk.sha] })).status, 413);
    assert.equal((await f.call('assets', { content: 'A'.repeat(4 * 1024 * 1024) })).status, 413);
});
test('no-op updates never create candidate commits', async () => {
    const f = setup();
    const result = await f.call('content', {
        requestId, baseCommit: f.base, operation: {
            type: 'post.update', id, baseRevision: revision(raw), changes: { title: 'Old' }
        }
    });
    assert.equal(result.status, 200);
    assert.equal(result.state, 'unchanged');
    assert.equal(f.refs.size, 1);
});
test('run completion alone cannot claim canonical save', async () => {
    const f = setup();
    const created = await f.call('content', {
        requestId, baseCommit: f.base, operation: {
            type: 'post.delete', id, baseRevision: revision(raw)
        }
    });
    f.runs[0].status = 'completed';
    f.runs[0].conclusion = 'success';
    assert.equal((await f.call(`publish?requestId=${requestId}&candidateCommit=${created.candidateCommit}&runId=17`)).state, 'failed');
    f.refs.set('heads/main', created.candidateCommit);
    assert.equal((await f.call(`publish?requestId=${requestId}&candidateCommit=${created.candidateCommit}&runId=17`)).state, 'published');
    f.runs[0].conclusion = 'failure';
    assert.equal((await f.call(`publish?requestId=${requestId}&candidateCommit=${created.candidateCommit}&runId=17`)).state, 'pending');
});
test('resume dispatches a fresh run after a completed failed attempt', async () => {
    const f = setup();
    const created = await f.call('content', {requestId,baseCommit:f.base,operation:{type:'post.delete',id,baseRevision:revision(raw)}});
    f.runs[0].status = 'completed';
    f.runs[0].conclusion = 'failure';
    await f.call('publish', {requestId,candidateCommit:created.candidateCommit});
    assert.equal(f.calls.filter(call => call.path.endsWith('/dispatches')).length, 2);
    assert.equal(f.commits.size,2);
});
test('lost dispatch response recovers exact run without duplicate candidate or workflow', async () => {
    const f = setup();
    f.controls.dropDispatchResponse = true;
    const created = await f.call('content', {requestId,baseCommit:f.base,operation:{type:'post.delete',id,baseRevision:revision(raw)}});
    assert.equal(created.status,200);
    assert.equal(created.runId,17);
    assert.equal(f.calls.filter(call => call.path.endsWith('/dispatches')).length,1);
    assert.equal(f.commits.size,2);
});
test('document schema failures return actionable 422 while malformed transport stays 400', async () => {
    for (const metadata of [
        {schema_version:2},
        {kind:'unsupported'},
        {order:-1},
        {created:'yesterday'},
        {review_status:'done'},
    ]) {
        const f = setup();
        const result = await f.call('content', {
            requestId,
            baseCommit:f.base,
            operation:{type:'post.create',document:{metadata:{...document.metadata,id:'98765432-1234-1234-1234-123456789abc',...metadata},markdown:''}},
        });
        assert.equal(result.status,422);
        assert.equal(typeof result.error,'string');
        assert.equal(f.refs.size,1);
    }
    const f = setup();
    const malformedCategory = await f.call('content', {
        requestId,
        baseCommit:f.base,
        operation:{type:'categories.save',baseRevision:(await f.call('content?kind=categories')).revision,categories:[{id:'group:unclassified',name:'Other',parent_id:null,order:-1}]},
    });
    assert.equal(malformedCategory.status,422);
    const malformedUpdate = await f.call('content', {
        requestId,
        baseCommit:f.base,
        operation:{type:'post.update',id,baseRevision:revision(raw),changes:{title:123}},
    });
    assert.equal(malformedUpdate.status,422);
    assert.equal((await f.call('content?kind=post&id=../bad')).status,400);
    const malformedJson = await handleContentRequest(new Request('https://site.test/api/content',{method:'POST',body:'{' }), {token:'token',config:{content:{owner:'owner',repo:'content'},app:{owner:'owner',repo:'app'}},fetcher:()=>{throw Error('Unexpected network');}});
    assert.equal(malformedJson.status,400);
});
test('publication requires successful preview step for the exact run attempt', async () => {
    const f = setup();
    const created = await f.call('content', {
        requestId,
        baseCommit:f.base,
        operation:{type:'post.delete',id,baseRevision:revision(raw)},
    });
    f.refs.set('heads/main',created.candidateCommit);
    f.runs[0].status = 'completed';
    f.runs[0].conclusion = 'success';
    f.runs[0].run_attempt = 2;
    const statusPath = `publish?requestId=${requestId}&candidateCommit=${created.candidateCommit}&runId=17`;
    f.controls.steps = [{name:'Deploy preview',conclusion:'skipped'}];
    assert.equal((await f.call(statusPath)).state,'pending');
    f.controls.steps = [];
    assert.equal((await f.call(statusPath)).state,'pending');
    f.controls.steps = [{name:'Deploy preview',conclusion:'failure'}];
    assert.equal((await f.call(statusPath)).state,'pending');
    f.controls.steps = [{name:'Deploy preview',conclusion:'success'}];
    assert.equal((await f.call(statusPath)).state,'published');
    assert.ok(f.calls.some(call => call.path === '/actions/runs/17/attempts/2/jobs'));
    f.refs.set('heads/main','c'.repeat(40));
    f.controls.compareStatus = 'ahead';
    f.controls.steps = [{name:'Deploy preview',conclusion:'skipped'}];
    assert.equal((await f.call(statusPath)).state,'superseded');
});
test('create and update reject malformed asset records before side effects', async () => {
    for (const type of ['post.create','post.update']) {
        for (const asset of [null, [], 'invalid', 42]) {
            const f = setup();
            const operation = {
                type,
                id,
                baseRevision:revision(raw),
                changes:{title:'Changed'},
                document:{...document,metadata:{...document.metadata,id:'98765432-1234-1234-1234-123456789abc'}},
                assets:[asset],
            };
            const response = await f.call('content',{requestId,baseCommit:f.base,operation});
            assert.equal(response.status,400);
            assert.equal(f.refs.size,1);
            assert.equal(f.refs.get('heads/main'),f.base);
            assert.equal(f.calls.filter(call => call.method === 'POST').length,0);
        }
    }
});
test('canonical parent_id category CRUD preserves real source records and opaque metadata', async () => {
    const sourceCategories = JSON.parse(readFileSync(new URL('../content/categories.json',import.meta.url),'utf8'));
    const categories = sourceCategories.filter(category => ['group:unclassified','group:cs','source:수학'].includes(category.id));
    assert.equal(categories.length,3);
    categories.find(category => category.id === 'source:수학').opaque = {original:true};
    const f = setup({categories});
    const originalLeaf = structuredClone(categories.find(category => category.id === 'source:수학'));
    let sequence = 0;
    const save = async categories => {
        const current = await f.call('content?kind=categories');
        const result = await f.call('content', {
            requestId:`abcdefab-1234-1234-1234-${String(++sequence).padStart(12,'0')}`,
            baseCommit:current.contentCommit,
            operation:{type:'categories.save',baseRevision:current.revision,categories},
        });
        assert.equal(result.status,200);
        f.refs.set('heads/main',result.candidateCommit);
        return (await f.call('content?kind=categories')).categories;
    };
    let saved = await save([...categories,{id:'group:new',name:'New',parent_id:null,order:2}]);
    assert.equal(saved.find(category => category.id === 'group:new').parent_id,null);
    saved = await save(saved.map(category => category.id === originalLeaf.id ? {...category,name:'Moved math',parent_id:'group:new',order:1} : category));
    const moved = saved.find(category => category.id === originalLeaf.id);
    assert.equal(moved.parent_id,'group:new');
    assert.deepEqual(moved.sources,originalLeaf.sources);
    assert.deepEqual(moved.opaque,originalLeaf.opaque);
    assert.ok(saved.every(category => !Object.hasOwn(category,'parentId')));
    saved = await save(saved.filter(category => category.id !== originalLeaf.id));
    saved = await save(saved.filter(category => category.id !== 'group:new'));
    assert.deepEqual(saved.map(category => category.id).sort(),['group:cs','group:unclassified']);
});
test('a divergent candidate that never reached canonical is failed, not superseded', async () => {
    const f = setup();
    const created = await f.call('content', {
        requestId,
        baseCommit:f.base,
        operation:{type:'post.delete',id,baseRevision:revision(raw)},
    });
    f.refs.set('heads/main','d'.repeat(40));
    f.controls.compareStatus = 'diverged';
    f.runs[0].status = 'completed';
    f.runs[0].conclusion = 'failure';
    const result = await f.call(`publish?requestId=${requestId}&candidateCommit=${created.candidateCommit}&runId=17`);
    assert.equal(result.state,'failed');
    assert.equal(result.contentCommit,undefined);
    assert.match(result.error,/conflict/i);
    assert.equal(f.calls.filter(call => call.path.includes('/jobs')).length,0);
});
