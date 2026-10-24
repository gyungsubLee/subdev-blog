import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

test('validates content when the inherited Git tree exceeds one MiB', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  const entries = git(f.root, 'ls-tree', f.candidate).split('\n');
  const blob = git(f.root, 'rev-parse', `${f.candidate}:categories.json`);
  // Unchanged archive entries enlarge the Git output without creating thousands of files.
  for (let index = 0; index < 6000; index++) {
    const name = `archive-${String(index).padStart(4, '0')}-${'x'.repeat(128)}`;
    entries.push(`100644 blob ${blob}\t${name}`);
  }
  const tree = execFileSync('git', ['-C', f.root, 'mktree'], {
    input: entries.join('\n') + '\n',
    encoding: 'utf8',
  }).trim();
  const base = git(f.root, 'commit-tree', tree, '-p', f.candidate, '-m', 'large inherited tree');
  const changedBlob = execFileSync('git', ['-C', f.root, 'hash-object', '-w', '--stdin'], {
    input: '[ ]',
    encoding: 'utf8',
  }).trim();
  const candidateTree = execFileSync('git', ['-C', f.root, 'mktree'], {
    input: entries.map(entry => entry.endsWith('\tcategories.json')
      ? `100644 blob ${changedBlob}\tcategories.json`
      : entry).join('\n') + '\n',
    encoding: 'utf8',
  }).trim();
  const candidate = git(f.root, 'commit-tree', candidateTree, '-p', base, '-m', 'update categories');
  const treeOutput = execFileSync('git', ['-C', f.root, 'ls-tree', '-r', '-z', candidate], {
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.ok(treeOutput.length > 1024 * 1024, 'Fixture must exceed the default Git output buffer');

  let result;
  try {
    result = await validateCandidate({ root: f.root, base, candidate });
  } catch (error) {
    assert.fail(`Content validation failed: ${error.code ?? error.message}`);
  }
  assert.deepEqual(result.changed, ['categories.json']);
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

test('workflow uses permitted stored configuration names and preserves CLI environment names', async () => {
  const source = await readFile(new URL('../.github/workflows/publish-content.yml', import.meta.url), 'utf8');
  const workflow = YAML.parse(source);
  assert.deepEqual(JSON.stringify(workflow).match(/(?:vars|secrets)\.GITHUB_[A-Z_]+/g) ?? [], []);
  const job = workflow.jobs.publish;
  assert.equal(job.env.GITHUB_APP_BRANCH, '${{ vars.CMS_APP_BRANCH }}');
  assert.equal(job.env.GITHUB_CONTENT_BRANCH, '${{ vars.CMS_CONTENT_BRANCH }}');
  for (const name of ['Check inputs and secrets', 'Create scoped installation token']) {
    const step = job.steps.find(step => step.name === name);
    assert.equal(step.env.GITHUB_APP_ID, '${{ secrets.CMS_APP_ID }}');
    assert.equal(step.env.GITHUB_APP_PRIVATE_KEY, '${{ secrets.CMS_APP_PRIVATE_KEY }}');
    for (const suffix of ['INSTALLATION_ID', 'APP_REPOSITORY_ID', 'CONTENT_REPOSITORY_ID']) {
      assert.equal(step.env[`GITHUB_${suffix}`], '${{ vars.CMS_' + suffix + ' }}');
    }
  }
});

test('preview alias preflight accepts only the optional CMS preview namespace', { timeout: 10_000 }, async () => {
  const source = await readFile(new URL('../.github/workflows/publish-content.yml', import.meta.url), 'utf8');
  const step = YAML.parse(source).jobs.publish.steps.find(step => step.name === 'Check inputs and secrets');
  const env = {
    ...process.env,
    GITHUB_APP_ID: '1',
    GITHUB_APP_PRIVATE_KEY: 'test-key',
    GITHUB_INSTALLATION_ID: '2',
    GITHUB_APP_REPOSITORY_ID: '3',
    GITHUB_CONTENT_REPOSITORY_ID: '4',
    GITHUB_APP_BRANCH: 'main',
    GITHUB_CONTENT_BRANCH: 'main',
    REQUEST_ID: id,
    BASE_SHA: 'a'.repeat(40),
    CANDIDATE_SHA: 'b'.repeat(40),
    VERCEL_TOKEN: 'test-token',
    VERCEL_ORG_ID: 'test-org',
    VERCEL_PROJECT_ID: 'test-project',
  };
  for (const [alias, allowed] of [
    ['', true],
    ['subdev-blog-cms-gyungsublee.vercel.app', true],
    ['subdev-blog.vercel.app', false],
    ['subdev-blog-cms-example.com', false],
  ]) {
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      env: { ...env, CMS_PREVIEW_ALIAS: alias },
      encoding: 'utf8',
      timeout: 3000,
    });
    assert.equal(result.status === 0, allowed, `Unexpected preflight result for alias ${JSON.stringify(alias)}`);
  }
});

test('preview alias moves only after all deployed bytes pass verification', { timeout: 15_000 }, async t => {
  const source = await readFile(new URL('../.github/workflows/publish-content.yml', import.meta.url), 'utf8');
  const step = YAML.parse(source).jobs.publish.steps.find(step => step.name === 'Deploy preview');
  const root = await mkdtemp(path.join(os.tmpdir(), 'preview-alias-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, '.vercel', 'output', 'static');
  await mkdir(path.join(output, 'content'), { recursive: true });
  const info = { commit: 'a'.repeat(40), contentCommit: 'b'.repeat(40) };
  await writeFile(path.join(output, 'build-info.json'), JSON.stringify(info));
  await writeFile(path.join(output, 'content', 'index.json'), '[{"id":"test"}]');
  await writeFile(path.join(output, 'content', 'asset.bin'), 'original bytes');
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  await writeFile(path.join(bin, 'npx'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CMS_TEST_COMMANDS, JSON.stringify(args) + '\\n');
if (args.includes('deploy')) console.log('https://subdev-blog-cms-test-deployment.vercel.app');
`);
  await chmod(path.join(bin, 'npx'), 0o755);
  const fetcher = path.join(root, 'fetch-preview.mjs');
  await writeFile(fetcher, `import fs from 'node:fs';
import path from 'node:path';
globalThis.fetch = async address => {
  const url = new URL(address);
  if (process.env.CMS_TEST_BAD_CONTENT === '1' && url.pathname.endsWith('/asset.bin')) return new Response('wrong bytes');
  return new Response(fs.readFileSync(path.join(process.cwd(), '.vercel/output/static', decodeURIComponent(url.pathname.slice(1)))));
};
`);
  const commands = path.join(root, 'commands.jsonl');
  const alias = 'subdev-blog-cms-gyungsublee.vercel.app';
  for (const scenario of [
    { alias, badContent: false, success: true, aliasCalls: 1 },
    { alias, badContent: true, success: false, aliasCalls: 0 },
    { alias: '', badContent: false, success: true, aliasCalls: 0 },
  ]) {
    await writeFile(commands, '');
    const result = spawnSync('bash', ['-e', '-c', step.run], {
      cwd: root,
      env: {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        NODE_OPTIONS: '--import=' + fetcher,
        VERCEL_TOKEN: 'test-token',
        APP_COMMIT: info.commit,
        CANDIDATE_SHA: info.contentCommit,
        PREVIEW_URL: '',
        CMS_PREVIEW_ALIAS: scenario.alias,
        CMS_TEST_BAD_CONTENT: scenario.badContent ? '1' : '',
        CMS_TEST_COMMANDS: commands,
        GITHUB_STEP_SUMMARY: path.join(root, 'summary.md'),
      },
      encoding: 'utf8',
      timeout: 4000,
    });
    assert.equal(result.status === 0, scenario.success, 'Unexpected preview verification result');
    const calls = (await readFile(commands, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const deployment = calls.find(args => args.includes('deploy'));
    assert.ok(deployment?.includes('--archive=tgz'), 'Large content trees require an archive upload');
    const aliases = calls.filter(args => args.includes('alias'));
    assert.equal(aliases.length, scenario.aliasCalls, 'Alias must follow successful byte verification');
    if (aliases.length) {
      assert.deepEqual(aliases[0], [
        '--yes', 'vercel@58.1.0', 'alias', 'set',
        'https://subdev-blog-cms-test-deployment.vercel.app', alias, '--token=test-token',
      ]);
    }
  }
});
