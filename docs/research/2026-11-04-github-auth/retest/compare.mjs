import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { loadComponent } from '../../../../tests/support/load-component.mjs';
import { createNativeAuth } from '../../../../app/server/src/native-auth.mjs';

// Same current header and network inputs; only the auth hook changes.
const hookPath = 'app/web/src/features/content-management/useManagement.ts';
const oldSource = execFileSync('git', ['show', `HEAD:${hookPath}`], { encoding: 'utf8' });
await mkdir('.tmp/auth-retest', { recursive: true });
const outputPath = resolve(`.tmp/auth-retest/before-${process.pid}.mjs`);
const bundled = await build({
  stdin: { contents: oldSource, resolveDir: resolve('app/web/src/features/content-management'), loader: 'tsx' },
  bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
});
await writeFile(outputPath, bundled.outputFiles[0].text);
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://blog.test', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const before = (await import(pathToFileURL(outputPath).href)).useManagement;
const after = (await loadComponent(hookPath)).useManagement;
const { default: SiteHeader } = await loadComponent('app/web/src/components/layout/SiteHeader.tsx');
const originalFetch = globalThis.fetch;
const originalNow = Date.now;

async function compareAbandonedNativeLogin(createAuth) {
  let logins = 0;
  const origin = 'http://127.0.0.1:5173';
  const handler = createAuth({ origin, token: 'fake-native', handleRequest: async () =>
    new Response(null, { status: 302, headers: { location: `https://github.com/login/oauth/authorize?state=fake-${++logins}` } }) });
  const request = (path, method = 'GET') => handler(new Request(origin + path, { method, headers: { 'X-Second-Brain-Native': 'fake-native' } }));
  const first = await (await request('/__native/auth/start', 'POST')).json();
  await handler(new Request(first.url));
  // The browser closes before callback; the user starts login again.
  const next = await (await request('/__native/auth/start', 'POST')).json();
  const reopened = await handler(new Request(next.url));
  return { reusedAbandonedFlow: first.flow === next.flow, reopenedStatus: reopened.status, oauthStarts: logins };
}

async function compareHook(useManagement) {
  let management;
  let calls = 0;
  const waiting = [];
  let mode = 'waiting';
  globalThis.fetch = async () => {
    calls++;
    if (mode === 'waiting') return new Promise(resolve => waiting.push(resolve));
    if (mode === 'offline') throw new TypeError('Temporary connection loss');
    return Response.json({ state: 'ready', csrfToken: 'fake' });
  };
  function Probe() {
    management = useManagement();
    return React.createElement(SiteHeader, { management, onWrite() {} });
  }
  function snapshot() {
    return {
      state: management.session.state, requests: calls,
      loginVisible: document.querySelector('a[href="/api/auth/github"]') !== null,
      contentManagementVisible: document.querySelector('a[href="#/content"]') !== null,
      writeVisible: document.querySelector('button.header-write') !== null,
    };
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Probe)));
    const checking = snapshot();
    await act(async () => {
      mode = 'ready';
      for (const resolve of waiting) resolve(Response.json({ state: 'ready', csrfToken: 'fake' }));
    });
    const ready = snapshot();
    const now = originalNow();
    Date.now = () => now + 6000;
    await act(async () => {
      mode = 'offline';
      window.dispatchEvent(new Event('focus'));
      await new Promise(resolve => setTimeout(resolve, 350));
    });
    const focusedWhileOffline = snapshot();
    Date.now = () => now + 12000;
    await act(async () => {
      mode = 'ready';
      window.dispatchEvent(new Event('online'));
    });
    return { checking, ready, focusedWhileOffline, onlineAgain: snapshot() };
  } finally {
    await act(async () => root.unmount());
    Date.now = originalNow;
  }
}

try {
  const result = { before: await compareHook(before), after: await compareHook(after) };
  for (const version of Object.values(result)) {
    assert.equal(version.checking.state, 'checking');
    assert.equal(version.checking.loginVisible, true);
    assert.equal(version.ready.state, 'ready');
    assert.equal(version.ready.loginVisible, false);
    assert.equal(version.ready.contentManagementVisible, true);
  }
  assert.equal(result.before.focusedWhileOffline.state, 'ready');
  assert.equal(result.before.focusedWhileOffline.requests, 1);
  assert.equal(result.after.focusedWhileOffline.state, 'blocked');
  assert.equal(result.after.focusedWhileOffline.loginVisible, true);
  assert.equal(result.after.focusedWhileOffline.requests, 3);
  assert.equal(result.after.onlineAgain.state, 'ready');
  const oldNativeSource = execFileSync('git', ['show', 'HEAD:app/server/src/native-auth.mjs'], { encoding: 'utf8' });
  const nativeBundle = await build({
    stdin: { contents: oldNativeSource, resolveDir: resolve('app/server/src'), loader: 'js' },
    bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false,
  });
  const nativePath = resolve(`.tmp/auth-retest/native-before-${process.pid}.mjs`);
  await writeFile(nativePath, nativeBundle.outputFiles[0].text);
  try {
    const oldNative = (await import(pathToFileURL(nativePath).href)).createNativeAuth;
    result.native = {
      before: await compareAbandonedNativeLogin(oldNative),
      after: await compareAbandonedNativeLogin(createNativeAuth),
    };
    assert.equal(result.native.before.reopenedStatus, 302);
    assert.equal(result.native.after.reopenedStatus, 410);
    assert.equal(result.native.after.reusedAbandonedFlow, true);
  } finally {
    await unlink(nativePath);
  }
  await writeFile(new URL('./comparison.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  dom.window.close();
  await unlink(outputPath);
}
