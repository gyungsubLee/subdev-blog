import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleContentRequest } from '../server/content.mjs';
import { handlePublicRequest } from '../server/public-content.mjs';
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
        const bytes = Buffer.from(value);
        const key = sha(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]));
        blobs.set(key, bytes);
        return key;
    };
    const base = 'a'.repeat(40);
    const entries = [{
            path: `posts/${id}/Old.md`, type: 'blob', mode: '100644', sha: put(options.document ? serializeMarkdownDocument(options.document) : raw)
        }, {
            path: `posts/${id}/image.png`, type: 'blob', mode: '100644', sha: put('image'), size: 5
        }, {
            path: 'categories.json', type: 'blob', mode: '100644', sha: put(JSON.stringify(options.categories ?? [{
                    id: 'group:unclassified', name: 'Other', parent_id: null, order: 0, sources: ['Other'], opaque: true
                }]))
        }];
    for (const item of options.documents ?? []) {
        entries.push({path:`posts/${item.metadata.id}/${item.metadata.title}.md`,type:'blob',mode:'100644',sha:put(serializeMarkdownDocument(item))});
    }
    const commits = new Map([[base, {
                sha: base, tree: { sha: 'b'.repeat(40) }, parents: []
            }]]);
    const refs = new Map([['heads/main', base]]);
    const trees = new Map([['b'.repeat(40), entries]]);
    const calls = [];
    const controls = {};
    const fetcher = async (url, options = {}) => {
        const parsedUrl = new URL(url);
        const repository = parsedUrl.pathname.match(/^\/repos\/[^/]+\/[^/]+/)?.[0];
        const path = parsedUrl.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
        const body = options.body ? JSON.parse(options.body) : undefined;
        const method = options.method || 'GET';
        calls.push({
            path, method, body, repository, host:parsedUrl.host
        });
        if (parsedUrl.host === 'raw.githubusercontent.com') {
            const [, , , commit, ...parts] = parsedUrl.pathname.split('/');
            const filename = parts.map(decodeURIComponent).join('/');
            const record = commits.get(commit);
            const entry = trees.get(record?.tree.sha)?.find(entry => entry.path === filename);
            return entry ? new Response(blobs.get(entry.sha)) : new Response('Not found', {status:404});
        }
        let result;
        if (path === '') result = {private:false,full_name:'gyungsubLee/subdev-blog-content'};
        else if (path.startsWith('/git/ref/')) {
            const key = path.slice(9);
            if (!refs.has(key))
                return Response.json({ message: 'Not Found' }, { status: 404 });
            result = {ref:'refs/' + key,object:{type:'commit',sha:refs.get(key)}};
        }
        else if (path === '/git/refs/heads/main' && method === 'PATCH') {
            assert.equal(body.force, false);
            if (controls.raceHead) refs.set('heads/main', controls.raceHead);
            if (controls.rejectPatch) return Response.json({message:'Rejected'}, {status:422});
            const parent = commits.get(body.sha)?.parents[0]?.sha;
            if (parent !== refs.get('heads/main')) return Response.json({message:'Not a fast forward'}, {status:422});
            if (!controls.ignorePatch) refs.set('heads/main', controls.refAfterPatch ?? body.sha);
            if (controls.dropPatchResponse) {
                controls.dropPatchResponse = false;
                throw Error('Response lost');
            }
            result = {object:{sha:body.sha}};
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
            result = { tree: trees.get(path.split('/').at(-1)).map(entry => ({...entry,size:blobs.get(entry.sha)?.length ?? entry.size})), truncated: false };
        else if (path === '/git/trees') {
            const key = sha(JSON.stringify(body));
            const merged = new Map((trees.get(body.base_tree) ?? []).map(entry => [entry.path, entry]));
            for (const entry of body.tree) {
                if (entry.sha === null) merged.delete(entry.path);
                else merged.set(entry.path, entry);
            }
            trees.set(key, [...merged.values()]);
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
        else if (path.startsWith('/compare/')) {
            const [ancestor, descendant] = path.slice('/compare/'.length).split('...');
            const pending = [descendant];
            const visited = new Set();
            while (pending.length) {
                const commit = pending.pop();
                if (commit === ancestor) break;
                if (visited.has(commit)) continue;
                visited.add(commit);
                pending.push(...(commits.get(commit)?.parents ?? []).map(parent => parent.sha));
            }
            const includesAncestor = ancestor === descendant || [...visited].some(commit => commits.get(commit)?.parents?.some(parent => parent.sha === ancestor));
            result = {status:controls.compareStatus ?? (ancestor === descendant ? 'identical' : includesAncestor ? 'ahead' : 'diverged')};
        }
        else throw Error('Unexpected ' + method + ' ' + path);
        return Response.json(result);
    };
    const config = {
        content: {owner: options.publicRepository ? 'gyungsubLee' : 'owner', repo: options.publicRepository ? 'subdev-blog-content' : 'content', branch: 'main'},
    };
    const call = async (path, body) => {
        const response = await handleContentRequest(new Request('https://site.test/api/' + path, body ? { method: 'POST', body: JSON.stringify(body) } : {}), {
            token: 'token', config, fetcher, catalog:controls.catalog
        });
        return { status: response.status, cacheControl: response.headers.get('cache-control'), ...await response.json() };
    };
    return {
        call, refs, blobs, commits, trees, calls, base, controls, fetcher
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
test('direct save preserves body, opaque metadata and attachments; retry is idempotent', async () => {
    const f = setup();
    const payload = {
        requestId, baseCommit: f.base, operation: {
            type: 'post.update', id, baseRevision: revision(raw), changes: { title: 'New' }
        }
    };
    const result = await f.call('content', payload);
    assert.equal(result.status, 200);
    assert.equal(result.state, 'published');
    assert.equal(result.requestId, requestId);
    assert.equal(result.baseCommit, f.base);
    assert.equal(result.contentCommit, result.candidateCommit);
    assert.equal(f.refs.get('heads/main'), result.contentCommit);
    assert.equal(result.commitUrl, `https://github.com/owner/content/commit/${result.contentCommit}`);
    assert.equal(result.runId, undefined);
    assert.equal(result.runUrl, undefined);
    assert.ok(f.calls.every(call => call.repository === '/repos/owner/content'));
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
const deletePayload = baseCommit => ({
    requestId, baseCommit, operation:{type:'post.delete',id,baseRevision:revision(raw)},
});

test('lost canonical PATCH response recovers accepted candidate without duplicate writes', async () => {
    const f = setup();
    f.controls.dropPatchResponse = true;
    const saved = await f.call('content', deletePayload(f.base));
    assert.equal(saved.status, 200);
    assert.equal(saved.state, 'published');
    assert.equal(f.refs.get('heads/main'), saved.candidateCommit);
    const retry = await f.call('content', deletePayload(f.base));
    assert.equal(retry.candidateCommit, saved.candidateCommit);
    assert.equal(f.commits.size, 2);
    assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('publish GET only reports pending status and authenticated POST alone resumes the candidate', async () => {
    const f = setup();
    f.controls.rejectPatch = true;
    const first = await f.call('content', deletePayload(f.base));
    assert.equal(first.status, 422);
    const candidateCommit = f.refs.get('heads/cms/requests/' + requestId);
    assert.equal(typeof candidateCommit, 'string');
    f.controls.rejectPatch = false;
    const mutationCount = f.calls.filter(call => call.method !== 'GET').length;
    const status = await f.call(`publish?requestId=${requestId}&candidateCommit=${candidateCommit}`);
    assert.equal(status.status, 200);
    assert.equal(status.state, 'pending');
    assert.equal(status.requestId, requestId);
    assert.equal(status.candidateCommit, candidateCommit);
    assert.equal(status.baseCommit, f.base);
    assert.equal(status.contentCommit, undefined);
    assert.equal(f.refs.get('heads/main'), f.base);
    assert.equal(f.calls.filter(call => call.method !== 'GET').length, mutationCount);
    const applied = await f.call('publish', {requestId,candidateCommit});
    assert.equal(applied.status, 200);
    assert.equal(applied.state, 'published');
    assert.equal(applied.contentCommit, candidateCommit);
    assert.equal(f.commits.size, 2);
    assert.ok(f.calls.every(call => !call.path.includes('/actions/')));
});

test('publish rejects a candidate that does not match its immutable request branch', async () => {
    const f = setup();
    const saved = await f.call('content', deletePayload(f.base));
    const result = await f.call(`publish?requestId=${requestId}&candidateCommit=${f.base}`);
    assert.equal(result.status, 409);
    assert.equal(f.refs.get('heads/main'), saved.candidateCommit);
});

test('a concurrent sibling save rejects the stale candidate without overwriting canonical', async () => {
    const f = setup();
    const sibling = 'd'.repeat(40);
    f.controls.raceHead = sibling;
    const result = await f.call('content', deletePayload(f.base));
    assert.equal(result.status, 409);
    assert.equal(result.contentCommit, undefined);
    assert.equal(f.refs.get('heads/main'), sibling);
    assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
    const candidate = f.refs.get('heads/cms/requests/' + requestId);
    const retry = await f.call('publish', {requestId,candidateCommit:candidate});
    assert.equal(retry.status, 409);
    assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});

test('canonical PATCH success is verified against HEAD before claiming saved', async () => {
    const f = setup();
    f.controls.ignorePatch = true;
    const result = await f.call('content', deletePayload(f.base));
    assert.equal(result.status, 503);
    assert.equal(result.contentCommit, undefined);
    assert.equal(f.refs.get('heads/main'), f.base);
});

test('a canonical descendant accepts a saved candidate without moving HEAD backwards', async () => {
    const f = setup();
    const saved = await f.call('content', deletePayload(f.base));
    const descendant = 'c'.repeat(40);
    f.commits.set(descendant, {sha:descendant,parents:[{sha:saved.candidateCommit}]});
    f.refs.set('heads/main', descendant);
    const result = await f.call(`publish?requestId=${requestId}&candidateCommit=${saved.candidateCommit}`);
    assert.equal(result.status, 200);
    assert.equal(result.state, 'superseded');
    assert.equal(result.candidateCommit, saved.candidateCommit);
    assert.equal(result.contentCommit, descendant);
    assert.equal(f.refs.get('heads/main'), descendant);
    assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 1);
});

const otherId = '98765432-1234-1234-1234-123456789abc';
const otherDocument = (metadata = {}, markdown = '') => ({
    metadata:{...document.metadata,id:otherId,title:'Sibling',...metadata},markdown,
});

test('post deletion rejects incoming document relations and canonical, Notion, relative and HTML links', async () => {
    const inbound = [
        otherDocument({parent_id:id}),
        otherDocument({related_ids:[id]}),
        otherDocument({source_ids:[id]}),
        otherDocument({}, `[target](#/post/${id})`),
        otherDocument({}, `[target](https://www.notion.so/Old-${id.replaceAll('-','')})`),
        otherDocument({}, `[target](../${id}/Old.md#heading)`),
        otherDocument({}, `<a href="../${id}/Old.md">target</a>`),
        otherDocument({cover:`#/post/${id}`}),
    ];
    for (const entry of inbound) {
        const f = setup({documents:[entry]});
        const result = await f.call('content', deletePayload(f.base));
        assert.equal(result.status, 409);
        assert.equal(f.refs.get('heads/main'), f.base);
        assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
    }
});

test('post deletion resolves legacy Markdown aliases and permits code examples without live references', async () => {
    const f = setup({
        document:{...document,metadata:{...document.metadata,legacy_path:'Legacy/Old.md'}},
        documents:[otherDocument({}, '[target](Legacy/Old.md)')],
    });
    const original = await f.call('content?kind=post&id=' + id);
    const result = await f.call('content', {requestId,baseCommit:f.base,operation:{type:'post.delete',id,baseRevision:original.revision}});
    assert.equal(result.status, 409);
    const safe = setup({documents:[otherDocument({}, '`[example](#/post/' + id + ')`')]});
    assert.equal((await safe.call('content', deletePayload(safe.base))).state, 'published');
});

test('category deletion rejects assigned categories and original child relationships', async () => {
    const categories = [
        {id:'group:unclassified',name:'Other',parent_id:null,order:0,sources:[]},
        {id:'group:used',name:'Used',parent_id:null,order:1,sources:[]},
        {id:'group:child',name:'Child',parent_id:'group:used',order:0,sources:[]},
    ];
    for (const documents of [[],[otherDocument({category_id:'group:used'})]]) {
        const f = setup({categories:documents.length ? categories.slice(0,2) : categories,documents});
        const current = await f.call('content?kind=categories');
        const result = await f.call('content', {requestId,baseCommit:f.base,operation:{
            type:'categories.save',baseRevision:current.revision,
            categories:current.categories.filter(category => category.id !== 'group:used').map(category => ({...category,parent_id:null})),
        }});
        assert.equal(result.status, 409);
        assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
    }
});

test('post create and category assignment reject missing references before side effects', async () => {
    const operations = [
        {type:'post.update',id,baseRevision:revision(raw),changes:{category_id:'missing'}},
        {type:'post.create',document:otherDocument({parent_id:otherId})},
        {type:'post.create',document:otherDocument({parent_id:'00000000-0000-0000-0000-000000000000'})},
        {type:'post.create',document:otherDocument({related_ids:['00000000-0000-0000-0000-000000000000']})},
        {type:'post.create',document:otherDocument({category_id:'missing'})},
    ];
    for (const operation of operations) {
        const f = setup();
        const result = await f.call('content', {requestId,baseCommit:f.base,operation});
        assert.equal(result.status, 422);
        assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
    }
});

test('body edits read only the target document and category catalog', async () => {
    const f = setup({documents:[otherDocument()]});
    const siblingSha = f.trees.get('b'.repeat(40)).find(entry => entry.path.includes(otherId)).sha;
    const result = await f.call('content', {requestId,baseCommit:f.base,operation:{
        type:'post.update',id,baseRevision:revision(raw),markdown:'# Updated body',
    }});
    assert.equal(result.state, 'published');
    assert.equal(f.calls.filter(call => call.path === '/git/blobs/' + siblingSha).length, 0);
});

function retainedCandidate(f, entries) {
    const candidate = 'e'.repeat(40);
    const treeSha = 'f'.repeat(40);
    f.trees.set(treeSha, entries);
    f.commits.set(candidate, {
        sha:candidate,tree:{sha:treeSha},parents:[{sha:f.base}],
        message:`cms-request:${requestId}\npayload-sha256:${'0'.repeat(64)}`,
    });
    f.refs.set('heads/cms/requests/' + requestId, candidate);
    return candidate;
}

test('publish revalidates unaccepted pre-upgrade candidates before applying them', async () => {
    const f = setup({documents:[otherDocument({parent_id:id})]});
    const entries = f.trees.get('b'.repeat(40)).filter(entry => !entry.path.startsWith(`posts/${id}/`));
    const candidateCommit = retainedCandidate(f, entries);
    const result = await f.call('publish', {requestId,candidateCommit});
    assert.equal(result.status, 409);
    assert.equal(f.refs.get('heads/main'), f.base);
    assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
});

test('publish rejects retained candidates with paths or modes outside the editable content contract', async () => {
    for (const changed of [
        {path:'app.js',mode:'100644',type:'blob',sha:'1'.repeat(40)},
        {path:`posts/${id}/image.png`,mode:'120000',type:'blob',sha:'1'.repeat(40)},
    ]) {
        const f = setup();
        const entries = f.trees.get('b'.repeat(40)).filter(entry => entry.path !== changed.path);
        const candidateCommit = retainedCandidate(f, [...entries,changed]);
        const result = await f.call('publish', {requestId,candidateCommit});
        assert.equal(result.status, 409);
        assert.equal(f.refs.get('heads/main'), f.base);
        assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
    }
});

test('publish rejects a retained document candidate with a missing category', async () => {
    const f = setup();
    const bytes = Buffer.from(serializeMarkdownDocument({...document,metadata:{...document.metadata,category_id:'missing'}}));
    const blobSha = sha(bytes);
    f.blobs.set(blobSha, bytes);
    const entries = f.trees.get('b'.repeat(40)).map(entry => entry.path.endsWith('/Old.md') ? {...entry,sha:blobSha} : entry);
    const candidateCommit = retainedCandidate(f, entries);
    assert.equal((await f.call('publish', {requestId,candidateCommit})).status, 422);
    assert.equal(f.refs.get('heads/main'), f.base);
});

test('new asset paths reject unsafe names and portable collisions with canonical assets', async () => {
    for (const [name, status] of [['bad:name.png',400],['%2Fescape.png',400],['%252Fescape.png',400],['IMAGE.PNG',409]]) {
        const f = setup();
        const asset = await f.call('assets', {content:Buffer.from('different image').toString('base64')});
        const result = await f.call('content', {requestId,baseCommit:f.base,operation:{
            type:'post.update',id,baseRevision:revision(raw),assets:[{...asset,name}],
        }});
        assert.equal(result.status, status);
        assert.equal(f.refs.get('heads/main'), f.base);
    }
});


test('publish rejects a retained new post whose parent points to itself', async () => {
    const f = setup();
    const bytes = Buffer.from(serializeMarkdownDocument(otherDocument({parent_id:otherId})));
    const blobSha = sha(bytes);
    f.blobs.set(blobSha, bytes);
    const entries = [...f.trees.get('b'.repeat(40)),{path:`posts/${otherId}/Sibling.md`,mode:'100644',type:'blob',sha:blobSha}];
    const candidateCommit = retainedCandidate(f, entries);
    assert.equal((await f.call('publish', {requestId,candidateCommit})).status, 422);
    assert.equal(f.refs.get('heads/main'), f.base);
});

test('category saves preserve the catalog schema when adding a category', async () => {
    for (const categoryId of ['', 'Other']) {
        const f = setup();
        const current = await f.call('content?kind=categories');
        const result = await f.call('content', {requestId,baseCommit:f.base,operation:{
            type:'categories.save',baseRevision:current.revision,
            categories:[...current.categories,{id:categoryId,name:'Invalid',parent_id:null,order:1}],
        }});
        assert.equal(result.status, 422);
        assert.equal(f.refs.get('heads/main'), f.base);
    }
});


function fixtureCatalog(f, references = {}) {
    const entries = f.trees.get('b'.repeat(40));
    return {version:1,documents:entries.filter(entry => entry.path.endsWith('.md')).map(entry => {
        const bytes = f.blobs.get(entry.sha);
        const parsed = parseMarkdownDocument(bytes.toString('utf8'));
        return {
            blobSha:entry.sha,metadata:parsed.metadata,markdown:parsed.markdown.slice(0,1400),
            filename:entry.path,revision:revision(bytes),references:references[parsed.metadata.id] ?? [],
            assets:entries.filter(asset => asset.path.startsWith(`posts/${parsed.metadata.id}/`) && !asset.path.endsWith('.md')).map(asset => ({name:asset.path.split('/').at(-1)})),
        };
    })};
}

test('unchanged catalog documents block deletion for full-body references beyond the summary without blob reads', async () => {
    const f = setup({documents:[otherDocument({}, 'x'.repeat(1600) + `\n[target](#/post/${id})`)]});
    f.controls.catalog = fixtureCatalog(f, {[otherId]:[id]});
    const siblingSha = f.controls.catalog.documents.find(entry => entry.metadata.id === otherId).blobSha;
    const result = await f.call('content', deletePayload(f.base));
    assert.equal(result.status, 409);
    assert.equal(f.calls.filter(call => call.path === '/git/blobs/' + siblingSha).length, 0);
    assert.equal(f.refs.get('heads/main'), f.base);
});

test('category deletion reuses complete catalog metadata across a large unchanged tree', async () => {
    const documents = Array.from({length:100}, (_, index) => otherDocument({
        id:`98765432-1234-1234-1234-${String(index).padStart(12,'0')}`,title:'Post ' + index,
    }));
    const categories = [
        {id:'group:unclassified',name:'Other',parent_id:null,order:0,sources:[]},
        {id:'group:unused',name:'Unused',parent_id:null,order:1,sources:[]},
    ];
    const f = setup({documents,categories});
    f.controls.catalog = fixtureCatalog(f);
    const current = await f.call('content?kind=categories');
    const result = await f.call('content', {requestId,baseCommit:f.base,operation:{
        type:'categories.save',baseRevision:current.revision,categories:categories.slice(0,1),
    }});
    assert.equal(result.state, 'published');
    const documentBlobs = new Set(f.controls.catalog.documents.map(entry => '/git/blobs/' + entry.blobSha));
    assert.equal(f.calls.filter(call => documentBlobs.has(call.path)).length, 0);
});

test('changed documents bypass stale catalog references and resolve against complete metadata aliases', async () => {
    for (const destination of [`#/post/${id}`,`https://www.notion.so/Old-${id.replaceAll('-','')}`,'Legacy/Old.md']) {
        const f = setup({document:{...document,metadata:{...document.metadata,legacy_path:'Legacy/Old.md'}},documents:[otherDocument()]});
        f.controls.catalog = fixtureCatalog(f);
        const bytes = Buffer.from(serializeMarkdownDocument(otherDocument({}, `[target](${destination})`)));
        const blobSha = sha(bytes);
        f.blobs.set(blobSha, bytes);
        const sibling = f.trees.get('b'.repeat(40)).find(entry => entry.path.includes(otherId));
        sibling.sha = blobSha;
        const original = await f.call('content?kind=post&id=' + id);
        const result = await f.call('content', {requestId,baseCommit:f.base,operation:{type:'post.delete',id,baseRevision:original.revision}});
        assert.equal(result.status, 409);
        assert.equal(f.calls.filter(call => call.path === '/git/blobs/' + blobSha).length, 1);
    }
});

test('a direct save refreshes the public index and full body from the accepted commit through the same repository', async () => {
    const f = setup({publicRepository:true});
    const publicCall = async query => {
        const response = await handlePublicRequest(new Request('https://site.test/api/public?' + query), {env:{},fetcher:f.fetcher,catalog:fixtureCatalog(f)});
        const result = await response.json();
        assert.equal(response.status, 200, result.error);
        return result;
    };
    const original = await publicCall('kind=index');
    assert.equal(original.contentCommit, f.base);
    assert.equal(original.posts[0].title, 'Old');
    const readsBeforeSave = f.calls.filter(call => call.path === '/git/ref/heads/main').length;
    const saved = await f.call('content', {requestId,baseCommit:f.base,operation:{
        type:'post.update',id,baseRevision:revision(raw),changes:{title:'Saved'},markdown:'# Immediately visible',
    }});
    assert.equal(saved.state, 'published');
    const current = await publicCall('kind=index&after=' + saved.contentCommit);
    assert.equal(current.contentCommit, saved.contentCommit);
    assert.equal(current.posts[0].title, 'Saved');
    assert.equal(current.posts[0].bodyLoaded, false);
    const detail = await publicCall(`kind=post&id=${id}&commit=${current.contentCommit}`);
    assert.equal(detail.title, 'Saved');
    assert.equal(detail.markdown, '# Immediately visible');
    assert.equal(detail.bodyLoaded, true);
    assert.ok(f.calls.filter(call => call.path === '/git/ref/heads/main').length >= readsBeforeSave + 4);
    assert.ok(f.calls.every(call => !call.path.includes('/actions/') && !call.path.includes('deploy')));
    assert.ok(f.calls.filter(call => call.method !== 'GET').every(call => call.repository === '/repos/gyungsubLee/subdev-blog-content'));
});


test('authored unsafe URLs and encoded paths fail before any candidate writes without reading sibling bodies', async () => {
    const markdownCases = [
        '[bad](file:///tmp/x)', '[bad](javascript:alert)', '[bad](vbscript:alert)',
        '[bad](./bad%ZZ.png)', '[bad](./a%5cb.png)', '[bad](../outside.png)',
        '[bad](./%252e%252e%252foutside.png)',
    ];
    for (const markdown of markdownCases) {
        const f = setup({documents:[otherDocument()]});
        const siblingSha = f.trees.get('b'.repeat(40)).find(entry => entry.path.includes(otherId)).sha;
        const result = await f.call('content', {requestId,baseCommit:f.base,operation:{
            type:'post.update',id,baseRevision:revision(raw),markdown,
        }});
        assert.equal(result.status, 422, markdown);
        assert.equal(f.refs.get('heads/main'), f.base);
        assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
        assert.equal(f.calls.filter(call => call.path === '/git/blobs/' + siblingSha).length, 0);
    }
    for (const metadata of [{cover:'file:///tmp/x'},{icon:'javascript:alert'}]) {
        const f = setup();
        const result = await f.call('content', {requestId,baseCommit:f.base,operation:{
            type:'post.create',document:otherDocument(metadata),
        }});
        assert.equal(result.status, 422);
        assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
    }
});

test('pending candidates with unsafe authored URLs cannot be applied by POST resume', async () => {
    for (const doc of [
        {...document,markdown:'[bad](file:///tmp/x)'},
        {...document,metadata:{...document.metadata,cover:'javascript:alert'}},
        {...document,metadata:{...document.metadata,icon:'file:///tmp/x'}},
    ]) {
        const f = setup();
        const bytes = Buffer.from(serializeMarkdownDocument(doc));
        const blobSha = sha(bytes);
        f.blobs.set(blobSha, bytes);
        const entries = f.trees.get('b'.repeat(40)).map(entry => entry.path.endsWith('/Old.md') ? {...entry,sha:blobSha} : entry);
        const candidateCommit = retainedCandidate(f, entries);
        const result = await f.call('publish', {requestId,candidateCommit});
        assert.equal(result.status, 422);
        assert.equal(f.refs.get('heads/main'), f.base);
        assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
    }
});

test('target URL validation preserves authored bytes, allows missing links and skips code examples', async () => {
    const f = setup({documents:[otherDocument({legacy_path:'Legacy/Sibling.md'})]});
    f.controls.catalog = fixtureCatalog(f);
    const markdown = '\r\n[missing](../missing.md)\r\n[alias](Legacy/Sibling.md)\r\n`[example](file:///tmp/x)`\r\n![image](./image.png)\r\n';
    const result = await f.call('content', {requestId,baseCommit:f.base,operation:{
        type:'post.update',id,baseRevision:revision(raw),markdown,
    }});
    assert.equal(result.state, 'published');
    const entry = f.trees.get(f.commits.get(result.contentCommit).tree.sha).find(entry => entry.path.endsWith('/Old.md'));
    assert.equal(parseMarkdownDocument(f.blobs.get(entry.sha).toString('utf8')).markdown, markdown);
    const siblingSha = f.controls.catalog.documents.find(entry => entry.metadata.id === otherId).blobSha;
    assert.equal(f.calls.filter(call => call.path === '/git/blobs/' + siblingSha).length, 0);
});

test('serialized Markdown byte size matches the public runtime two MiB boundary', async () => {
    const limit = 2 * 1024 * 1024;
    const overhead = Buffer.byteLength(serializeMarkdownDocument(otherDocument()));
    for (const extraBytes of [-1,0,1]) {
        const f = setup();
        const doc = otherDocument({}, 'x'.repeat(limit - overhead + extraBytes));
        const result = await f.call('content', {requestId,baseCommit:f.base,operation:{type:'post.create',document:doc}});
        assert.equal(result.status, extraBytes <= 0 ? 200 : 413);
        if (extraBytes > 0) assert.equal(f.calls.filter(call => call.method !== 'GET').length, 0);
    }
    const f = setup();
    const result = await f.call('content', {requestId,baseCommit:f.base,operation:{type:'post.create',document:otherDocument({}, '한'.repeat(800000))}});
    assert.equal(result.status, 413);
});

test('oversized pending Markdown and fresh category JSON fail before accepting a candidate', async () => {
    const f = setup();
    const bytes = Buffer.from(serializeMarkdownDocument({...document,markdown:'x'.repeat(2 * 1024 * 1024)}));
    const blobSha = sha(bytes);
    f.blobs.set(blobSha, bytes);
    const entries = f.trees.get('b'.repeat(40)).map(entry => entry.path.endsWith('/Old.md') ? {...entry,sha:blobSha} : entry);
    const candidateCommit = retainedCandidate(f, entries);
    assert.equal((await f.call('publish', {requestId,candidateCommit})).status, 413);
    assert.equal(f.calls.filter(call => call.method === 'PATCH').length, 0);
    const g = setup();
    const current = await g.call('content?kind=categories');
    const result = await g.call('content', {requestId,baseCommit:g.base,operation:{
        type:'categories.save',baseRevision:current.revision,
        categories:current.categories.map(category => ({...category,name:'x'.repeat(2 * 1024 * 1024)})),
    }});
    assert.equal(result.status, 413);
    assert.equal(g.calls.filter(call => call.method !== 'GET').length, 0);
});
