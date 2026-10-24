import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { preparePreview, assignPreviewAlias } from '../scripts/vercel-preview.mjs';

const credentials = { token: 'private-test-token', orgId: 'team_test', projectId: 'prj_test' };
const project = {
  id: 'prj_test', accountId: 'team_test', name: 'blog', createdAt: 123,
  framework: 'vite', devCommand: null, installCommand: null, buildCommand: 'npm run build',
  outputDirectory: 'dist', rootDirectory: null, directoryListing: false, nodeVersion: '24.x',
  env: [{ key: 'PRIVATE_KEY', value: 'must-not-be-written' }],
};
async function directory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vercel-preview-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('prepare writes only CLI project settings through the project-scoped endpoint', async t => {
  const root = await directory(t);
  const calls = [];
  await preparePreview({ ...credentials, root, fetcher: async (address, options) => {
    calls.push(String(address));
    assert.equal(options.headers.Authorization, 'Bearer private-test-token');
    assert.ok(options.signal instanceof AbortSignal, 'HTTP request must have a deadline');
    return Response.json(project);
  } });
  assert.deepEqual(calls, ['https://api.vercel.com/v9/projects/prj_test?teamId=team_test']);
  const settings = JSON.parse(await readFile(path.join(root, '.vercel', 'project.json'), 'utf8'));
  assert.deepEqual(settings, {
    projectId: 'prj_test', orgId: 'team_test', projectName: 'blog',
    settings: {
      createdAt: 123, framework: 'vite', devCommand: null, installCommand: null,
      buildCommand: 'npm run build', outputDirectory: 'dist', rootDirectory: null,
      directoryListing: false, nodeVersion: '24.x',
    },
  });
});

test('prepare refuses another project or owner before writing settings', async t => {
  const root = await directory(t);
  for (const change of [{ id: 'prj_other' }, { accountId: 'team_other' }]) {
    await assert.rejects(preparePreview({ ...credentials, root, fetcher: async () => Response.json({ ...project, ...change }) }), /identity/i);
  }
  await assert.rejects(readFile(path.join(root, '.vercel', 'project.json')), { code: 'ENOENT' });
});

test('alias uses the deployment-scoped REST endpoint and refuses unsafe targets before HTTP', async () => {
  const calls = [];
  const fetcher = async (address, options) => {
    calls.push({ address: String(address), method: options.method, body: JSON.parse(options.body) });
    return Response.json({ alias: 'subdev-blog-cms-owner.vercel.app' });
  };
  await assignPreviewAlias({ ...credentials, deploymentUrl: 'https://blog-immutable.vercel.app', alias: 'subdev-blog-cms-owner.vercel.app', fetcher });
  assert.deepEqual(calls, [{ address: 'https://api.vercel.com/v2/deployments/blog-immutable.vercel.app/aliases?teamId=team_test', method: 'POST', body: { alias: 'subdev-blog-cms-owner.vercel.app' } }]);
  for (const change of [
    { deploymentUrl: 'http://blog.vercel.app' },
    { deploymentUrl: 'https://blog.vercel.app.evil.test' },
    { deploymentUrl: 'https://user:password@blog.vercel.app' },
    { deploymentUrl: 'https://blog.vercel.app/path' },
    { alias: 'blog.vercel.app' },
  ]) {
    await assert.rejects(assignPreviewAlias({ ...credentials, deploymentUrl: 'https://blog-immutable.vercel.app', alias: 'subdev-blog-cms-owner.vercel.app', ...change, fetcher }), /invalid/i);
  }
  assert.equal(calls.length, 1, 'Unsafe targets must not reach the API');
});

test('Vercel API failures expose bounded status and code without response secrets', async t => {
  const root = await directory(t);
  await assert.rejects(preparePreview({ ...credentials, root, fetcher: async () => Response.json({ error: { code: 'forbidden', message: 'private-test-token must-not-be-logged' } }, { status: 403 }) }), error => {
    assert.ok(error.message.includes('403') && error.message.includes('forbidden'));
    assert.ok(!error.message.includes('private-test-token') && !error.message.includes('must-not-be-logged'));
    assert.ok(error.message.length < 160);
    return true;
  });
  await assert.rejects(preparePreview({ ...credentials, root, fetcher: async () => { throw Error('private-test-token'); } }), error => !error.message.includes('private-test-token'));
});
