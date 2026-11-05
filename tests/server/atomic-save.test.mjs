import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { handleContentRequest } from "../../app/server/src/content.mjs";
import { publicRepository, ID, A, document } from "../support/public-repository.mjs";
const config = { content: { owner: "gyungsubLee", repo: "subdev-blog-content", branch: "main" } };
const catalog = { version: 1, documents: [] };
const hash = (value) => createHash("sha256").update(value).digest("hex");
const payload = () => ({
  saveMode: "atomic",
  requestId: "atomic-" + crypto.randomUUID(),
  baseCommit: A,
  operations: [{
    type: "post.update",
    id: ID,
    baseRevision: hash(document()),
    changes: { title: "Renamed" },
  }],
});

async function save(repository, request, fetcher = repository.fetcher, headers = {}) {
  const saved = await handleContentRequest(new Request("https://site.test/api/content", { method: "POST", headers, body: JSON.stringify(request) }), { config, catalog, fetcher });
  return { status: saved.status, ...await saved.json() };
}
async function warm(repository, fetcher = repository.fetcher) {
  assert.equal((await handleContentRequest(new Request("https://site.test/api/content?kind=post&id=" + ID), { config, catalog, fetcher })).status, 200);
  repository.calls.length = 0;
}
test("prepared atomic save uses one CAS mutation and local source receipt", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  const saved = await save(repository, request);

  assert.equal(saved.status, 200);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].path, "/graphql");
  assert.equal(saved.sourceOnly, true);
  assert.equal(saved.receipt.payloadHash, hash(JSON.stringify(request)));
  assert.ok(saved.sources[ID].revision);
  assert.equal(repository.refs.get("main"), saved.contentCommit);
});

test("lost mutation response and retry reconcile without duplicate apply", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  const fetcher = async (url, options) => {
    const response = await repository.fetcher(url, options);
    if (options?.body?.includes("mutation AtomicSave")) throw Error("lost");
    return response;
  };
  await warm(repository, fetcher);
  const request = payload();
  const saved = await save(repository, request, fetcher);
  assert.equal(saved.status, 200);
  assert.equal((await save(repository, request, fetcher)).contentCommit, saved.contentCommit);
  assert.equal(repository.commits.size, 2);
  assert.equal((await save(repository, { ...request, operations: [{ ...request.operations[0], changes: { title: "Other" } }] }, fetcher)).status, 409);
});

test("successful receipt primes the next prepared title save", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const first = await save(repository, payload());
  repository.calls.length = 0;
  const request = payload();
  request.baseCommit = first.contentCommit;
  request.operations[0].baseRevision = first.sources[ID].revision;
  request.operations[0].changes.title = "Again";
  const saved = await save(repository, request);

  assert.equal(saved.status, 200);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.commits.size, 3);
});

test("fresh remote advance conflicts and never overwrites canonical source", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const newer = "b".repeat(40);
  repository.commits.set(newer, { sha: newer, tree: repository.commits.get(A).tree, parents: [{ sha: A }] });
  repository.refs.set("main", newer);
  const saved = await save(repository, payload());
  assert.equal(saved.status, 409);
  assert.equal(repository.refs.get("main"), newer);
  assert.equal(repository.commits.size, 2);
});

test("mutation permissions stop immediately without recovery reads", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  const fetcher = (url, options) => new URL(url).pathname === "/graphql" ? Response.json({}, { status: 403 }) : repository.fetcher(url, options);
  await warm(repository, fetcher);
  assert.equal((await save(repository, payload(), fetcher)).status, 403);
  assert.equal(repository.calls.length, 0);
});

test("large exact authored bytes stay in the single mutation", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  request.operations[0].markdown = "Long body ".repeat(1e4);
  const saved = await save(repository, request);

  assert.equal(saved.status, 200);
  assert.equal(repository.calls.length, 1);
  const entries = repository.trees.get(repository.commits.get(saved.contentCommit).tree.sha);
  const entry = entries.find((item) => item.path.endsWith("/Renamed.md"));
  assert.equal(hash(repository.blobs.get(entry.sha)), saved.sources[ID].revision);
});

test("a request ID cannot be reused against its successful source commit", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  const first = await save(repository, request);
  const reused = { ...request, baseCommit: first.contentCommit, operations: [{ ...request.operations[0], baseRevision: first.sources[ID].revision, changes: { title: "Other" } }] };
  assert.equal((await save(repository, reused)).status, 409);
  assert.equal(repository.commits.size, 2);
});

