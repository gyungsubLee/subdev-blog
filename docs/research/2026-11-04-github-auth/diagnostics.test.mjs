import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { handleRequest } from '../../../app/server/src/handler.mjs';
import { loadConfig, seal, readCookie } from '../../../app/server/src/auth.mjs';
import { createNativeAuth } from '../../../app/server/src/native-auth.mjs';
import { loadComponent } from '../../../tests/support/load-component.mjs';

// Characterization checks: passing means the reported failure mechanism exists.
const env = {
  CMS_ORIGIN: 'http://127.0.0.1:5173', GITHUB_CLIENT_ID: 'client',
  GITHUB_CLIENT_SECRET: 'secret', CMS_SESSION_KEY: 'k'.repeat(32),
  GITHUB_ADMIN_USER_ID: '42', GITHUB_APP_ID: '11', GITHUB_INSTALLATION_ID: '12',
  GITHUB_APP_REPOSITORY_ID: '13', GITHUB_CONTENT_REPOSITORY_ID: '14',
  GITHUB_APP_BRANCH: 'main', GITHUB_CONTENT_BRANCH: 'main',
};
const config = loadConfig(env);
const origin = env.CMS_ORIGIN;
const begin = () => handleRequest(new Request(origin + '/api/auth/github'), { env });
const stateOf = response => new URL(response.headers.get('location')).searchParams.get('state');
const cookieOf = response => response.headers.getSetCookie()[0].split(';')[0];
const callback = (state, cookie) => new Request(`${origin}/api/auth/callback?state=${state}&code=one-use`, { headers: { cookie } });

test('token exchange has no abort signal; session caps an eight-hour token to one hour and drops refresh token', { timeout: 3000 }, async () => {
  const start = await begin();
  let exchangeHasSignal;
  const response = await handleRequest(callback(stateOf(start), cookieOf(start)), {
    env,
    fetcher: async (url, options) => {
      if (url.endsWith('/access_token')) {
        exchangeHasSignal = options.signal !== undefined;
        return Response.json({ access_token: 'fake', expires_in: 28800, refresh_token: 'fake-refresh' });
      }
      return Response.json({ id: 42 });
    },
  });
  assert.equal(response.status, 302);
  assert.equal(exchangeHasSignal, false);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('cms_session=')).split(';')[0];
  const session = readCookie(new Request(origin, { headers: { cookie } }), config);
  assert.ok(session.expires <= Date.now() + 3600000);
  assert.ok(session.expires > Date.now() + 3590000);
  assert.equal(Object.hasOwn(session, 'refresh_token'), false);
  assert.equal(Object.hasOwn(session, 'refreshToken'), false);
});

test('a second login overwrites OAuth cookie; older callback clears even a valid session', { timeout: 3000 }, async () => {
  const old = await begin();
  const newer = await begin();
  const validSession = seal({ token: 'fake', csrfToken: 'csrf', expires: Date.now() + 60000 }, config);
  const response = await handleRequest(callback(stateOf(old), `${cookieOf(newer)}; cms_session=${validSession}`), {
    env, fetcher: async () => { throw new Error('Must fail before upstream'); },
  });
  assert.equal(response.status, 401);
  assert.ok(response.headers.getSetCookie().some(value => value.startsWith('cms_session=;') && value.includes('Max-Age=0')));
});

test('one transient identity connection failure becomes blocked without retry or cookie deletion', { timeout: 3000 }, async () => {
  let calls = 0;
  const cookie = 'cms_session=' + seal({ token: 'fake', csrfToken: 'csrf', expires: Date.now() + 60000 }, config);
  const response = await handleRequest(new Request(origin + '/api/session', { headers: { cookie } }), {
    env, fetcher: async () => { calls++; throw new Error('Temporary network loss'); },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.state, 'blocked');
  assert.equal(body.error, 'GitHub connection failed');
  assert.equal(calls, 1);
  assert.equal(response.headers.getSetCookie().length, 0);
});

test('completed native handoff is consumed before receipt acknowledgement; retry returns 410', { timeout: 3000 }, async () => {
  const handler = createNativeAuth({ origin, token: 'native-test', handleRequest: async request => {
    if (new URL(request.url).pathname === '/api/auth/github') {
      return new Response(null, { status: 302, headers: { location: 'https://github.com/login/oauth/authorize?state=state' } });
    }
    return new Response(null, { status: 302, headers: { 'set-cookie': 'cms_session=fake; Path=/; HttpOnly' } });
  } });
  const request = (path, method = 'GET') => handler(new Request(origin + path, { method, headers: { 'X-Second-Brain-Native': 'native-test' } }));
  const flow = await (await request('/__native/auth/start', 'POST')).json();
  await handler(new Request(flow.url));
  await handler(new Request(origin + '/api/auth/callback?state=state&code=fake'));
  const deliveredButLost = await request(`/__native/auth/result?flow=${flow.flow}`);
  assert.equal(deliveredButLost.status, 200);
  assert.equal((await request(`/__native/auth/result?flow=${flow.flow}`)).status, 410);
});

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: origin });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useManagement } = await loadComponent('app/web/src/features/content-management/useManagement.ts');
const { default: SiteHeader } = await loadComponent('app/web/src/components/layout/SiteHeader.tsx');
after(() => dom.window.close());

test('blocked session stays blocked after network recovery, online and focus; only manual refresh recovers', { timeout: 3000 }, async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let management;
  function Probe() { management = useManagement(); return null; }
  globalThis.fetch = async () => {
    calls++;
    return Response.json(calls === 1 ? { state: 'blocked', error: 'GitHub connection failed' } : { state: 'ready' });
  };
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Probe)));
    assert.equal(management.session.state, 'blocked');
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(management.session.state, 'blocked');
    assert.equal(calls, 1);
    await act(async () => management.refresh());
    assert.equal(management.session.state, 'ready');
    assert.equal(calls, 2);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test('header presents checking, blocked and signed_out as the same login action', { timeout: 3000 }, async () => {
  const root = createRoot(document.getElementById('root'));
  try {
    for (const state of ['checking', 'blocked', 'signed_out']) {
      await act(async () => root.render(React.createElement(SiteHeader, { management: { session: { state, error: 'Failure detail' } } })));
      const login = document.querySelector('a[href="/api/auth/github"]');
      assert.ok(login !== null, state + ' has login action');
      assert.equal(login.textContent.trim(), '로그인');
      assert.equal(document.querySelector('header').textContent.includes('Failure detail'), false);
    }
  } finally {
    await act(async () => root.unmount());
  }
});
