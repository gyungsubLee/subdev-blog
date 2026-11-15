import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { readWorkflowIdentity, promoteMain } from '../../scripts/deploy-main.mjs';

const repo = 'gyungsubLee/subdev-blog';
const alias = 'subdev-blog-cms-gyungsublee.vercel.app';
const candidate = 'https://blog-test.vercel.app';
const contentCommit = 'b'.repeat(40);
const credentials = { token: 'private-vercel', githubToken: 'private-github', orgId: 'team_test', projectId: 'prj_test', alias, deploymentUrl: candidate };
function environment(commit = 'a'.repeat(40)) {
  return { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repo, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: commit,
    GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/deploy-main.yml@refs/heads/main`,
    GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_WORKFLOW: 'Deploy main' };
}
function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 }).trim();
}
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'main-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'user.email', 'test@example.com');
  await writeFile(path.join(root, '.gitignore'), '.vercel/\n');
  await writeFile(path.join(root, 'README.md'), 'Source\n');
  git(root, 'add', '.');
  git(root, 'update-index', '--add', '--cacheinfo', `160000,${contentCommit},content`);
  git(root, 'commit', '-m', 'source');
  const commit = git(root, 'rev-parse', 'HEAD');
  const env = environment(commit);
  const info = { version: '0.2.1', commit, contentCommit, runId: '123', runAttempt: '1', workflow: 'Deploy main' };
  const output = path.join(root, '.vercel/output/static');
  await mkdir(path.join(output, 'assets'), { recursive: true });
  await writeFile(path.join(output, 'build-info.json'), JSON.stringify(info));
  await writeFile(path.join(output, 'index.html'), '<script type="module" src="/assets/index-test.js"></script>');
  await writeFile(path.join(output, 'assets/index-test.js'), 'console.log("tested");');
  return { root, env, info, commit, output };
}
function backend(f, changes = {}) {
  const calls = [];
  let headReads = 0;
  const fetcher = async (address, options = {}) => {
    const url = new URL(address);
    calls.push({ address: String(url), method: options.method ?? 'GET' });
    assert.ok(options.signal instanceof AbortSignal, 'Every network operation needs a deadline');
    if (url.hostname === 'api.github.com') {
      assert.equal(options.headers.Authorization, 'Bearer private-github');
      return Response.json({ object: { sha: (changes.heads ?? [f.commit])[Math.min(headReads++, (changes.heads ?? [f.commit]).length - 1)] } });
    }
    if (url.hostname === 'api.vercel.com') {
      assert.equal(options.headers.Authorization, 'Bearer private-vercel');
      if (url.pathname.endsWith('/aliases')) {
        assert.equal(JSON.parse(options.body).alias, alias);
        return Response.json({ alias });
      }
      if (changes.apiError) return Response.json({ error: { code: 'forbidden', message: 'private-vercel must not leak' } }, { status: 403 });
      return Response.json({ projectId: 'prj_test', readyState: 'READY',
        meta: { githubCommitSha: f.commit, githubActionsRunId: '123', githubActionsRunAttempt: '1' }, ...changes.deployment });
    }
    assert.ok(!options.headers?.Authorization, 'Public health reads must not receive credentials');
    if (url.pathname === '/build-info.json') return Response.json({ ...f.info, ...changes.info });
    if (url.pathname === '/api/public') return Response.json(changes.listing ?? { posts: [{ id: 'first' }], categories: [] });
    if (url.pathname === '/assets/index-test.js' && changes.assetMismatch) return new Response('old asset');
    return new Response(await readFile(path.join(f.output, url.pathname === '/' ? 'index.html' : url.pathname.slice(1))));
  };
  return { fetcher, calls, writes: () => calls.filter(c => c.method === 'POST').length };
}

test('only the main deployment workflow can request operational promotion', () => {
  assert.equal(readWorkflowIdentity(environment()).commit, 'a'.repeat(40));
  for (const change of [{ GITHUB_ACTIONS: 'false' }, { GITHUB_REF: 'refs/heads/old' }, { GITHUB_EVENT_NAME: 'pull_request' },
    { GITHUB_REPOSITORY: 'other/repo' }, { GITHUB_WORKFLOW_REF: `${repo}/.github/workflows/publish-content.yml@refs/heads/main` },
    { GITHUB_SHA: 'bad' }, { GITHUB_RUN_ID: '' }]) {
    assert.throws(() => readWorkflowIdentity({ ...environment(), ...change }), /workflow|main|commit|run/i);
  }
});

test('a verified current main deployment alone may change the production alias', async t => {
  const f = await fixture(t); const api = backend(f);
  const result = await promoteMain({ ...credentials, ...f, fetcher: api.fetcher });
  assert.equal(result.state, 'deployed');
  assert.equal(api.writes(), 1);
  assert.equal(api.calls.filter(c => c.address.startsWith('https://api.github.com/')).length, 2);
  assert.equal(api.calls.at(-1).address, `https://${alias}/build-info.json`);
});

