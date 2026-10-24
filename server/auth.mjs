import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createGitHubClient, httpError } from './github.mjs';

export function loadConfig(env = process.env) {
  const config = {
    origin: env.CMS_ORIGIN,
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    sessionKey: env.CMS_SESSION_KEY,
    adminUserId: Number(env.GITHUB_ADMIN_USER_ID),
    appId: Number(env.GITHUB_APP_ID),
    installationId: Number(env.GITHUB_INSTALLATION_ID),
    workflow: 'publish-content.yml',
    app: {
      owner: 'gyungsubLee',
      repo: 'subdev-blog',
      id: Number(env.GITHUB_APP_REPOSITORY_ID),
      branch: env.GITHUB_APP_BRANCH,
    },
    content: {
      owner: 'gyungsubLee',
      repo: 'subdev-blog-content',
      id: Number(env.GITHUB_CONTENT_REPOSITORY_ID),
      branch: env.GITHUB_CONTENT_BRANCH,
    },
  };
  const requiredIds = [config.adminUserId, config.appId, config.installationId, config.app.id, config.content.id];
  const hasValidIds = requiredIds.every(id => Number.isSafeInteger(id) && id > 0);
  const hasCredentials = config.clientId && config.clientSecret && config.sessionKey?.length >= 32;
  if (!config.origin || !hasCredentials || !hasValidIds || !config.app.branch || !config.content.branch) {
    throw httpError(503, 'Management configuration is incomplete');
  }
  const origin = new URL(config.origin);
  if (origin.origin !== config.origin || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname))) {
    throw httpError(503, 'Management configuration is invalid');
  }
  return config;
}

export function cookieName(config, purpose = 'session') {
  return `${config.origin.startsWith('https:') ? '__Host-' : ''}cms_${purpose}`;
}
export function seal(value, config) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(config.sessionKey).digest(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}
export function readCookie(request, config, purpose = 'session') {
  try {
    const name = cookieName(config, purpose);
    const raw = request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!raw) {
      throw new Error();
    }
    const bytes = Buffer.from(raw, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', createHash('sha256').update(config.sessionKey).digest(), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString());
    if (!Number.isFinite(value.expires) || value.expires <= Date.now()) {
      throw new Error();
    }
    return value;
  } catch {
    throw httpError(401, 'Session is missing or expired');
  }
}
export function setCookie(value, config, purpose = 'session', maxAge = 3600) {
  return `${cookieName(config, purpose)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.origin.startsWith('https:') ? '; Secure' : ''}`;
}
export function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export async function authenticate(request, config, fetcher, { mutate = false } = {}) {
  const session = readCookie(request, config);
  if (!session.token || !session.csrfToken) {
    throw httpError(401, 'Invalid session');
  }
  const user = await createGitHubClient(session.token, fetcher)('/user');
  if (user.id !== config.adminUserId) {
    throw httpError(403, 'Owner access required');
  }
  const hasExpectedOrigin = request.headers.get('origin') === config.origin;
  const hasCsrfToken = equalSecret(request.headers.get('x-csrf-token'), session.csrfToken);
  if (mutate && (!hasExpectedOrigin || !hasCsrfToken)) {
    throw httpError(403, 'Invalid request origin or CSRF token');
  }
  return {
    token: session.token,
    user: { id: user.id, login: user.login, name: user.name },
    csrfToken: session.csrfToken,
  };
}

export async function checkConnection(token, config, fetcher) {
  const github = createGitHubClient(token, fetcher);
  const installation = await github(`/user/installations/${config.installationId}/repositories`);
  const installations = await github('/user/installations');
  const app = installations.installations?.find(item => item.id === config.installationId);
  const allowedPermissions = { contents: 'write', actions: 'write', metadata: 'read' };
  const permissions = app?.permissions || {};
  const hasRequiredPermissions = permissions.contents === 'write' && permissions.actions === 'write';
  const hasExcessPermissions = Object.entries(permissions).some(([name, level]) => allowedPermissions[name] !== level);
  if (!app || app.app_id !== config.appId || app.suspended_at || !hasRequiredPermissions || hasExcessPermissions) {
    throw httpError(403, 'GitHub App installation is not ready');
  }

  const expectedRepositoryIds = new Set([config.app.id, config.content.id]);
  const selectedRepositories = installation.repositories || [];
  const hasExactSelection = selectedRepositories.length === 2 &&
    new Set(selectedRepositories.map(repository => repository.id)).size === 2 &&
    selectedRepositories.every(repository => expectedRepositoryIds.has(repository.id));
  if (app.repository_selection === 'all' || !hasExactSelection ||
      (installation.total_count !== undefined && installation.total_count !== 2)) {
    throw httpError(403, 'GitHub App must select exactly the two configured repositories');
  }
  const heads = [];
  for (const repository of [config.app, config.content]) {
    if (!installation.repositories?.some(item => item.id === repository.id)) {
      throw httpError(403, 'Repository is outside the installation');
    }
    const base = `/repos/${repository.owner}/${repository.repo}`;
    const info = await github(base);
    if (info.id !== repository.id || info.archived || info.disabled || !info.permissions?.push) {
      throw httpError(403, 'Repository is not writable');
    }
    if (repository === config.app && repository.branch !== info.default_branch) {
      throw httpError(403, 'Publishing requires the app repository default branch');
    }
    const branch = await github(`${base}/branches/${encodeURIComponent(repository.branch)}`);
    heads.push(branch.commit.sha);
  }
  const appBase = `/repos/${config.app.owner}/${config.app.repo}`;
  const contentBase = `/repos/${config.content.owner}/${config.content.repo}`;
  const gitlink = await github(`${appBase}/contents/content?ref=${heads[0]}`);
  const modules = await github(`${appBase}/contents/.gitmodules?ref=${heads[0]}`);
  const moduleText = Buffer.from(modules.content || '', 'base64').toString();
  const contentModule = moduleText.split(/(?=^\s*\[)/m).find(section => /^\s*\[submodule \"content\"\]/.test(section));
  const hasContentPath = contentModule && /^\s*path\s*=\s*content\s*$/m.test(contentModule);
  const expectedUrl = 'https://github.com/gyungsubLee/subdev-blog-content.git';
  const hasContentUrl = contentModule && /^\s*url\s*=\s*https:\/\/github\.com\/gyungsubLee\/subdev-blog-content\.git\s*$/m.test(contentModule);
  const hasSubmoduleType = ['submodule', 'file'].includes(gitlink.type);
  if (!hasSubmoduleType || !hasContentPath || !hasContentUrl || gitlink.submodule_git_url !== expectedUrl) {
    throw httpError(403, 'Content submodule configuration is invalid');
  }
  for (const path of ['categories.json', 'posts', 'CONTENT_SCHEMA.md']) {
    await github(`${contentBase}/contents/${path}?ref=${heads[1]}`);
  }
  const workflow = await github(`${appBase}/actions/workflows/${config.workflow}`);
  if (workflow.state !== 'active') {
    throw httpError(403, 'Publishing workflow is inactive');
  }
  await github(`${appBase}/contents/.github/workflows/${config.workflow}?ref=${heads[0]}`);
  return {
    repository: `${config.content.owner}/${config.content.repo}`,
    branch: config.content.branch,
    contentCommit: heads[1],
    appContentCommit: gitlink.sha,
    appCommit: heads[0],
  };
}
