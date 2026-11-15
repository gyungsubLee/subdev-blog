import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requestVercel } from './vercel-preview.mjs';

const repository = 'gyungsubLee/subdev-blog';
const workflowRef = `${repository}/.github/workflows/deploy-main.yml@refs/heads/main`;

export function readWorkflowIdentity(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository ||
      env.GITHUB_REF !== 'refs/heads/main' || env.GITHUB_WORKFLOW_REF !== workflowRef ||
      !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) {
    throw new Error('Only the main deployment workflow may promote the operational alias');
  }
  if (!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw new Error('Invalid workflow commit');
  if (!/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) {
    throw new Error('Invalid workflow run identity');
  }
  return { commit: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, workflow: env.GITHUB_WORKFLOW };
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000, maxBuffer: 1024 * 1024,
  }).trim();
}

function checkSource(root, identity) {
  if (git(root, 'rev-parse', 'HEAD') !== identity.commit) throw new Error('Checkout commit differs from workflow commit');
  if (git(root, 'status', '--porcelain=v1', '--untracked-files=all', '--ignore-submodules=all')) {
    throw new Error('Deployment source must be clean; uncommitted files are not permitted');
  }
}

async function currentMain({ githubToken, fetcher = globalThis.fetch }) {
  if (!githubToken) throw new Error('GitHub read token is required');
  let response;
  try {
    response = await fetcher(`https://api.github.com/repos/${repository}/git/ref/heads/main`, {
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!/^[a-f0-9]{40}$/.test(data.object?.sha ?? '')) throw new Error();
    return data.object.sha;
  } catch {
    throw new Error(`Cannot verify current main (HTTP ${response?.status ?? 'network'})`);
  }
}

function checkIdentity(actual, expected) {
  for (const key of ['version', 'commit', 'contentCommit', 'runId', 'runAttempt', 'workflow']) {
    if (actual?.[key] !== expected[key]) throw new Error(`Build identity mismatch: ${key}`);
  }
}

async function publicBytes(address, fetcher) {
  let response;
  try {
    response = await fetcher(address, { signal: AbortSignal.timeout(20_000), cache: 'no-store' });
    if (!response.ok) throw new Error();
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error(`Deployment health check failed (HTTP ${response?.status ?? 'network'})`);
  }
}

async function publicJson(address, fetcher) {
  try {
    return JSON.parse((await publicBytes(address, fetcher)).toString('utf8'));
  } catch (error) {
    if (error.message.startsWith('Deployment health check failed')) throw error;
    throw new Error('Deployment health check returned invalid JSON');
  }
}

export async function promoteMain(options) {
  const { env = process.env, root = process.cwd(), alias, deploymentUrl, fetcher = globalThis.fetch } = options;
  const identity = readWorkflowIdentity(env);
  checkSource(root, identity);
  if (await currentMain(options) !== identity.commit) return { state: 'superseded' };
  if (!/^subdev-blog-cms-[a-z0-9-]+\.vercel\.app$/.test(alias ?? '')) throw new Error('Invalid operational alias');
  let url;
  try { url = new URL(deploymentUrl); } catch { throw new Error('Invalid deployment URL'); }
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app') || url.username || url.password ||
      url.port || url.pathname !== '/' || url.search || url.hash || url.hostname === alias) {
    throw new Error('Invalid deployment URL');
  }
  const output = path.join(root, '.vercel/output/static');
  const local = JSON.parse(await readFile(path.join(output, 'build-info.json'), 'utf8'));
  const expected = { ...identity, version: local.version, contentCommit: git(root, 'rev-parse', 'HEAD:content') };
  checkIdentity(local, expected);
  const deployment = await requestVercel(options, `/v13/deployments/${encodeURIComponent(url.hostname)}`);
  if (deployment.projectId !== options.projectId || deployment.readyState !== 'READY' ||
      deployment.meta?.githubCommitSha !== identity.commit || deployment.meta?.githubActionsRunId !== identity.runId ||
      deployment.meta?.githubActionsRunAttempt !== identity.runAttempt) {
    throw new Error('Deployment project, readiness or workflow metadata mismatch');
  }
  checkIdentity(await publicJson(new URL('/build-info.json', url), fetcher), expected);
  const html = await readFile(path.join(output, 'index.html'), 'utf8');
  const entry = html.match(/<script\b[^>]*\bsrc="(\/assets\/[\w.-]+\.js)"/)?.[1];
  if (!entry || !(await publicBytes(url, fetcher)).toString('utf8').includes(entry)) {
    throw new Error('Deployment entrypoint mismatch');
  }
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  if (digest(await publicBytes(new URL(entry, url), fetcher)) !== digest(await readFile(path.join(output, entry.slice(1))))) {
    throw new Error('Deployment JavaScript asset mismatch');
  }
  const listing = await publicJson(new URL('/api/public?kind=index', url), fetcher);
  if (!Array.isArray(listing.posts) || listing.posts.length === 0 || !Array.isArray(listing.categories)) {
    throw new Error('Deployment public API is unhealthy');
  }
  // Serialized workflow promotion plus a fresh head read prevents older runs from replacing a newer release.
  if (await currentMain(options) !== identity.commit) return { state: 'superseded' };
  const result = await requestVercel(options, `/v2/deployments/${encodeURIComponent(url.hostname)}/aliases`, {
    method: 'POST', body: { alias },
  });
  if (result?.alias !== alias) throw new Error('Operational alias response mismatch');
  checkIdentity(await publicJson(`https://${alias}/build-info.json`, fetcher), expected);
  return { state: 'deployed', commit: identity.commit, url: `https://${alias}` };
}

async function output(name, value) {
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = {
    token: process.env.VERCEL_TOKEN, orgId: process.env.VERCEL_ORG_ID, projectId: process.env.VERCEL_PROJECT_ID,
    githubToken: process.env.GH_TOKEN, alias: process.env.BLOG_PRODUCTION_ALIAS, deploymentUrl: process.env.PREVIEW_URL,
  };
  try {
    if (process.argv[2] === 'preflight') {
      const identity = readWorkflowIdentity();
      checkSource(process.cwd(), identity);
      const current = await currentMain(options) === identity.commit;
      await output('current', String(current));
      console.log(current ? `Current main: ${identity.commit}` : 'Superseded main run; deployment skipped');
    } else if (process.argv[2] === 'promote') {
      const result = await promoteMain(options);
      await output('state', result.state);
      console.log(JSON.stringify(result));
      if (process.env.GITHUB_STEP_SUMMARY) {
        await appendFile(process.env.GITHUB_STEP_SUMMARY, `Deployment: ${result.state}\n\nCommit: ${process.env.GITHUB_SHA}\n\n${result.url ?? 'A newer main commit superseded this run.'}\n`);
      }
    } else {
      throw new Error('Expected preflight or promote');
    }
  } catch (error) {
    // Never print external responses or credentials, including command diagnostics.
    console.error(error.code ? `Deployment command failed (${error.code})` : error.message);
    process.exitCode = 1;
  }
}
