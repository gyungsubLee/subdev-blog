// Explicitly authorized real-GitHub verification. No fake identity, content or assets.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { loadEnv } from 'vite';
import { handleRequest as defaultHandler } from '../../app/server/src/handler.mjs';
import { traceRequest, profileFetch } from './save-trace.mjs';
const profiling = process.env.E2E_PROFILE === '1';
const handleRequest = profiling
  ? (await import('../../.tmp/save-stage-profile/modules/handler.mjs')).handleRequest
  : defaultHandler;

const root = path.resolve(import.meta.dirname, '../..');
const folder = path.resolve(root, process.env.E2E_FOLDER ?? '.tmp/real-github-e2e');
await mkdir(folder, { recursive: true });
const env = loadEnv('development', root, ['CMS_', 'GITHUB_']);
// Use the already-authorized CLI credential for read-only public API calls, in memory only.
const readToken = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 15000 }).trim();
env.GITHUB_PUBLIC_TOKEN = readToken;
const catalog = JSON.parse(await readFile(path.join(root, 'app/server/generated/content-catalog.json'), 'utf8'));
const original = new URL('../../app/server/src/public-content.mjs', import.meta.url);
const oldSource = (await readFile(path.join(root, 'docs/research/2026-11-04-precomputed-public-content/reader-before.mjs'), 'utf8'))
  .replace(/from '([^']+)'/g, (match, name) => name.startsWith('.') ? `from '${new URL(name, original).href}'` : match);
