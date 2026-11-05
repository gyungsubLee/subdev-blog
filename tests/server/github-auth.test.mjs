import { authorizedSession } from '../support/authorized-session.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, authenticate } from '../../app/server/src/auth.mjs';
test('missing credentials fail closed', () => assert.throws(() => loadConfig({}), /configuration/));
test('missing and forged sessions are rejected', async () => {
  for (const cookie of ['', '__Host-cms_session=forged']) {
    await assert.rejects(authenticate(new Request('https://blog.test/api/content', { headers: { cookie } }), { origin: 'https://blog.test', sessionKey: 'x'.repeat(32) }), { status: 401 });
  }
});

import { seal, setCookie } from '../../app/server/src/auth.mjs';
const config = { origin: 'https://blog.test', sessionKey: 'x'.repeat(32), adminUserId: 42, content: { owner: 'owner', repo: 'content', branch: 'main' } };
const fetchUser = async () => Response.json({ id: 42, login: 'owner' });
function sessionRequest(value, headers = {}) {
 return new Request('https://blog.test/api/content', { headers: { cookie: setCookie(seal(value, config), config).split(';')[0], ...headers } });
}
test('real encrypted cookies enforce expiry, owner, origin and CSRF', async () => {
 const session = authorizedSession(config, { token: 'private-token' });
 const request = sessionRequest(session, { origin: config.origin, 'x-csrf-token': 'csrf' });
 assert.equal((await authenticate(request, config, fetchUser, {mutate:true})).user.id,42);
 await assert.rejects(authenticate(sessionRequest({...session, expires:Date.now()-1}),config,fetchUser),{status:401});
 await assert.rejects(authenticate(sessionRequest({...session,user:{id:99,login:'other'}}),config,fetchUser),{status:403});
 await assert.rejects(authenticate(sessionRequest(session),config,fetchUser,{mutate:true}),{status:403});
 await assert.rejects(authenticate(sessionRequest(session,{origin:'https://evil.test','x-csrf-token':'csrf'}),config,fetchUser,{mutate:true}),{status:403});
});

import { checkConnection } from '../../app/server/src/auth.mjs';
const connectedConfig = { ...config, appId:11, installationId:12, workflow:'publish-content.yml', app:{owner:'gyungsubLee',repo:'subdev-blog',id:13,branch:'main'},content:{owner:'gyungsubLee',repo:'subdev-blog-content',id:14,branch:'main'} };
function connectedFetcher(overrides = {}) {
 return async url => {
  const path=new URL(url).pathname;
  if(Object.hasOwn(overrides,path)) return Response.json(overrides[path]);
  if(path==='/user/installations') return Response.json({installations:[{id:12,app_id:11,permissions:{contents:'write',actions:'write'}}]});
  if(path==='/user/installations/12/repositories') return Response.json({repositories:[{id:13},{id:14}]});
  if(path.endsWith('/branches/main')) return Response.json({commit:{sha:path.includes('subdev-blog-content')?'content-head':'app-head'}});
  if(path.endsWith('/contents/content')) return Response.json({type:'submodule',sha:'deployed-content',submodule_git_url:'https://github.com/gyungsubLee/subdev-blog-content.git'});
  if(path.endsWith('/contents/.gitmodules')) return Response.json({content:Buffer.from('[submodule "content"]\n path = content\n url = https://github.com/gyungsubLee/subdev-blog-content.git\n').toString('base64')});
  if(path.includes('/actions/workflows/')) return Response.json({state:'active'});
  if(path.includes('/contents/')) return Response.json({type:'file'});
  return Response.json({id:path.endsWith('subdev-blog-content')?14:13,default_branch:'main',permissions:{push:true}});
 };
}
test('connection readiness checks owner repositories and installation',async()=>{
 assert.deepEqual(await checkConnection('token',connectedConfig,connectedFetcher()),{repository:'gyungsubLee/subdev-blog-content',branch:'main',contentCommit:'content-head',appContentCommit:'deployed-content',appCommit:'app-head'});
 for(const overrides of [
  {'/user/installations':{installations:[{id:12,app_id:11,suspended_at:'now',permissions:{contents:'write',actions:'write'}}]}},
  {'/user/installations/12/repositories':{repositories:[{id:13}]}},
  {'/repos/gyungsubLee/subdev-blog':{id:999,permissions:{push:true}}},
  {'/repos/gyungsubLee/subdev-blog/contents/content':{type:'file'}}
 ]) await assert.rejects(checkConnection('token',connectedConfig,connectedFetcher(overrides)),{status:403});
});
import { createGitHubClient } from '../../app/server/src/github.mjs';
test('safe GitHub reads recover from connection loss but writes are never retried', { timeout: 5000 }, async () => {
 for (const method of ['GET', 'POST']) {
  let calls = 0;
  const github = createGitHubClient('token', async () => {
   if (++calls === 1) throw new Error('Temporary network loss');
   return Response.json({ id: 42 });
  });
  if (method === 'GET') assert.equal((await github('/user', { method })).id, 42);
  else await assert.rejects(github('/user', { method }), { status: 502 });
  assert.equal(calls, method === 'GET' ? 2 : 1);
 }
});
test('safe reads recover when the connection fails during the response body', { timeout: 3000 }, async () => {
 let calls = 0;
 const github = createGitHubClient('token', async () => {
  if (++calls === 1) return new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('Connection lost')); } }));
  return Response.json({ id: 42 });
 });
 assert.equal((await github('/user')).id, 42);
 assert.equal(calls, 2);
});
test('GitHub boundary preserves actionable status while hiding upstream details', async () => {
 for (const status of [401,403,404,409,422]) {
  await assert.rejects(createGitHubClient('token',async()=>Response.json({message:'private-token'},{status}))('/path'),error=>error.status===status&&!error.message.includes('private-token'));
 }
});

