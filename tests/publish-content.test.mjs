import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, chmod, symlink, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';
import { validateCandidate, promoteContent, updateAppGitlink } from '../scripts/publish-content.mjs';
import { serializeMarkdownDocument } from '../src/shared/document.mjs';
const id = '12345678-1234-8234-9234-123456789012';

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Test');
  await mkdir(path.join(root, 'posts', id), { recursive: true });
  await writeFile(path.join(root, 'categories.json'), '[]');
  await writeFile(path.join(root, 'posts', id, 'Title.md'), doc(id, 'Body\n'));
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');
  await writeFile(path.join(root, 'posts', id, 'Title.md'), doc(id, 'Changed\n'));
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'candidate');
  return { root, base, candidate: git(root, 'rev-parse', 'HEAD') };
}
test('validates real commit and rejects noncontent changes and wrong parent', async t => {
  const f = await fixture(t);
  await validateCandidate(f);
  await assert.rejects(validateCandidate({ ...f, base: f.candidate }), /parent/);
  await writeFile(path.join(f.root, 'evil.sh'), 'exit 0');
  git(f.root, 'add', '.');
  git(f.root, 'commit', '-m', 'bad');
  await assert.rejects(validateCandidate({ ...f, base: f.candidate, candidate: git(f.root, 'rev-parse', 'HEAD') }), /path/);
});

test('source promotion retries, preserves descendants and rejects divergence', async t => {
  const f = await fixture(t);
  const remote = path.join(f.root, 'remote.git');
  git(f.root, 'init', '--bare', remote);
  git(f.root, 'remote', 'add', 'origin', remote);
  git(f.root, 'push', 'origin', `${f.base}:refs/heads/main`);
  await writeFile(path.join(remote, 'hooks', 'pre-receive'), '#!/bin/sh\nif [ ! -f retry-once ]; then touch retry-once; exit 1; fi\n');
  await chmod(path.join(remote, 'hooks', 'pre-receive'), 0o755);
  assert.equal(await promoteContent({ ...f, branch: 'main' }), 'saved');
  assert.equal(await promoteContent({ ...f, branch: 'main' }), 'saved');
  await writeFile(path.join(f.root, 'categories.json'), '[ ]');
  git(f.root, 'add', 'categories.json');
  git(f.root, 'commit', '-m', 'later');
  git(f.root, 'push', 'origin', 'HEAD:main');
  assert.equal(await promoteContent({ ...f, branch: 'main' }), 'superseded');
  git(f.root, 'checkout', '-b', 'conflict', f.base);
  await writeFile(path.join(f.root, 'categories.json'), '[\n]');
  git(f.root, 'add', 'categories.json');
  git(f.root, 'commit', '-m', 'conflict');
  await assert.rejects(promoteContent({ ...f, candidate: git(f.root, 'rev-parse', 'HEAD'), branch: 'main' }), /conflict/);
});

test('app gitlink moves forward and preserves concurrent app changes', async t => {
  const f = await publicationFixture(t);
  await writeFile(path.join(f.app, 'keep.txt'), 'keep');
  git(f.app, 'add', 'keep.txt');
  git(f.app, 'commit', '-m', 'concurrent');
  git(f.app, 'push', 'origin', 'main');

  const hook = path.join(f.appRemote, 'hooks', 'pre-receive');
  await writeFile(hook, '#!/bin/sh\nif [ ! -f retry-once ]; then touch retry-once; exit 1; fi\n');
  await chmod(hook, 0o755);
  let verifications = 0;
  const verify = async () => {
    verifications++;
  };
  const options = {
    root: f.app,
    contentRoot: f.root,
    candidate: f.candidate,
    branch: 'main',
    contentBranch: 'main',
    verify,
  };
  const result = await updateAppGitlink(options);
  assert.equal(verifications, 2, 'A rejected push must reverify the new prospective commit');
  assert.equal(git(f.app, 'show', `${result.commit}:keep.txt`), 'keep');
  assert.equal(git(f.app, 'rev-parse', `${result.commit}:content`), f.candidate);
  const older = await updateAppGitlink({ ...options, candidate: f.base });
  assert.equal(older.state, 'superseded');
});

