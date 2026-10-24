import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../server/handler.mjs';
test('missing configuration blocks management without exposing secrets', async () => {
 const response = await handleRequest(new Request('https://blog.test/api/session'), { env: {} });
 assert.equal((await response.json()).state, 'blocked');
});
test('unknown routes stay outside management API', async () => {
 assert.equal((await handleRequest(new Request('https://blog.test/api/unknown'), {env:{}})).status,404);
});

const env = {
 CMS_ORIGIN:'https://blog.test', GITHUB_CLIENT_ID:'client', GITHUB_CLIENT_SECRET:'secret', CMS_SESSION_KEY:'k'.repeat(32),
 GITHUB_ADMIN_USER_ID:'42', GITHUB_APP_ID:'11', GITHUB_INSTALLATION_ID:'12', GITHUB_APP_REPOSITORY_ID:'13',
 GITHUB_CONTENT_REPOSITORY_ID:'14', GITHUB_APP_BRANCH:'main', GITHUB_CONTENT_BRANCH:'main',
};
function oauthCookie(response) { return response.headers.get('set-cookie').split(';')[0]; }
test('PKCE login exchanges code server-side and keeps token encrypted', async () => {
 const start = await handleRequest(new Request('https://blog.test/api/auth/github'),{env});
 const location = new URL(start.headers.get('location'));
 assert.equal(location.searchParams.get('code_challenge_method'),'S256');
 assert.equal(location.searchParams.get('code_challenge').length,43);
 const state = location.searchParams.get('state');
 const response = await handleRequest(new Request(`https://blog.test/api/auth/callback?code=code&state=${state}`,{headers:{cookie:oauthCookie(start)}}),{env,fetcher:async(url,options)=>{
  if(url.endsWith('/access_token')) {
   assert.equal(JSON.parse(options.body).code_verifier.length,43);
   return Response.json({access_token:'highly-private-token',expires_in:7200});
  }
  return Response.json({id:42,login:'owner'});
 }});
 assert.equal(response.status,302);
 assert.equal(response.headers.get('location'),'https://blog.test');
 assert.ok(!response.headers.get('set-cookie').includes('highly-private-token'));
 const lifetime = Number(response.headers.get('set-cookie').match(/cms_session=[^;]+;[^,]+Max-Age=(\d+)/)[1]);
 assert.ok(lifetime > 0 && lifetime <= 3600);
 assert.match(response.headers.get('set-cookie'),/HttpOnly/);
 assert.match(response.headers.get('set-cookie'),/Secure/);
});
test('callback rejects state tampering, cancellation and other identities',async()=>{
 for(const mode of ['state','cancel','identity']) {
  const start=await handleRequest(new Request('https://blog.test/api/auth/github'),{env});
  const state=new URL(start.headers.get('location')).searchParams.get('state');
  let calls=0;
  const response=await handleRequest(new Request(`https://blog.test/api/auth/callback?code=code&state=${mode==='state'?'wrong':state}${mode==='cancel'?'&error=access_denied':''}`,{headers:{cookie:oauthCookie(start)}}),{env,fetcher:async(url)=>{
   calls++;
   return Response.json(url.endsWith('/access_token')?{access_token:'private',expires_in:3600}:{id:99});
  }});
  assert.equal(response.status,mode==='identity'?403:401);
  assert.equal(calls,mode==='identity'?2:0);
  assert.ok(!(await response.text()).includes('private'));
 }
});
test('both direct and rewritten mutations reject unauthenticated callers',async()=>{
 for(const path of ['/api/content','/api?path=content','/api/assets','/api/publish']) {
  assert.equal((await handleRequest(new Request(`https://blog.test${path}`,{method:'POST'}),{env})).status,401);
 }
});

test('slow identity checks cannot extend session past the token expiry', async () => {
 const start = await handleRequest(new Request('https://blog.test/api/auth/github'), { env });
 const state = new URL(start.headers.get('location')).searchParams.get('state');
 const originalNow = Date.now;
 let now = originalNow();
 Date.now = () => now;
 try {
  const response = await handleRequest(new Request(`https://blog.test/api/auth/callback?code=code&state=${state}`, {
   headers: { cookie: oauthCookie(start) },
  }), { env, fetcher: async url => {
   if (url.endsWith('/access_token')) return Response.json({ access_token: 'token', expires_in: 10 });
   now += 3000;
   return Response.json({ id: 42 });
  } });
  assert.equal(response.status, 302);
  assert.match(response.headers.get('set-cookie'), /cms_session=[^;]+;[^,]+Max-Age=6(?:;|$)/);
 } finally {
  Date.now = originalNow;
 }
});