test('installation readiness rejects excess grants and repository selection', async () => {
 for (const permissions of [
  { contents: 'write', actions: 'write', administration: 'write' },
  { contents: 'write', actions: 'write', workflows: 'write' },
  { contents: 'write', actions: 'write', metadata: 'write' },
 ]) {
  const fetcher = connectedFetcher({ '/user/installations': { installations: [{ id: 12, app_id: 11, permissions }] } });
  await assert.rejects(checkConnection('token', connectedConfig, fetcher), { status: 403 });
 }
 const fetcher = connectedFetcher({ '/user/installations/12/repositories': { repositories: [{ id: 13 }, { id: 14 }, { id: 15 }] } });
 await assert.rejects(checkConnection('token', connectedConfig, fetcher), { status: 403 });
});

test('existing nondefault app branch cannot report publishing ready', async () => {
 const fetcher = connectedFetcher({
  '/repos/gyungsubLee/subdev-blog': {
   id: 13,
   default_branch: 'production',
   permissions: { push: true },
  },
 });
 await assert.rejects(checkConnection('token', connectedConfig, fetcher), { status: 403 });
});


test('content management accepts Contents-only installations without any Actions query', async () => {
 const calls = [];
 const upstream = connectedFetcher({
  '/user/installations': { installations: [{ id: 12, app_id: 11, permissions: { contents: 'write', metadata: 'read' } }] },
 });
 const connection = await checkConnection('token', connectedConfig, async (url, options) => {
  calls.push(new URL(url).pathname);
  return upstream(url, options);
 });
 assert.equal(connection.contentCommit, 'content-head');
 assert.equal(calls.some(path => path.includes('/actions/')), false);
});

test('connection readiness recovers from a transient GitHub content lookup failure', { timeout: 5000 }, async () => {
  const upstream = connectedFetcher();
  let categoryRequests = 0;
  const connection = await checkConnection('token', connectedConfig, async (url, options) => {
    if (new URL(url).pathname.endsWith('/contents/categories.json') && ++categoryRequests === 1) {
      return Response.json({ message: 'Internal Server Error' }, { status: 500 });
    }
    return upstream(url, options);
  });
  assert.equal(connection.contentCommit, 'content-head');
  assert.equal(categoryRequests, 2);
});

test('GitHub read retries are bounded and do not retry writes or access failures', { timeout: 5000 }, async () => {
  for (const [method, status, expectedCalls] of [
    ['GET', 503, 3],
    ['GET', 401, 1],
    ['GET', 403, 1],
    ['GET', 404, 1],
    ['GET', 429, 1],
    ['POST', 500, 1],
    ['PATCH', 502, 1],
    ['DELETE', 504, 1],
  ]) {
    let calls = 0;
    const github = createGitHubClient('token', async () => {
      calls++;
      return Response.json({ message: 'private upstream detail' }, { status });
    });
    await assert.rejects(github('/path', { method }), error =>
      error.status === ([401, 403, 404].includes(status) ? status : 502) &&
      !error.message.includes('private upstream detail'));
    assert.equal(calls, expectedCalls, `${method} ${status} retry count`);
  }
});

test('explicit read-only GraphQL POST retries connection loss while mutations do not', { timeout: 5000 }, async () => {
  for (const readOnly of [false, true]) {
    let calls = 0;
    const github = createGitHubClient('token', async (_url, options) => {
      assert.equal(options.method, 'POST');
      if (++calls === 1) throw new Error('Connection lost');
      return Response.json({ data: { value: 1 } });
    });
    const operation = github('/graphql', { method: 'POST', readOnly, body: { query: readOnly ? 'query { viewer { login } }' : 'mutation { deleteThing }' } });
    if (readOnly) assert.equal((await operation).data.value, 1);
    else await assert.rejects(operation, { status: 502 });
    assert.equal(calls, readOnly ? 2 : 1);
  }
});
