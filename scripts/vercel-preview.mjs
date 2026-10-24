import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function requestVercel({ token, orgId, projectId, fetcher = globalThis.fetch }, pathname, { method = 'GET', body } = {}) {
  if (!token || !/^team_[a-zA-Z0-9]+$/.test(orgId) || !/^prj_[a-zA-Z0-9]+$/.test(projectId)) {
    throw new Error('Invalid Vercel configuration');
  }
  const url = new URL(pathname, 'https://api.vercel.com');
  url.searchParams.set('teamId', orgId);
  const signal = AbortSignal.timeout(10_000);
  let response;
  try {
    response = await fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
  } catch {
    throw new Error('Vercel request failed (code network)');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Vercel request failed (HTTP ${response.status}; code ${signal.aborted ? 'timeout' : 'invalid_json'})`);
  }
  if (!response.ok) {
    const knownCodes = ['forbidden', 'team_unauthorized', 'not_found', 'unauthorized', 'invalid_token', 'invalid_request', 'alias_in_use', 'too_many_requests'];
    const code = knownCodes.includes(data?.error?.code) ? data.error.code : 'unknown';
    throw new Error(`Vercel request failed (HTTP ${response.status}; code ${code})`);
  }
  return data;
}

export async function preparePreview(options) {
  const { projectId, orgId, root = process.cwd() } = options;
  const project = await requestVercel(options, `/v9/projects/${encodeURIComponent(projectId)}`);
  if (project?.id !== projectId || project.accountId !== orgId || typeof project.name !== 'string') {
    throw new Error('Vercel project identity mismatch');
  }
  const settings = {};
  for (const key of ['createdAt', 'framework', 'devCommand', 'installCommand', 'buildCommand', 'outputDirectory', 'rootDirectory', 'directoryListing', 'nodeVersion']) {
    settings[key] = project[key];
  }
  const directory = path.join(root, '.vercel');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'project.json'), JSON.stringify({
    projectId,
    orgId,
    projectName: project.name,
    settings,
  }, null, 2) + '\n', { mode: 0o600 });
}

export async function assignPreviewAlias(options) {
  const { deploymentUrl, alias } = options;
  if (!/^subdev-blog-cms-[a-z0-9-]+\.vercel\.app$/.test(alias)) {
    throw new Error('Invalid CMS preview alias');
  }
  let deployment;
  try {
    deployment = new URL(deploymentUrl);
  } catch {
    throw new Error('Invalid preview deployment URL');
  }
  if (deployment.protocol !== 'https:' || !deployment.hostname.endsWith('.vercel.app') ||
      deployment.username || deployment.password || deployment.port || deployment.pathname !== '/' ||
      deployment.search || deployment.hash) {
    throw new Error('Invalid preview deployment URL');
  }
  const result = await requestVercel(options, `/v2/deployments/${encodeURIComponent(deployment.hostname)}/aliases`, {
    method: 'POST',
    body: { alias },
  });
  if (result?.alias !== alias) throw new Error('Vercel alias response mismatch');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = {
    token: process.env.VERCEL_TOKEN,
    orgId: process.env.VERCEL_ORG_ID,
    projectId: process.env.VERCEL_PROJECT_ID,
    deploymentUrl: process.env.PREVIEW_URL,
    alias: process.env.CMS_PREVIEW_ALIAS,
  };
  try {
    if (process.argv[2] === 'prepare') {
      await preparePreview(options);
      console.log('Vercel preview project settings prepared');
    } else if (process.argv[2] === 'alias') {
      await assignPreviewAlias(options);
      console.log('Vercel preview alias assigned');
    } else {
      throw new Error('Expected prepare or alias');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