const secondId = '22345678-1234-8234-9234-123456789012';
function doc(postId, markdown, extra = {}) {
  return serializeMarkdownDocument({
    metadata: {
      schema_version: 1,
      id: postId,
      title: 'Title',
      parent_id: null,
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      ...extra,
    },
    markdown,
  });
}
test('pre-deletion snapshot blocks Notion inbound links even if candidate removes the link', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'posts', secondId));
  await writeFile(path.join(f.root, 'posts', secondId, 'Title.md'), doc(secondId, 'Delete target\n'));
  await writeFile(path.join(f.root, 'posts', id, 'Title.md'), doc(id, `[target](https://www.notion.so/Title-${secondId.replaceAll('-', '')})\n`));
  git(f.root, 'add', 'posts');
  git(f.root, 'commit', '-m', 'linked base');
  const base = git(f.root, 'rev-parse', 'HEAD');
  await rm(path.join(f.root, 'posts', secondId), { recursive: true });
  await writeFile(path.join(f.root, 'posts', id, 'Title.md'), doc(id, 'Removed link\n'));
  git(f.root, 'add', 'posts');
  git(f.root, 'commit', '-m', 'delete');
  await assert.rejects(validateCandidate({ root: f.root, base, candidate: git(f.root, 'rev-parse', 'HEAD') }), /inbound/);
});

test('rejects deleting unclassified and categories with original children or assignments', async t => {
  for (const mode of ['unclassified', 'child', 'assignment']) {
    const f = await fixture(t);
    const category = mode === 'unclassified' ? 'group:unclassified' : 'group:used';
    const categories = [{ id: category, name: 'Group', parent_id: null, order: 0, sources: [] }];
    if (mode === 'child') categories.push({ id: 'group:child', name: 'Child', parent_id: category, order: 1, sources: [] });
    await writeFile(path.join(f.root, 'categories.json'), JSON.stringify(categories));
    if (mode === 'assignment') await writeFile(path.join(f.root, 'posts', id, 'Title.md'), doc(id, 'Body\n', { category_id: category }));
    git(f.root, 'add', 'categories.json', 'posts');
    git(f.root, 'commit', '-m', 'category base');
    const base = git(f.root, 'rev-parse', 'HEAD');
    await writeFile(path.join(f.root, 'categories.json'), '[]');
    await writeFile(path.join(f.root, 'posts', id, 'Title.md'), doc(id, 'Body\n'));
    git(f.root, 'add', 'categories.json', 'posts');
    git(f.root, 'commit', '-m', 'remove category');
    await assert.rejects(validateCandidate({ root: f.root, base, candidate: git(f.root, 'rev-parse', 'HEAD') }), /category in use/);
  }
});

test('deletes a post without inbound references and rejects symbolic links', async t => {
  const f = await fixture(t);
  await mkdir(path.join(f.root, 'posts', secondId));
  await writeFile(path.join(f.root, 'posts', secondId, 'Title.md'), doc(secondId, 'Extra\n'));
  git(f.root, 'add', 'posts');
  git(f.root, 'commit', '-m', 'two posts');
  const base = git(f.root, 'rev-parse', 'HEAD');
  await rm(path.join(f.root, 'posts', secondId), { recursive: true });
  git(f.root, 'add', 'posts');
  git(f.root, 'commit', '-m', 'delete');
  assert.deepEqual((await validateCandidate({ root: f.root, base, candidate: git(f.root, 'rev-parse', 'HEAD') })).deleted, [secondId]);
  const beforeLink = git(f.root, 'rev-parse', 'HEAD');
  await symlink('/etc/passwd', path.join(f.root, 'posts', id, 'bad.png'));
  git(f.root, 'add', 'posts');
  git(f.root, 'commit', '-m', 'symlink');
  await assert.rejects(validateCandidate({ root: f.root, base: beforeLink, candidate: git(f.root, 'rev-parse', 'HEAD') }), /mode/);
});

async function publicationFixture(t) {
  const content = await fixture(t);
  const contentRemote = path.join(content.root, '.git', 'content-origin.git');
  git(content.root, 'init', '--bare', contentRemote);
  git(content.root, 'remote', 'add', 'origin', contentRemote);
  git(content.root, 'push', 'origin', 'HEAD:main');
  const app = path.join(content.root, 'application');
  await mkdir(app);
  git(app, 'init', '-b', 'main');
  git(app, 'config', 'user.email', 'test@example.com');
  git(app, 'config', 'user.name', 'Test');
  git(app, 'update-index', '--add', '--cacheinfo', `160000,${content.base},content`);
  git(app, 'commit', '-m', 'app base');
  const appBase = git(app, 'rev-parse', 'HEAD');
  const appRemote = path.join(content.root, '.git', 'application-origin.git');
  git(app, 'init', '--bare', appRemote);
  git(app, 'remote', 'add', 'origin', appRemote);
  git(app, 'push', 'origin', 'HEAD:main');
  return { ...content, app, appRemote, appBase };
}