test('older main and a head advancing during health checks never move the alias', async t => {
  const f = await fixture(t);
  for (const heads of [['c'.repeat(40)], [f.commit, 'c'.repeat(40)]]) {
    const api = backend(f, { heads });
    assert.equal((await promoteMain({ ...credentials, ...f, fetcher: api.fetcher })).state, 'superseded');
    assert.equal(api.writes(), 0);
  }
});

test('wrong projects, run metadata, remote identity, assets and unhealthy APIs cannot promote', async t => {
  const f = await fixture(t);
  for (const change of [
    { deployment: { projectId: 'prj_other' } }, { deployment: { readyState: 'BUILDING' } },
    { deployment: { meta: { githubCommitSha: f.commit, githubActionsRunId: 'old', githubActionsRunAttempt: '1' } } },
    { info: { commit: 'd'.repeat(40) } }, { info: { contentCommit: 'e'.repeat(40) } },
    { info: { runAttempt: '2' } }, { assetMismatch: true }, { listing: { posts: [], categories: [] } }, { apiError: true },
  ]) {
    const api = backend(f, change);
    await assert.rejects(promoteMain({ ...credentials, ...f, fetcher: api.fetcher }), error => {
      assert.ok(error.message.length < 200);
      assert.ok(!error.message.includes('private-'));
      return true;
    });
    assert.equal(api.writes(), 0);
  }
});

test('uncommitted source, a different checkout and a different local build are rejected', async t => {
  const f = await fixture(t); const api = backend(f);
  await writeFile(path.join(f.root, 'README.md'), 'Uncommitted override');
  await assert.rejects(promoteMain({ ...credentials, ...f, fetcher: api.fetcher }), /clean|uncommitted/i);
  git(f.root, 'checkout', '--', 'README.md');
  await assert.rejects(promoteMain({ ...credentials, ...f, env: environment('a'.repeat(40)), fetcher: api.fetcher }), /checkout|commit/i);
  await writeFile(path.join(f.output, 'build-info.json'), JSON.stringify({ ...f.info, runId: 'other' }));
  await assert.rejects(promoteMain({ ...credentials, ...f, fetcher: api.fetcher }), /identity|build/i);
  assert.equal(api.writes(), 0);
});

test('main push pins checkout and gates a serialized deployment on all existing checks', async () => {
  const workflow = YAML.parse(await readFile(new URL('../../.github/workflows/deploy-main.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const job = workflow.jobs.deploy;
  assert.equal(job.environment.name, 'production');
  const steps = job.steps;
  assert.equal(steps.find(s => s.uses?.startsWith('actions/checkout@')).with.ref, '${{ github.sha }}');
  const checks = steps.findIndex(s => s.run?.includes('npm run check\n'));
  const build = steps.findIndex(s => s.run?.includes('vercel@58.1.0 build'));
  const deploy = steps.findIndex(s => s.run?.includes('vercel@58.1.0 deploy'));
  const promote = steps.findIndex(s => s.run?.includes('node scripts/deploy-main.mjs promote'));
  assert.ok(build >= 0 && build < checks && checks < deploy && deploy < promote);
  assert.ok(steps[checks].run.includes('npm run check:content'));
  assert.ok(!steps[deploy].run.includes('--prod'));
  assert.ok(!JSON.stringify(steps).includes('always()'));
});
