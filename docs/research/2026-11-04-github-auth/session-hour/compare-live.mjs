import { loadEnv } from 'vite';
import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { handleRequest } from '../../../../app/server/src/handler.mjs';
import { loadConfig, readCookie, seal, setCookie } from '../../../../app/server/src/auth.mjs';

// Secrets stay in memory. Native app owns cookie import and acknowledgement.
const env = loadEnv('production', process.cwd(), ['CMS_', 'GITHUB_']);
const config = loadConfig(env);
const origin = config.origin;
if (origin !== 'http://127.0.0.1:5173') throw Error('Expected native local server');
const health = await (await fetch(origin + '/__native/health', { signal: AbortSignal.timeout(5000) })).json();
const headers = { 'X-Second-Brain-Native': health.token };
const start = await fetch(origin + '/__native/auth/start', { method: 'POST', headers, signal: AbortSignal.timeout(5000) });
const flow = await start.json();
console.log('Ready: initiate login in the native app.');
const deadline = Date.now() + 180000;
let cookie;
while (Date.now() < deadline) {
  const result = await fetch(`${origin}/__native/auth/result?flow=${flow.flow}`, { headers, signal: AbortSignal.timeout(5000) });
  if (result.status === 410) throw Error('Flow consumed before probe');
  const state = await result.json();
  if (state.state === 'failed') throw Error('OAuth failed');
  if (state.state === 'complete') {
    cookie = result.headers.getSetCookie().find(value => value.startsWith('cms_session='))?.split(';')[0];
    break;
  }
  await delay(100);
}
if (!cookie) throw Error('No completed native cookie within deadline');
const claims = readCookie(new Request(origin, { headers: { cookie } }), config);
const { handleRequest: before } = await import('../../../../.tmp/session-hour-before/handler.mjs');
const oldCookie = setCookie(seal({ token: claims.token, csrfToken: claims.csrfToken, expires: claims.expires }, config), config).split(';')[0];
const output = { measuredAt: new Date().toISOString(), remainingSeconds: Math.floor((claims.expires - Date.now()) / 1000), cookieBytes: Buffer.byteLength(cookie), samples: [] };
for (const path of ['/api/session', '/api/content?kind=categories']) {
  for (const [label, handler, value] of [['before', before, oldCookie], ['after', handleRequest, cookie]]) {
    const calls = [];
    const fetcher = async (url, options) => {
      const start = performance.now();
      const response = await fetch(url, options);
      calls.push({ path: new URL(url).pathname, status: response.status, ms: +(performance.now() - start).toFixed(2) });
      return response;
    };
    for (let i = 0; i < 3; i++) {
      calls.length = 0;
      const began = performance.now();
      const result = await handler(new Request(origin + path, { headers: { cookie: value } }), { env, fetcher });
      const body = await result.json();
      output.samples.push({ label, path, sample: i + 1, status: result.status, state: body.state, categories: body.categories?.length,
        contentCommit: body.contentCommit, ms: +(performance.now() - began).toFixed(2), calls: [...calls] });
    }
  }
}
await writeFile(new URL('./live-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
