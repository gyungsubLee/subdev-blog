import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, seal, setCookie } from '../../app/server/src/auth.mjs';

export function createManagementCategoryFixture({ latencyMs = 0, categories, recursiveEntries = [] } = {}) {
  const env = {
    CMS_ORIGIN: 'https://blog.test', GITHUB_CLIENT_ID: 'client', GITHUB_CLIENT_SECRET: 'secret',
    CMS_SESSION_KEY: 'k'.repeat(32), GITHUB_ADMIN_USER_ID: '42', GITHUB_APP_ID: '11',
    GITHUB_INSTALLATION_ID: '12', GITHUB_APP_REPOSITORY_ID: '13',
    GITHUB_CONTENT_REPOSITORY_ID: '14', GITHUB_APP_BRANCH: 'main', GITHUB_CONTENT_BRANCH: 'main',
  };
  const config = loadConfig(env);
  const headers = { cookie: setCookie(seal({
    token: 'diagnostic-only', csrfToken: 'csrf', expires: Date.now() + 60000,
  }, config), config).split(';')[0] };
  const controls = { head: 'a'.repeat(40), userId: 42, push: true, suspended: false, mode: '100644' };
  const calls = [];
  let active = 0;
  let maxActive = 0;
  const source = categories ?? [{ id: 'group:unclassified', name: 'Other', parent_id: null, order: 0, sources: [] }];
  const bytes = Buffer.from(JSON.stringify(source));
  const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const fetcher = async (url, options = {}) => {
    if ((options.method ?? 'GET') !== 'GET') throw new Error('Read fixture received a mutation');
    const parsed = new URL(url);
    const path = parsed.pathname;
    const call = { path: path + parsed.search, start: performance.now() };
    calls.push(call);
    maxActive = Math.max(maxActive, ++active);
    try {
      if (latencyMs) await delay(latencyMs);
      else await new Promise(resolve => setImmediate(resolve));
      let value;
      if (path === '/user') value = { id: controls.userId, login: 'owner' };
      else if (path === '/user/installations') value = { installations: [{
        id: 12, app_id: 11, suspended_at: controls.suspended ? 'now' : null,
        permissions: { contents: 'write', metadata: 'read' },
      }] };
      else if (path === '/user/installations/12/repositories') value = { repositories: [{ id: 13 }, { id: 14 }] };
      else if (path.endsWith('/branches/main')) value = { commit: { sha: path.includes('subdev-blog-content') ? controls.head : '1'.repeat(40) } };
      else if (path.endsWith('/contents/content')) value = {
        type: 'submodule', sha: controls.head,
        submodule_git_url: 'https://github.com/gyungsubLee/subdev-blog-content.git',
      };
      else if (path.endsWith('/contents/.gitmodules')) value = { content: Buffer.from(
        '[submodule "content"]\n path = content\n url = https://github.com/gyungsubLee/subdev-blog-content.git\n',
      ).toString('base64') };
      else if (path.includes('/contents/')) value = { type: 'file', sha: blobSha, encoding: 'base64', content: bytes.toString('base64') };
      else if (path.endsWith('/git/ref/heads/main')) value = { object: { sha: controls.head } };
      else if (path.includes('/git/commits/')) value = { tree: { sha: path.endsWith('a'.repeat(40)) ? 'b'.repeat(40) : 'e'.repeat(40) } };
      else if (path.includes('/git/trees/')) value = { truncated: false, tree: [
        { path: 'categories.json', type: 'blob', mode: controls.mode, sha: blobSha },
        ...(parsed.searchParams.has('recursive') ? recursiveEntries : []),
      ] };
      else if (path.endsWith('/git/blobs/' + blobSha)) value = { encoding: 'base64', content: bytes.toString('base64'), size: bytes.length };
      else if (path === '/repos/gyungsubLee/subdev-blog') value = { id: 13, default_branch: 'main', permissions: { push: controls.push } };
      else if (path === '/repos/gyungsubLee/subdev-blog-content') value = { id: 14, permissions: { push: controls.push } };
      else throw new Error('Unexpected request: ' + path);
      return Response.json(value);
    } finally {
      active--;
      call.end = performance.now();
    }
  };
  return {
    env, headers, controls, calls, fetcher, source,
    request(path = '/api/content?kind=categories') { return new Request(env.CMS_ORIGIN + path, { headers }); },
    reset() { calls.length = 0; maxActive = 0; },
    get maxActive() { return maxActive; },
  };
}
