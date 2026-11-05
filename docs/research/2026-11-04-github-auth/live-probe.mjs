import { loadEnv } from 'vite';
import { createInterface } from 'node:readline/promises';
import { performance } from 'node:perf_hooks';
import { writeFile } from 'node:fs/promises';
import { handleRequest } from '../../../app/server/src/handler.mjs';
import { loadConfig, readCookie } from '../../../app/server/src/auth.mjs';

// Explicit interactive probe: credentials stay in memory; output contains no cookies or tokens.
const env = loadEnv('production', process.cwd(), ['CMS_', 'GITHUB_']);
const config = loadConfig(env);
if (config.origin !== 'http://127.0.0.1:5173') throw new Error('Expected the local native server');
const origin = config.origin;
const health = await (await fetch(`${origin}/__native/health`, { signal: AbortSignal.timeout(5000) })).json();
const headers = { 'X-Second-Brain-Native': health.token };
const start = await fetch(`${origin}/__native/auth/start`, { method: 'POST', headers, signal: AbortSignal.timeout(5000) });
if (start.status !== 200) throw new Error(`Start failed: ${start.status}`);
const flow = await start.json();
console.log(JSON.stringify({ loginUrl: flow.url }));
const input = createInterface({ input: process.stdin, output: process.stdout });
try {
  await input.question('Complete browser login, then press Enter: ', { signal: AbortSignal.timeout(180000) });
  const result = await fetch(`${origin}/__native/auth/result?flow=${encodeURIComponent(flow.flow)}`, { headers, signal: AbortSignal.timeout(5000) });
  const state = await result.json();
  if (state.state !== 'complete') throw new Error(`Handoff incomplete: ${result.status} ${state.state}`);
  const cookie = result.headers.getSetCookie().find(value => value.startsWith('cms_session='))?.split(';')[0];
  if (!cookie) throw new Error('No session cookie in handoff');
  const request = new Request(`${origin}/api/session`, { headers: { cookie } });
  const session = readCookie(request, config);
  const output = { measuredAt: new Date().toISOString(), sessionRemainingSeconds: Math.round((session.expires - Date.now()) / 1000), samples: [] };
  const calls = [];
  const fetcher = async (url, options) => {
    const began = performance.now();
    const response = await fetch(url, options);
    calls.push({ path: new URL(url).pathname, status: response.status, ms: Math.round(performance.now() - began) });
    return response;
  };
  for (let i = 0; i < 3; i++) {
    calls.length = 0;
    const began = performance.now();
    const response = await handleRequest(request, { env, fetcher });
    const body = await response.json();
    output.samples.push({ sample: i + 1, state: body.state, error: body.error, ms: Math.round(performance.now() - began), calls: [...calls] });
    if (body.state !== 'ready') break;
  }
  await writeFile(new URL(process.argv.includes('--after') ? './live-results-after.json' : './live-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output));
} finally {
  input.close();
  await fetch(`${origin}/__native/auth/result?flow=${encodeURIComponent(flow.flow)}`, { method: 'DELETE', headers, signal: AbortSignal.timeout(5000) }).catch(() => {});
}
