import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { JSDOM } from 'jsdom';
import { loadComponent } from '../support/load-component.mjs';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://blog.test', pretendToBeVisual: true });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { useManagement } = await loadComponent('app/web/src/features/content-management/useManagement.ts');
after(() => dom.window.close());

async function mounted(fetcher, run, strict = false) {
  const previous = globalThis.fetch;
  const originalNow = Date.now;
  let management;
  function Probe() { management = useManagement(); return null; }
  globalThis.fetch = fetcher;
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(strict ? React.createElement(React.StrictMode, null, React.createElement(Probe)) : React.createElement(Probe)));
    await run(() => management);
  } finally {
    await act(async () => root.unmount());
    Date.now = originalNow;
    globalThis.fetch = previous;
  }
}

test('session reads share an in-flight request in StrictMode and manual refresh', { timeout: 3000 }, async () => {
  const resolvers = [];
  let calls = 0;
  let signal;
  await mounted(async (_url, options) => {
    calls++;
    signal = options?.signal;
    return new Promise(done => { resolvers.push(done); });
  }, async get => {
    let first, second;
    await act(async () => {
      first = get().refresh();
      second = get().refresh();
      for (const resolve of resolvers) resolve(Response.json({ state: 'ready', csrfToken: 'csrf' }));
      await Promise.all([first, second]);
    });
    assert.equal(calls, 1);
    assert.ok(signal instanceof AbortSignal);
    assert.equal(get().session.state, 'ready');
  }, true);
});

test('temporary network loss recovers once; permission failures are not retried', { timeout: 3000 }, async () => {
  let calls = 0;
  await mounted(async () => {
    if (++calls === 1) throw new Error('offline');
    return Response.json({ state: 'ready' });
  }, async get => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    assert.equal(get().session.state, 'ready');
    assert.equal(calls, 2);
  });
  calls = 0;
  await mounted(async () => {
    calls++;
    return Response.json({ state: 'blocked', error: 'Owner access required', retryable: false });
  }, async get => {
    assert.equal(get().session.state, 'blocked');
    assert.equal(calls, 1);
  });
});

test('online and focus recover blocked sessions with event throttling and cleanup', { timeout: 3000 }, async () => {
  let calls = 0;
  await mounted(async () => Response.json(++calls === 1 ? { state: 'blocked', retryable: false } : { state: 'ready' }), async get => {
    assert.equal(get().session.state, 'blocked');
    const now = Date.now();
    Date.now = () => now + 6000;
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(get().session.state, 'ready');
    assert.equal(calls, 2);
  });
  await act(async () => { window.dispatchEvent(new Event('focus')); });
  assert.equal(calls, 2);
});

test('logout invalidates a delayed ready response', { timeout: 3000 }, async () => {
  let resolve;
  let calls = 0;
  await mounted(async path => {
    if (path === '/api/logout') return Response.json({ state: 'signed_out' });
    if (++calls === 1) return Response.json({ state: 'ready', csrfToken: 'csrf' });
    return new Promise(done => { resolve = done; });
  }, async get => {
    let checking;
    await act(async () => {
      checking = get().refresh();
      await get().logout();
      resolve(Response.json({ state: 'ready', csrfToken: 'old' }));
      await checking;
    });
    assert.equal(get().session.state, 'signed_out');
  });
});

test('HTML and null access denials keep their status and never retry', { timeout: 3000 }, async () => {
  for (const [status, body] of [[401, '<html>Access denied</html>'], [403, '<html>Access denied</html>'], [401, 'null'], [403, 'null']]) {
    let calls = 0;
    await mounted(async () => {
      calls++;
      return new Response(body, { status });
    }, async get => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      assert.equal(calls, 1);
      assert.equal(get().session.state, 'blocked');
    });
  }
});

test('deadline during retry backoff leaves checking and cleanup aborts owned requests', { timeout: 3000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await mounted(async (_path, options) => {
      options.signal.throwIfAborted();
      return Response.json({ state: 'blocked', retryable: true });
    }, async get => {
      await act(async () => { t.mock.timers.tick(30000); });
      assert.equal(get().session.state, 'blocked');
    });
  } finally {
    t.mock.timers.reset();
  }
  let signal;
  await mounted(async (_path, options) => {
    signal = options.signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }, async () => {
    assert.equal(signal.aborted, false);
  });
  assert.equal(signal.aborted, true);
});
