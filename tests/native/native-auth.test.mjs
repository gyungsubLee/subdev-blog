import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeAuth } from '../../app/server/src/native-auth.mjs';

const origin = 'http://127.0.0.1:5173';
const token = 'native-process-token';
function fixture() {
  let time = 0;
  let oauth = 0;
  const handler = createNativeAuth({
    origin, token, now: () => time,
    async handleRequest(request) {
      if (new URL(request.url).pathname === '/api/auth/github') {
        const response = new Response(null, { status: 302 });
        response.headers.set('Location', `https://github.com/login/oauth/authorize?state=state-${++oauth}`);
        response.headers.append('Set-Cookie', 'cms_oauth=verifier; Path=/; HttpOnly');
        return response;
      }
      if (new URL(request.url).searchParams.has('error')) return Response.json({error:'Login failed'}, {status:401});
      const response = new Response(null, {status:302, headers:{Location:origin}});
      response.headers.append('Set-Cookie', 'cms_oauth=; Path=/; Max-Age=0');
      response.headers.append('Set-Cookie', 'cms_session=sealed-session; Path=/; HttpOnly; SameSite=Lax');
      return response;
    },
  });
  const request = (path, method = 'GET', authorized = true) => handler(new Request(origin + path, {
    method, headers: authorized ? {'X-Second-Brain-Native':token} : {},
  }));
  return {request, advance: () => { time += 600001; }};
}

test('browser OAuth completion retains cookie until the initiating native process acknowledges receipt', async () => {
  const {request} = fixture();
  assert.equal((await request('/__native/auth/start', 'POST', false)).status, 403);
  const started = await request('/__native/auth/start', 'POST');
  const {flow, url} = await started.json();
  assert.ok(flow.length >= 32);
  assert.equal(new URL(url).origin, origin);
  const login = await request(new URL(url).pathname + new URL(url).search, 'GET', false);
  assert.equal(login.status, 302);
  assert.equal(login.headers.getSetCookie().length, 1);
  assert.equal((await request(`/__native/auth/result?flow=${flow}`)).status, 202);
  await request('/api/auth/callback?state=unrelated&code=other', 'GET', false);
  assert.equal((await request(`/__native/auth/result?flow=${flow}`)).status, 202);
  const completed = await request('/api/auth/callback?state=state-1&code=code', 'GET', false);
  assert.equal(completed.status, 200);
  assert.ok((await completed.text()).includes('앱으로 돌아가세요'));
  await request('/api/auth/callback?state=state-1&error=access_denied', 'GET', false);
  assert.equal((await request(`/__native/auth/result?flow=${flow}`, 'GET', false)).status, 403);
  const result = await request(`/__native/auth/result?flow=${flow}`);
  assert.equal((await result.json()).state, 'complete');
  assert.ok(result.headers.getSetCookie()[0].startsWith('cms_session=sealed-session;'));
  const redelivered = await request(`/__native/auth/result?flow=${flow}`);
  assert.equal(redelivered.status, 200);
  assert.equal(redelivered.headers.getSetCookie()[0], result.headers.getSetCookie()[0]);
  assert.equal((await request(`/__native/auth/result?flow=${flow}`, 'POST', false)).status, 403);
  assert.equal((await request(`/__native/auth/result?flow=${flow}`, 'POST')).status, 204);
  assert.equal((await request(`/__native/auth/result?flow=${flow}`)).status, 410);
});

test('repeated starts share an active login; cancellation and expiry invalidate it', async () => {
  const {request, advance} = fixture();
  const old = await (await request('/__native/auth/start', 'POST')).json();
  const current = await (await request('/__native/auth/start', 'POST')).json();
  assert.equal(old.flow, current.flow);
  assert.equal((await request(`/__native/auth/result?flow=${current.flow}`, 'POST')).status, 409);
  assert.equal((await request(`/__native/auth/result?flow=${current.flow}`, 'DELETE')).status, 204);
  assert.equal((await request(`/__native/auth/result?flow=${current.flow}`)).status, 410);
  const expired = await (await request('/__native/auth/start', 'POST')).json();
  advance();
  assert.equal((await request(`/__native/auth/result?flow=${expired.flow}`)).status, 410);
});

test('OAuth failure reaches the native process without exposing a session', async () => {
  const {request} = fixture();
  const {flow,url} = await (await request('/__native/auth/start', 'POST')).json();
  await request(new URL(url).pathname + new URL(url).search, 'GET', false);
  await request('/api/auth/callback?state=state-1&error=access_denied', 'GET', false);
  const result = await request(`/__native/auth/result?flow=${flow}`);
  assert.equal((await result.json()).state, 'failed');
  assert.equal(result.headers.getSetCookie().length, 0);
});

test('native auth is unavailable outside the local app and rejects cross-origin requests', async () => {
  const disabled = createNativeAuth({origin, handleRequest: () => Response.json({untouched:true})});
  assert.equal((await disabled(new Request(origin + '/__native/auth/start', {method:'POST'}))).status, 404);
  assert.deepEqual(await (await disabled(new Request(origin + '/api/session'))).json(), {untouched:true});
  const {request} = fixture();
  assert.equal((await request('/__native/auth/start')).status, 405);
  const enabled = createNativeAuth({origin,token,handleRequest:()=>Response.json({})});
  assert.equal((await enabled(new Request(origin + '/__native/auth/start', {
    method:'POST', headers:{'X-Second-Brain-Native':token,Origin:'https://untrusted.example'},
  }))).status,403);
});

test('explicit restart replaces an abandoned browser flow and rejects its late result', async () => {
  let starts = 0;
  const handle = createNativeAuth({ origin, token, handleRequest: async () => new Response(null, {
    status: 302, headers: { location: `https://github.com/login/oauth/authorize?state=${++starts}` },
  }) });
  const start = async (restart = false) => (await handle(new Request(origin + '/__native/auth/start', {
    method: 'POST', headers: { 'X-Second-Brain-Native': token, ...(restart ? { 'X-Second-Brain-Restart': '1' } : {}) },
  }))).json();
  const old = await start();
  await handle(new Request(old.url));
  const current = await start(true);
  assert.ok(old.flow !== current.flow);
  assert.equal((await handle(new Request(current.url))).status, 302);
  assert.equal((await handle(new Request(origin + '/__native/auth/result?flow=' + old.flow, { headers: { 'X-Second-Brain-Native': token } }))).status, 410);
});

test('a restarted native login cannot reuse an abandoned OAuth challenge from Chrome', async () => {
  const { handleRequest } = await import('../../app/server/src/handler.mjs');
  const { createManagementCategoryFixture } = await import('../support/management-category-fixture.mjs');
  const f = createManagementCategoryFixture();
  const env = { ...f.env, CMS_ORIGIN: origin };
  const handle = createNativeAuth({ origin, token, handleRequest: request => handleRequest(request, { env, fetcher: f.fetcher }) });
  const start = async restart => (await handle(new Request(origin + '/__native/auth/start', {
    method: 'POST', headers: { 'X-Second-Brain-Native': token, ...(restart ? { 'X-Second-Brain-Restart': '1' } : {}) },
  }))).json();
  const old = await start(false);
  const first = await handle(new Request(old.url));
  const current = await start(true);
  const next = await handle(new Request(current.url, { headers: { cookie: first.headers.getSetCookie()[0].split(';')[0] } }));
  assert.ok(new URL(first.headers.get('location')).searchParams.get('state') !== new URL(next.headers.get('location')).searchParams.get('state'), 'Explicit restart needs a fresh challenge');
});
