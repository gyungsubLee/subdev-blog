import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../../app/server/src/handler.mjs';
import { createManagementCategoryFixture } from '../support/management-category-fixture.mjs';

async function login(f) {
  const start = await handleRequest(new Request(f.env.CMS_ORIGIN + '/api/auth/github'), f);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  return handleRequest(new Request(`${f.env.CMS_ORIGIN}/api/auth/callback?state=${state}&code=test`, {
    headers: { cookie: start.headers.getSetCookie()[0].split(';')[0] },
  }), { env: f.env, fetcher: (url, options) => url.endsWith('/access_token')
    ? Response.json({ access_token: 'diagnostic-only', expires_in: 7200 }) : f.fetcher(url, options) });
}

test('login validates grants once and session stays ready without external communication', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const response = await login(f);
  assert.equal(response.status, 302);
  assert.ok(f.calls.some(call => call.path === '/user/installations'), 'Login must validate installation');
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('__Host-cms_session=')).split(';')[0];
  assert.ok(Buffer.byteLength(cookie) < 4096);
  let calls = 0;
  for (let i = 0; i < 3; i++) {
    const result = await handleRequest(new Request(f.env.CMS_ORIGIN + '/api/session', { headers: { cookie } }), {
      env: f.env, fetcher: async () => { calls++; throw new Error('offline'); },
    });
    assert.equal((await result.json()).state, 'ready');
    assert.equal(result.headers.getSetCookie().length, 0, 'Reads must not extend expiry');
  }
  assert.equal(calls, 0);
});

test('failed login grants never issue a session', { timeout: 5000 }, async () => {
  for (const [key, value] of [['userId', 99], ['push', false], ['suspended', true]]) {
    const f = createManagementCategoryFixture();
    f.controls[key] = value;
    const response = await login(f);
    assert.equal(response.status, 403, key);
    assert.equal(response.headers.getSetCookie().some(cookie => cookie.startsWith('__Host-cms_session=')), false);
  }
});

import { loadConfig, readCookie, seal, setCookie } from '../../app/server/src/auth.mjs';

test('sessions reject legacy cookies, tampering, expiry, excessive lifetime and changed configuration locally', { timeout: 5000 }, async () => {
  const f = createManagementCategoryFixture();
  const config = loadConfig(f.env);
  const response = await login(f);
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('__Host-cms_session=')).split(';')[0];
  const claims = readCookie(new Request(f.env.CMS_ORIGIN, { headers: { cookie } }), config);
  const now = Date.now();
  let calls = 0;
  const fetcher = async () => { calls++; throw new Error('must remain local'); };
  for (const value of [
    { token: 'old', csrfToken: 'csrf', expires: now + 60000 },
    { ...claims, expires: now - 1 },
    { ...claims, issuedAt: now, expires: now + 3600001 },
    { ...claims, issuedAt: now + 10000 },
    { ...claims, binding: 'other' },
  ]) {
    const invalid = setCookie(seal(value, config), config).split(';')[0];
    const result = await handleRequest(new Request(f.env.CMS_ORIGIN + '/api/session', { headers: { cookie: invalid } }), { env: f.env, fetcher });
    assert.equal((await result.json()).state, 'signed_out');
  }
  const forged = cookie.slice(0, -8) + 'AAAAAAAA';
  assert.equal((await (await handleRequest(new Request(f.env.CMS_ORIGIN + '/api/session', { headers: { cookie: forged } }), { env: f.env, fetcher })).json()).state, 'signed_out');
  for (const [key, value] of [
    ['GITHUB_ADMIN_USER_ID', '99'], ['GITHUB_APP_ID', '99'], ['GITHUB_INSTALLATION_ID', '99'],
    ['GITHUB_APP_REPOSITORY_ID', '99'], ['GITHUB_CONTENT_REPOSITORY_ID', '99'],
    ['GITHUB_APP_BRANCH', 'other'], ['GITHUB_CONTENT_BRANCH', 'other'],
    ['GITHUB_CLIENT_ID', 'other'], ['CMS_ORIGIN', 'https://other.test'], ['CMS_SESSION_KEY', 'z'.repeat(32)],
  ]) {
    const result = await handleRequest(new Request(f.env.CMS_ORIGIN + '/api/session', { headers: { cookie } }), { env: { ...f.env, [key]: value }, fetcher });
    assert.equal((await result.json()).state, 'signed_out', key);
  }
  const originalNow = Date.now;
  try {
    Date.now = () => claims.expires - 1;
    assert.equal((await (await handleRequest(new Request(f.env.CMS_ORIGIN + '/api/session', { headers: { cookie } }), { env: f.env, fetcher })).json()).state, 'ready');
    Date.now = () => claims.expires;
    assert.equal((await (await handleRequest(new Request(f.env.CMS_ORIGIN + '/api/session', { headers: { cookie } }), { env: f.env, fetcher })).json()).state, 'signed_out');
  } finally { Date.now = originalNow; }
  assert.equal(calls, 0);
});
