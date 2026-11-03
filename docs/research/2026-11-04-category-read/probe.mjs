import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../../../server/handler.mjs';
import { loadConfig, seal, setCookie } from '../../../server/auth.mjs';

// Diagnostic only: actual handlers, local category bytes, synthetic GitHub responses.
// No real credentials, network calls, writes to GitHub, or simulated timing claims.
const env = {
  CMS_ORIGIN: 'https://blog.test', GITHUB_CLIENT_ID: 'client',
  GITHUB_CLIENT_SECRET: 'secret', CMS_SESSION_KEY: 'k'.repeat(32),
  GITHUB_ADMIN_USER_ID: '42', GITHUB_APP_ID: '11',
  GITHUB_INSTALLATION_ID: '12', GITHUB_APP_REPOSITORY_ID: '13',
  GITHUB_CONTENT_REPOSITORY_ID: '14', GITHUB_APP_BRANCH: 'main',
  GITHUB_CONTENT_BRANCH: 'main',
};
const config = loadConfig(env);
const cookie = setCookie(seal({
  token: 'diagnostic-only', csrfToken: 'csrf', expires: Date.now() + 60000,
}, config), config).split(';')[0];
const categories = readFileSync(new URL('../../../content/categories.json', import.meta.url));
const head = 'a'.repeat(40);
const tree = 'b'.repeat(40);
const blob = 'c'.repeat(40);
let calls = [];
let active = 0;
let maxActive = 0;
const fetcher = async (url, options) => {
  assert.equal(options.method, 'GET', 'Diagnostic must remain read-only');
  const path = new URL(url).pathname;
  calls.push(path);
  maxActive = Math.max(maxActive, ++active);
  await new Promise(resolve => setImmediate(resolve));
  active--;
  let value;
  if (path === '/user') value = { id: 42, login: 'owner' };
  else if (path === '/user/installations') value = { installations: [{
    id: 12, app_id: 11, permissions: { contents: 'write', metadata: 'read' },
  }] };
  else if (path === '/user/installations/12/repositories') value = { repositories: [{ id: 13 }, { id: 14 }] };
  else if (path.endsWith('/branches/main')) value = { commit: { sha: head } };
  else if (path.endsWith('/contents/content')) value = {
    type: 'submodule', sha: head,
    submodule_git_url: 'https://github.com/gyungsubLee/subdev-blog-content.git',
  };
  else if (path.endsWith('/contents/.gitmodules')) value = { content: Buffer.from(
    '[submodule "content"]\n path = content\n url = https://github.com/gyungsubLee/subdev-blog-content.git\n',
  ).toString('base64') };
  else if (path.includes('/contents/')) value = { type: 'file' };
  else if (path.endsWith('/git/ref/heads/main')) value = { object: { sha: head } };
  else if (path.endsWith('/git/commits/' + head)) value = { tree: { sha: tree } };
  else if (path.endsWith('/git/trees/' + tree)) value = { truncated: false, tree: [
    { path: 'categories.json', type: 'blob', mode: '100644', sha: blob },
  ] };
  else if (path.endsWith('/git/blobs/' + blob)) value = { encoding: 'base64', content: categories.toString('base64') };
  else if (path === '/repos/gyungsubLee/subdev-blog') value = { id: 13, default_branch: 'main', permissions: { push: true } };
  else if (path === '/repos/gyungsubLee/subdev-blog-content') value = { id: 14, permissions: { push: true } };
  else throw new Error('Unexpected request: ' + path);
  return Response.json(value);
};

const runs = [];
for (const [path, expectedCalls] of [
  ['/api/session', 12],
  ['/api/content?kind=categories', 16],
  ['/api/content?kind=categories', 16],
]) {
  calls = [];
  maxActive = 0;
  const response = await handleRequest(new Request(env.CMS_ORIGIN + path, { headers: { cookie } }), { env, fetcher });
  const value = await response.json();
  assert.equal(response.status, 200);
  assert.equal(calls.length, expectedCalls);
  assert.equal(maxActive, 1, 'GitHub requests currently execute sequentially');
  if (path === '/api/session') assert.equal(value.state, 'ready');
  else {
    assert.equal(value.categories.length, JSON.parse(categories).length);
    assert.equal(value.revision, createHash('sha256').update(categories).digest('hex'));
  }
  runs.push({ path, githubRequests: calls.length, maxConcurrent: maxActive, calls });
}
const files = ['server/handler.mjs', 'server/auth.mjs', 'server/content.mjs', 'server/github.mjs',
  'src/features/content-management/ManagedCategories.tsx', 'src/features/content-management/useManagement.ts'];
console.log(JSON.stringify({
  mode: 'Actual handlers with mocked GitHub; not production latency',
  categoryCount: JSON.parse(categories).length,
  categoryBytes: categories.length,
  node: process.version,
  sourceHashes: Object.fromEntries(files.map(file => [file, createHash('sha256').update(
    readFileSync(new URL('../../../' + file, import.meta.url)),
  ).digest('hex')])),
  runs,
}, null, 2));