test("durable request marker rejects reuse after unrelated descendants and a new cache scope", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  const first = await save(repository, request);
  const nextRequest = payload();
  nextRequest.baseCommit = first.contentCommit;
  nextRequest.operations[0].baseRevision = first.sources[ID].revision;
  nextRequest.operations[0].changes.title = "Next";
  const second = await save(repository, nextRequest);
  const wrapped = (...args) => repository.fetcher(...args);
  const reused = { ...nextRequest, requestId: request.requestId, baseCommit: second.contentCommit, operations: [{ ...nextRequest.operations[0], baseRevision: second.sources[ID].revision, changes: { title: "Again" } }] };
  assert.equal((await save(repository, reused, wrapped)).status, 409);
  assert.equal(repository.commits.size, 3);
});

test("retry source revision uses accepted bytes rather than regenerated timestamp", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  const first = await save(repository, request);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const retry = await save(repository, request, (...args) => repository.fetcher(...args));
  assert.equal(retry.status, 200);
  assert.equal(retry.sources[ID].revision, first.sources[ID].revision);
});

test("recovery rejects tampered durable receipt and never reapplies", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  await save(repository, request);
  const entries = repository.trees.get(repository.commits.get(repository.refs.get("main")).tree.sha);
  const marker = entries.find((entry) => entry.path === ".cms/requests/" + request.requestId + ".json");
  repository.blobs.set(marker.sha, Buffer.from("{}"));
  const saved = await save(repository, request, (...args) => repository.fetcher(...args));
  assert.equal(saved.status, 409);
  assert.equal(repository.commits.size, 2);
});

test("trusted immutable cache remains entry bounded and credential scoped", { timeout: 10000 }, async () => {
  const { createManagementGitHubClient } = await import("../../app/server/src/management-read-cache.mjs");
  let calls = 0;
  const fetcher = async () => {
    calls++;
    return Response.json({ sha: "read" });
  };
  const first = createManagementGitHubClient("first", config, fetcher);
  for (let i = 0; i < 33; i++) first.prime("/git/commits/" + i.toString(16).padStart(40, "0"), { sha: i });
  await first("/git/commits/" + "0".repeat(40));
  assert.equal(calls, 1);
  await first("/git/commits/" + 32 .toString(16).padStart(40, "0"));
  assert.equal(calls, 1);
  const second = createManagementGitHubClient("second", config, fetcher);
  await second("/git/commits/" + 32 .toString(16).padStart(40, "0"));
  assert.equal(calls, 2);
});

test("large source inventory drops unused API URLs within existing cache budget", { timeout: 10000 }, async () => {
  const { createManagementGitHubClient } = await import("../../app/server/src/management-read-cache.mjs");
  let calls = 0;
  const tree = { truncated: false, tree: Array.from({ length: 10300 }, (_, i) => ({ path: "posts/" + ID + "/" + i + ".md", mode: "100644", type: "blob", sha: "a".repeat(40), size: 100, url: "https://api.github.com/repos/owner/repo/git/blobs/" + "z".repeat(200) })) };
  const fetcher = async () => {
    calls++;
    return Response.json(tree);
  };
  const client = createManagementGitHubClient("compact", config, fetcher);
  const path = "/git/trees/" + "a".repeat(40) + "?recursive=1";
  const first = await client(path);
  await client(path);
  assert.equal(calls, 1);
  assert.equal(first.tree.length, 10300);
  assert.equal(first.tree[0].url, void 0);
});

test("atomic authored no-op reserves its ID with only a durable marker", { timeout: 10000 }, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  request.operations[0].changes.title = "Title";
  const saved = await save(repository, request);

  assert.equal(saved.status, 200);
  assert.equal(saved.state, "unchanged");
  assert.equal(saved.sourceOnly, true);
  assert.equal(saved.publicationPending, true);
  assert.equal(repository.calls.length, 1);
  assert.equal(repository.calls[0].body.variables.input.fileChanges.additions.length, 1);
  assert.ok(repository.calls[0].body.variables.input.fileChanges.additions[0].path.startsWith(".cms/requests/"));
  const reused = { ...request, baseCommit: saved.contentCommit, operations: [{ ...request.operations[0], changes: { title: "Different" } }] };
  assert.equal((await save(repository, reused)).status, 409);
});