test('failed prospective app verification leaves the remote app branch unchanged', async t => {
  const f = await publicationFixture(t);
  await assert.rejects(updateAppGitlink({
    root: f.app,
    contentRoot: f.root,
    candidate: f.candidate,
    branch: 'main',
    contentBranch: 'main',
    verify: async (directory, commit) => {
      assert.equal(git(directory, 'rev-parse', 'HEAD:content'), f.candidate);
      assert.equal(git(directory, 'rev-parse', 'HEAD'), commit);
      throw new Error('Prospective build failed');
    },
  }), /Prospective build failed/);
  assert.equal(git(f.appRemote, 'rev-parse', 'refs/heads/main'), f.appBase);
});

test('source advance during verification supersedes the request before the app push', async t => {
  const f = await publicationFixture(t);
  const result = await updateAppGitlink({
    root: f.app,
    contentRoot: f.root,
    candidate: f.candidate,
    branch: 'main',
    contentBranch: 'main',
    verify: async () => {
      await writeFile(path.join(f.root, 'categories.json'), '[ ]');
      git(f.root, 'add', 'categories.json');
      git(f.root, 'commit', '-m', 'newer source during build');
      git(f.root, 'push', 'origin', 'HEAD:main');
    },
  });
  assert.equal(result.state, 'superseded');
  assert.equal(git(f.appRemote, 'rev-parse', 'refs/heads/main'), f.appBase);
});

test('a concurrent app push rebuilds and reverifies on the new app HEAD', async t => {
  const f = await publicationFixture(t);
  let verifications = 0;
  const result = await updateAppGitlink({
    root: f.app,
    contentRoot: f.root,
    candidate: f.candidate,
    branch: 'main',
    contentBranch: 'main',
    verify: async directory => {
      verifications++;
      if (verifications === 1) {
        await writeFile(path.join(f.app, 'new-app.txt'), 'concurrent app change');
        git(f.app, 'add', 'new-app.txt');
        git(f.app, 'commit', '-m', 'concurrent application change');
        git(f.app, 'push', 'origin', 'HEAD:main');
      } else {
        assert.equal(git(directory, 'show', 'HEAD:new-app.txt'), 'concurrent app change');
      }
    },
  });
  assert.equal(verifications, 2);
  assert.equal(git(f.appRemote, 'rev-parse', 'refs/heads/main'), result.commit);
  assert.equal(git(f.appRemote, 'show', 'main:new-app.txt'), 'concurrent app change');
});

test('prospective verification can initialize the exact content submodule', async t => {
  const f = await publicationFixture(t);
  await writeFile(path.join(f.app, '.gitmodules'), `[submodule "content"]\n\tpath = content\n\turl = ${f.root}\n`);
  git(f.app, 'add', '.gitmodules');
  git(f.app, 'commit', '-m', 'configure content submodule');
  git(f.app, 'push', 'origin', 'HEAD:main');
  const result = await updateAppGitlink({
    root: f.app,
    contentRoot: f.root,
    candidate: f.candidate,
    branch: 'main',
    contentBranch: 'main',
    verify: async directory => {
      git(directory, 'submodule', 'init', 'content');
      git(directory, '-c', 'protocol.file.allow=always', 'submodule', 'update', 'content');
      assert.equal(git(path.join(directory, 'content'), 'rev-parse', 'HEAD'), f.candidate);
    },
  });
  assert.equal(git(f.appRemote, 'rev-parse', 'refs/heads/main'), result.commit);
});


test('workflow installs trusted dependencies before running the publication CLI', async () => {
  const source = await readFile(new URL('../.github/workflows/publish-content.yml', import.meta.url), 'utf8');
  const steps = YAML.parse(source).jobs.publish.steps;
  const install = steps.findIndex(step => step.run?.trim() === 'npm ci');
  const firstCli = steps.findIndex(step => step.run?.includes('node scripts/publish-content.mjs'));
  assert(install >= 0, 'A dedicated dependency installation step is required');
  assert(firstCli > install, 'Publication CLI imports require installed dependencies');
  assert.equal(steps[firstCli].run.trim(), 'node scripts/publish-content.mjs token');
});
