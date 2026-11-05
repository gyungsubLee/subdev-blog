import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');

test('deployment includes the server catalog without static content preparation', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'package.json')));
  assert.ok(!manifest.scripts.prebuild.includes('export-static'));
  assert.ok(!manifest.scripts.predev.includes('export-static'));
  const deployment = JSON.parse(await readFile(path.join(root, 'vercel.json')));
  assert.equal(deployment.outputDirectory, 'dist/web');
  assert.equal(deployment.functions['api/index.js'].includeFiles,
    'app/server/generated/content-catalog.json');
});

test('normal content preparation emits only a server catalog and preserves existing assets', async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'structure-catalog-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const id = '12345678-1234-8234-9234-123456789012';
  const post = path.join(cwd, 'content/posts', id);
  await mkdir(post, { recursive: true });
  await writeFile(path.join(cwd, 'content/categories.json'), '[]');
  await writeFile(path.join(post, 'Title.md'), `---\nschema_version: 1\nid: ${id}\ntitle: Title\nparent_id: null\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n![asset](./image.webp)`);
  await writeFile(path.join(post, 'image.webp'), 'ORIGINAL_ASSET');
  const publicDir = path.join(cwd, 'app/web/public');
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(publicDir, 'keep.txt'), 'KEEP');
  const env = { ...process.env, CONTENT_ROOT: path.join(cwd, 'content') };
  for (const name of ['CI', 'VERCEL', 'GITHUB_ACTIONS', 'GITHUB_SHA', 'VERCEL_GIT_COMMIT_SHA']) delete env[name];
  const result = spawnSync(process.execPath, [path.join(root, 'app/server/scripts/prepare-content.mjs')], {
    cwd, env, encoding: 'utf8', timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr?.slice(-2000));
  const catalog = JSON.parse(await readFile(path.join(cwd, 'app/server/generated/content-catalog.json')));
  assert.equal(catalog.documents.length, 1);
  assert.equal(catalog.documents[0].assets[0].name, 'image.webp');
  assert.ok(!existsSync(path.join(publicDir, 'content')), 'Normal preparation must not copy posts or attachments');
  assert.equal(await readFile(path.join(publicDir, 'keep.txt'), 'utf8'), 'KEEP');
  assert.equal(await readFile(path.join(post, 'image.webp'), 'utf8'), 'ORIGINAL_ASSET');
});