test('atomic category no-op preserves the original compact bytes', {timeout:10000}, async () => {
  const repository = publicRepository();
  await warm(repository);
  const originalEntries = repository.trees.get(repository.commits.get(A).tree.sha);
  const original = originalEntries.find(entry => entry.path === 'categories.json');
  const bytes = repository.blobs.get(original.sha);
  const request = payload();
  request.operations = [{type:'categories.save',baseRevision:hash(bytes),categories:JSON.parse(bytes)}];

  const saved = await save(repository,request);
  const committed = repository.trees.get(repository.commits.get(saved.contentCommit).tree.sha);
  assert.equal(saved.status,200);
  assert.equal(saved.state,'unchanged');
  assert.equal(committed.find(entry=>entry.path==='categories.json').sha,original.sha);
  assert.equal(repository.calls[0].body.variables.input.fileChanges.additions.length,1);
});

test('atomic transient GraphQL errors leave the queue retryable', {timeout:10000}, async () => {
  const repository = publicRepository();
  const fetcher = (url, options) => options?.body?.includes('mutation AtomicSave')
    ? Response.json({errors:[{type:'RATE_LIMITED',message:'Please wait'}]})
    : repository.fetcher(url,options);
  await warm(repository,fetcher);

  const saved = await save(repository,payload(),fetcher);
  assert.equal(saved.status,503);
  assert.equal(repository.refs.get('main'),A);
});

test('recovery read errors preserve their transient status after CAS rejection', {timeout:10000}, async () => {
  const repository = publicRepository();
  const fetcher = (url,options) => {
    if (options?.body?.includes('mutation AtomicSave')) return Response.json({errors:[{type:'STALE_DATA'}]});
    if (options?.body?.includes('query RecoverAtomicSave')) return Response.json({errors:[{type:'INTERNAL'}]});
    return repository.fetcher(url,options);
  };
  await warm(repository,fetcher);

  assert.equal((await save(repository,payload(),fetcher)).status,502);
});


test('durable retry reconciles before sending another mutation', {timeout:10000}, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  const first = await save(repository,request);
  repository.calls.length = 0;
  const retry = await save(repository,request,(...args)=>repository.fetcher(...args),{'X-Content-Reconcile':'1'});

  assert.equal(retry.status,200);
  assert.equal(retry.contentCommit,first.contentCommit);
  assert.equal(repository.calls.filter(call=>call.body?.query?.startsWith('mutation')).length,0);
});

test('reconciliation permits first dispatch only when the marker is absent at the unchanged base', {timeout:10000}, async () => {
  const repository = publicRepository();
  await warm(repository);
  const saved = await save(repository,payload(),repository.fetcher,{'X-Content-Reconcile':'1'});

  assert.equal(saved.status,200);
  assert.equal(repository.calls.filter(call=>call.body?.query?.startsWith('mutation')).length,1);
  assert.ok(repository.calls[0].body.query.startsWith('query RecoverAtomicSave'));
});

test('mixed batches retain compact bytes for their unchanged category operation', {timeout:10000}, async () => {
  const repository = publicRepository();
  await warm(repository);
  const original = repository.trees.get(repository.commits.get(A).tree.sha).find(entry=>entry.path==='categories.json');
  const bytes = repository.blobs.get(original.sha);
  const request = payload();
  request.operations.unshift({type:'categories.save',baseRevision:hash(bytes),categories:JSON.parse(bytes)});
  const saved = await save(repository,request);
  const committed = repository.trees.get(repository.commits.get(saved.contentCommit).tree.sha);

  assert.equal(saved.status,200);
  assert.equal(committed.find(entry=>entry.path==='categories.json').sha,original.sha);
  assert.ok(repository.calls[0].body.variables.input.fileChanges.additions.every(entry=>entry.path!=='categories.json'));
});


test('atomic save rejects a legacy request namespace before writes', {timeout:10000}, async () => {
  const repository = publicRepository();
  const request = payload();
  request.requestId = crypto.randomUUID();
  assert.equal((await save(repository,request)).status,400);
  assert.equal(repository.calls.length,0);
});

test('atomic receipt rejects merge provenance with a second parent', {timeout:10000}, async () => {
  const repository = publicRepository();
  const fetcher = async (url,options) => {
    const response = await repository.fetcher(url,options);
    if (!options?.body?.includes('mutation AtomicSave')) return response;
    const value = await response.json();
    value.data.createCommitOnBranch.commit.parents.nodes.push({oid:'b'.repeat(40)});
    return Response.json(value);
  };
  await warm(repository,fetcher);
  assert.equal((await save(repository,payload(),fetcher)).status,409);
});