const { handlePublicRequest: beforeHandler } = await import('data:text/javascript;base64,' + Buffer.from(oldSource).toString('base64'));
const ownerOrigin = env.CMS_ORIGIN;
const nativeFetch = globalThis.fetch;
const resume = process.env.E2E_RESUME === '1';
const previous = resume ? JSON.parse(await readFile(path.join(folder, 'report.json'), 'utf8')) : null;
const previousServers = resume ? JSON.parse(await readFile(path.join(folder, 'servers.json'), 'utf8')) : null;
const sides = {};
const remoteCalls = previous?.remoteCalls ?? [];
const observedFetch = async (url, options = {}) => {
  const started = performance.now();
  const response = profiling ? await profileFetch(url, options, nativeFetch) : await nativeFetch(url, options);
  remoteCalls.push({ method: options.method ?? 'GET', host: new URL(url).host, path: new URL(url).pathname, status: response.status, headersMs: performance.now() - started });
  return response;
};
async function start(label) {
  const apiRows = previous?.sides[label]?.apiRows ?? [];
  const browserRows = previous?.sides[label]?.browserRows ?? [];
  const key = randomBytes(16).toString('hex');
  let fetcher = (...args) => observedFetch(...args);
  const config = { ...env };
  const server = createServer(async (incoming, response) => {
    try {
      const url = new URL(incoming.url, config.CMS_ORIGIN);
      const chunks = [];
      let size = 0;
      for await (const chunk of incoming) {
        size += chunk.length;
        if (size > 4 * 1024 * 1024) throw Error('Oversized request');
        chunks.push(chunk);
      }
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      if (url.pathname === '/__e2e/save-control') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(await readFile(path.join(root, 'tests/e2e/save-control.html'))); return;
      }
      if (url.pathname === '/__e2e/metrics' && incoming.method === 'POST') {
        browserRows.push(JSON.parse(body));
        response.writeHead(204); response.end(); return;
      }
      if (url.pathname === '/__e2e/cold' && incoming.method === 'POST' && incoming.headers['x-e2e-key'] === key) {
        fetcher = (...args) => observedFetch(...args);
        response.writeHead(204); response.end(); return;
      }
      if (url.pathname === '/__e2e/report') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ label, apiRows, browserRows })); return;
      }
      if (url.pathname.startsWith('/api/')) {
        const started = performance.now();
        const remoteStart = remoteCalls.length;
        const request = new Request(url, { method: incoming.method, headers: incoming.headers, body });
        let result;
        let trace;
        if (url.pathname !== '/api/public') {
          // Preserve the real session's origin binding; proxy to the existing app.
          const headers = new Headers(incoming.headers);
          headers.delete('host');
          if (headers.get('origin') === config.CMS_ORIGIN) headers.set('origin', ownerOrigin);
          const invoke = () => handleRequest(new Request(new URL(url.pathname + url.search, ownerOrigin), {
            method: incoming.method, headers, body,
          }), { env: { ...env, CMS_ORIGIN: ownerOrigin }, fetcher });
          if (profiling && incoming.method === 'POST') {
            const measurement = await traceRequest(invoke);
            result = measurement.result;
            trace = measurement.trace;
          } else result = await invoke();
        } else {
          result = label === 'before'
            ? await beforeHandler(request, { env: config, fetcher, catalog })
            : await handleRequest(request, { env: config, fetcher });
        }
        const ms = performance.now() - started;
        const bytes = Buffer.from(await result.arrayBuffer());
        let publicIdentity;
        if (url.pathname === '/api/public' && url.searchParams.get('kind') === 'index' && result.ok) {
          const data = JSON.parse(result.headers.get('content-encoding') === 'gzip' ? gunzipSync(bytes) : bytes);
          publicIdentity = { contentCommit: data.contentCommit, posts: data.posts.length };
        }
        const input = body && incoming.method === 'POST' ? JSON.parse(body) : null;
        const calls = remoteCalls.slice(remoteStart);
        const mutationStats = incoming.method === 'POST' ? {
          sourceMarkdownReads: calls.filter(call => call.host === 'raw.githubusercontent.com' && call.path.endsWith('.md')).length,
          githubWrites: calls.filter(call => call.method !== 'GET').length,
          githubCalls: calls.length,
        } : {};
        apiRows.push({ path: url.pathname + url.search, method: incoming.method, operation: input?.operation?.type ?? (input?.operations ? input.operations.map(operation => operation.type).join(",") : undefined), status: result.status, ms, bytes: bytes.length, ...publicIdentity, ...mutationStats, ...(trace ? { trace } : {}) });
        for (const [name, value] of result.headers) if (name !== 'set-cookie') response.setHeader(name, value);
        const cookies = result.headers.getSetCookie();
        if (cookies.length) response.setHeader('Set-Cookie', cookies);
        response.setHeader('Server-Timing', `handler;dur=${ms.toFixed(3)}`);
        response.writeHead(result.status); response.end(bytes); return;
      }
      if (url.pathname === '/__e2e/metrics.js') {
        response.setHeader('Content-Type', 'text/javascript');
        response.end(await readFile(path.join(root, 'tests/e2e/browser-metrics.js'))); return;
      }
      const base = path.join(root, 'dist/web');
      const filename = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
      const absolute = path.resolve(base, filename);
      if (!absolute.startsWith(base + path.sep)) { response.writeHead(404); response.end(); return; }
      let bytes = await readFile(absolute);
      if (filename === 'index.html') bytes = Buffer.from(bytes.toString().replace('<head>', '<head><script src="/__e2e/metrics.js"></script>'));
      response.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(absolute)] ?? 'application/octet-stream');
      response.setHeader('Cache-Control', 'no-store'); response.end(bytes);
    } catch (error) {
      response.writeHead(500, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.status ? error.message : 'Measurement request failed' }));
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(previousServers ? Number(new URL(previousServers[label].origin).port) : 0, '127.0.0.1', resolve); });
  config.CMS_ORIGIN = 'http://127.0.0.1:' + server.address().port;
  sides[label] = { server, apiRows, browserRows, origin: config.CMS_ORIGIN, key };
}
await start('before'); await start('after');
await writeFile(path.join(folder, 'servers.json'), JSON.stringify(Object.fromEntries(Object.entries(sides).map(([label, side]) => [label, { origin: side.origin, key: side.key }])), null, 2));
console.log(JSON.stringify({ before: sides.before.origin, after: sides.after.origin, publicReadsAuthenticated: true, remote: 'actual GitHub', cookieMode: 'existing real browser session; request URL/origin normalized to its configured origin; latest real handler' }));
let closed = false;
async function cleanup() {
  if (closed) return; closed = true;
  await writeFile(path.join(folder, 'report.json'), JSON.stringify({ sides: Object.fromEntries(Object.entries(sides).map(([label, side]) => [label, { apiRows: side.apiRows, browserRows: side.browserRows }])), remoteCalls }, null, 2));
  await Promise.all(Object.values(sides).map(side => new Promise(resolve => { side.server.closeAllConnections(); side.server.close(resolve); })));
  process.exit(0);
}
process.once('SIGINT', cleanup); process.once('SIGTERM', cleanup);
setTimeout(cleanup, 30 * 60 * 1000);
