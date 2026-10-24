import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, authenticate } from '../server/auth.mjs';
test('missing credentials fail closed', () => assert.throws(() => loadConfig({}), /configuration/));
test('missing and forged sessions are rejected', async () => {
  for (const cookie of ['', '__Host-cms_session=forged']) {
    await assert.rejects(authenticate(new Request('https://blog.test/api/content', { headers: { cookie } }), { origin: 'https://blog.test', sessionKey: 'x'.repeat(32) }), { status: 401 });
  }
});

import { seal, setCookie } from '../server/auth.mjs';
const config = { origin: 'https://blog.test', sessionKey: 'x'.repeat(32), adminUserId: 42 };
const fetchUser = async () => Response.json({ id: 42, login: 'owner' });
function sessionRequest(value, headers = {}) {
 return new Request('https://blog.test/api/content', { headers: { cookie: setCookie(seal(value, config), config).split(';')[0], ...headers } });
}
test('real encrypted cookies enforce expiry, owner, origin and CSRF', async () => {
 const session = { token: 'private-token', csrfToken: 'csrf', expires: Date.now() + 60000 };
 const request = sessionRequest(session, { origin: config.origin, 'x-csrf-token': 'csrf' });
 assert.equal((await authenticate(request, config, fetchUser, {mutate:true})).user.id,42);
 await assert.rejects(authenticate(sessionRequest({...session, expires:Date.now()-1}),config,fetchUser),{status:401});
 await assert.rejects(authenticate(request,config,async()=>Response.json({id:99})),{status:403});
 await assert.rejects(authenticate(sessionRequest(session),config,fetchUser,{mutate:true}),{status:403});
 await assert.rejects(authenticate(sessionRequest(session,{origin:'https://evil.test','x-csrf-token':'csrf'}),config,fetchUser,{mutate:true}),{status:403});
});

import { checkConnection } from '../server/auth.mjs';
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
test('connection readiness checks owner repositories, installation and publishing',async()=>{
 assert.deepEqual(await checkConnection('token',connectedConfig,connectedFetcher()),{repository:'gyungsubLee/subdev-blog-content',branch:'main',contentCommit:'content-head',appContentCommit:'deployed-content',appCommit:'app-head'});
 for(const overrides of [
  {'/user/installations':{installations:[{id:12,app_id:11,suspended_at:'now',permissions:{contents:'write',actions:'write'}}]}},
  {'/user/installations/12/repositories':{repositories:[{id:13}]}},
  {'/repos/gyungsubLee/subdev-blog':{id:999,permissions:{push:true}}},
  {'/repos/gyungsubLee/subdev-blog/actions/workflows/publish-content.yml':{state:'disabled_manually'}},
  {'/repos/gyungsubLee/subdev-blog/contents/content':{type:'file'}}
 ]) await assert.rejects(checkConnection('token',connectedConfig,connectedFetcher(overrides)),{status:403});
});
test('revoked credentials and network errors remain safe',async()=>{
 const request=sessionRequest({token:'secret-token',csrfToken:'csrf',expires:Date.now()+60000});
 await assert.rejects(authenticate(request,config,async()=>new Response('',{status:401})),{status:401});
 await assert.rejects(authenticate(request,config,async()=>{throw Error('secret-token')}),error=>error.status===502&&!error.message.includes('secret-token'));
});

import { createGitHubClient } from '../server/github.mjs';
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