test('large repeated asset references use bounded SHA tree writes', {timeout:10000}, async () => {
  const repository = publicRepository();
  const bytes = Buffer.alloc(1024*1024,1);
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  repository.blobs.set(sha,bytes);
  await warm(repository);
  const request = payload();
  request.operations[0].assets = Array.from({length:24},(_,i)=>({name:`asset-${i}.png`,sha,size:bytes.length}));
  const saved = await save(repository,request);
  assert.equal(saved.status,200);
  assert.equal(repository.calls.filter(call=>call.body?.query?.startsWith('mutation')).length,0);
  assert.ok(repository.calls.some(call=>call.path.endsWith('/git/trees')&&call.method==='POST'));
  assert.ok(repository.calls.every(call=>JSON.stringify(call.body).length<4*1024*1024));
});

test('cache replacement accounts a pending GET and prime of the same identity once', {timeout:10000}, async () => {
  const {createManagementGitHubClient} = await import('../../app/server/src/management-read-cache.mjs');
  let release;
  let calls = 0;
  const value = {text:'x'.repeat(1536*1024)};
  const fetcher = async () => {
    calls++;
    await new Promise(resolve=>{release=resolve;});
    return Response.json(value);
  };
  const client = createManagementGitHubClient('race',config,fetcher);
  const first = '/git/blobs/'+'a'.repeat(40);
  const loading = client(first);
  client.prime(first,value);
  release();
  await loading;
  client.prime('/git/blobs/'+'b'.repeat(40),value);

  await client(first);
  assert.equal(calls,1);
});

test('reconciliation reports superseded even when the descendant deleted the authored post', {timeout:10000}, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  const saved = await save(repository,request);
  const original = repository.commits.get(saved.contentCommit);
  const treeSha = 'c'.repeat(40);
  const descendant = 'd'.repeat(40);
  repository.trees.set(treeSha,repository.trees.get(original.tree.sha).filter(entry=>!entry.path.startsWith('posts/')));
  repository.commits.set(descendant,{sha:descendant,tree:{sha:treeSha},parents:[{sha:saved.contentCommit}]});
  repository.refs.set('main',descendant);

  const retry = await save(repository,request,repository.fetcher,{'X-Content-Reconcile':'1'});
  assert.equal(retry.status,200);
  assert.equal(retry.state,'superseded');
  assert.equal(retry.contentCommit,descendant);
  assert.ok(retry.commitUrl.endsWith(saved.contentCommit));
});

test('read-only recovery rejects two-parent provenance', {timeout:10000}, async () => {
  const repository = publicRepository();
  await warm(repository);
  const request = payload();
  const saved = await save(repository,request);
  repository.commits.get(saved.contentCommit).parents.push({sha:'b'.repeat(40)});

  const retry = await save(repository,request,repository.fetcher,{'X-Content-Reconcile':'1'});
  assert.equal(retry.status,409);
});

test('large category moves keep aggregate authored tree content below the existing inline bound', {timeout:20000}, async () => {
  const categoryList = [
    {id:'group:unclassified',name:'Other',parent_id:null,order:0,sources:[]},
    {id:'group:move',name:'Move',parent_id:null,order:1,sources:[]},
  ];
  const files = {'categories.json':JSON.stringify(categoryList)};
  const ids = [];
  const markdown = '\\"'.repeat(29000);
  for (let index=0;index<64;index++) {
    const id = index.toString(16).padStart(8,'0')+'-1234-1234-1234-123456789abc';
    ids.push(id);
    files[`posts/${id}/Title.md`] = document(markdown,{category_id:'group:move'},id);
  }
  const repository = publicRepository(files);
  const request = payload();
  delete request.operations;
  request.operation = {
    type:'category.delete',id:'group:move',mode:'move',
    baseRevision:hash(files['categories.json']),
  };
  const saved = await save(repository,request);
  assert.equal(saved.status,200);
  const write = repository.calls.find(call=>call.path.endsWith('/git/trees')&&call.method==='POST');
  assert.ok(Boolean(write));
  const inlineBytes = write.body.tree.reduce((sum,entry)=>sum+(entry.content===undefined?0:Buffer.byteLength(JSON.stringify(entry.content))),0);
  assert.ok(inlineBytes<=1024*1024,'Aggregate escaped authored tree content stays within 1 MiB');
  const committed = repository.trees.get(repository.commits.get(saved.contentCommit).tree.sha);
  const first = committed.find(entry=>entry.path===`posts/${ids[0]}/Title.md`);
  assert.equal(repository.blobs.get(first.sha).toString(),document(markdown,{category_id:'group:unclassified'},ids[0]));
});
