import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { loadEnv } from 'vite';
import { loadConfig } from '../../../app/server/src/auth.mjs';
import { handleContentRequest } from '../../../app/server/src/content.mjs';
import { handleContentRequest as before } from '../../../.tmp/category-direct-before/content.mjs';

// Existing CLI credential stays in memory. No OAuth repeat or user data writes.
const token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 5000 }).trim();
const config = loadConfig(loadEnv('production', process.cwd(), ['CMS_', 'GITHUB_']));
const identity = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
if (!identity.ok || (await identity.json()).id !== config.adminUserId) throw Error('CLI credential is not the configured owner');
const output = { measuredAt: new Date().toISOString(), credential: 'existing GitHub CLI credential; same owner and token for both versions', samples: [] };
for (const [label, handler] of [['before', before], ['after', handleContentRequest]]) {
  const calls = [];
  const fetcher = async (url, options) => {
    const began = performance.now();
    const response = await fetch(url, options);
    calls.push({ path: new URL(url).pathname, method: options.method, status: response.status, ms: +(performance.now() - began).toFixed(2) });
    return response;
  };
  for (let sample = 1; sample <= 3; sample++) {
    calls.length = 0;
    const began = performance.now();
    const response = await handler(new Request(config.origin + '/api/content?kind=categories'), { token, config, fetcher });
    const body = await response.json();
    output.samples.push({ label, sample, ms: +(performance.now() - began).toFixed(2), status: response.status,
      count: body.categories?.length, revision: body.revision, contentCommit: body.contentCommit, error: body.error, calls: [...calls] });
    if (response.status !== 200) break;
  }
}
await writeFile(new URL('./live-results.json', import.meta.url), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output));
if (output.samples.length !== 6 || output.samples.some(sample => sample.status !== 200)) process.exitCode = 1;
