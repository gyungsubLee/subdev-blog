import test from 'node:test';
import assert from 'node:assert/strict';
import { loadComponent } from '../support/load-component.mjs';
const { sendApi } = await loadComponent('app/web/src/features/content-management/api.ts');

test('content saves outlive the generation deadline while explicit cancellation is preserved', async () => {
  const previousFetch = globalThis.fetch;
  const previousTimeout = AbortSignal.timeout;
  const timeouts = [];
  const signals = [];
  AbortSignal.timeout = milliseconds => { timeouts.push(milliseconds); return new AbortController().signal; };
  globalThis.fetch = async (_url, options) => {
    signals.push(options.signal);
    return { ok: true, json: async () => ({ state: 'published' }) };
  };
  try {
    await sendApi('/api/content', {}, 'csrf');
    assert.ok(timeouts[0] > 180000 && timeouts[0] <= 300000, 'Save timeout must allow generation within the host limit');
    const controller = new AbortController();
    await sendApi('/api/content', {}, 'csrf', controller.signal);
    assert.ok(signals[1] === controller.signal, 'Caller cancellation must be preserved');
  } finally { globalThis.fetch = previousFetch; AbortSignal.timeout = previousTimeout; }
});
