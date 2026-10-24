import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, appendFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSign } from 'node:crypto';
import { readContent, toPublicPosts } from './content.mjs';
import { rewriteContentLinks } from '../src/shared/content-links.mjs';
const shaPattern = /^[a-f0-9]{40}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function ancestor(root, older, newer) {
  try {
    git(root, 'merge-base', '--is-ancestor', older, newer);
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}
async function snapshot(root, commit, destination) {
  const records = git(root, 'ls-tree', '-r', '-z', commit).split('\0').filter(Boolean);
  for (const record of records) {
    const [header, filename] = record.split('\t');
    if (filename !== 'categories.json' && !filename.startsWith('posts/')) continue;
    if (!header.startsWith('100644 blob ') && !header.startsWith('100755 blob ')) {
      throw new Error('Unsafe content file mode');
    }
    const target = path.join(destination, filename);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, execFileSync('git', ['-C', root, 'show', `${commit}:${filename}`], { maxBuffer: 16 * 1024 * 1024 }));
  }
  await mkdir(path.join(destination, 'posts'), { recursive: true });
  return readContent(destination);
}
export async function validateCandidate({ root, base, candidate }) {
  if (![base, candidate].every(value => shaPattern.test(value))) throw new Error('Invalid commit SHA');
  if (git(root, 'show', '-s', '--format=%P', candidate) !== base) throw new Error('Candidate parent must be base');
  const changed = git(root, 'diff', '--name-only', '--no-renames', '-z', base, candidate).split('\0').filter(Boolean);
  if (!changed.length) throw new Error('Empty candidate');
  for (const filename of changed) {
    const parts = filename.split('/');
    if (filename === 'categories.json') continue;
    const safePostFile = parts.length === 3 && parts[0] === 'posts' && uuid.test(parts[1])
      && parts[2] && !/[\x00-\x1f\\]/.test(parts[2]) && !['.', '..'].includes(parts[2]);
    if (!safePostFile) throw new Error('Forbidden content path: ' + filename);
  }
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'validate-content-'));
  try {
    const before = await snapshot(root, base, path.join(temporary, 'base'));
    const after = await snapshot(root, candidate, path.join(temporary, 'candidate'));
    const deleted = [...before.documents.keys()].filter(id => !after.documents.has(id));
    for (const post of toPublicPosts(before)) {
      if (!after.documents.has(post.id)) continue;
      const links = [post.cover, post.icon];
      rewriteContentLinks(post.markdown, destination => {
        links.push(destination);
        return destination;
      });
      const metadata = before.documents.get(post.id).metadata;
      for (const id of deleted) {
        const linked = links.some(value => typeof value === 'string' && value.startsWith('#/post/') && value.slice(7).split(/[?#]/)[0] === id);
        const related = ['related_ids', 'source_ids'].some(key => metadata[key]?.includes(id));
        if (linked || post.parentId === id || related) {
          throw new Error('Deleted post has inbound references: ' + id);
        }
      }
    }
    const remaining = new Set(after.categories.map(category => category.id));
    for (const category of before.categories.filter(category => !remaining.has(category.id))) {
      const hasChildren = before.categories.some(child => child.parent_id === category.id);
      const hasAssignments = [...before.documents.values()].some(entry => entry.metadata.category_id === category.id);
      if (category.id === 'group:unclassified' || hasChildren || hasAssignments) {
        throw new Error('Cannot delete category in use: ' + category.id);
      }
    }
    return { changed, deleted };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
export async function promoteContent({ root, branch, base, candidate }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    git(root, 'fetch', '--no-recurse-submodules', 'origin', `refs/heads/${branch}`);
    const head = git(root, 'rev-parse', 'FETCH_HEAD');
    if (head === candidate) return 'saved';
    if (ancestor(root, candidate, head)) return 'superseded';
    if (head !== base) throw new Error('Content branch conflict');
    try {
      git(root, 'push', 'origin', `${candidate}:refs/heads/${branch}`);
      return 'saved';
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}
export async function updateAppGitlink({
  root, contentRoot, candidate, branch, contentBranch, verify,
}) {
  if (typeof verify !== 'function') throw new Error('App verification callback is required');
  if (!contentBranch) throw new Error('Canonical content branch is required');

  // The source repository can advance independently of the workflow concurrency group.
  function sourceState() {
    git(contentRoot, 'fetch', '--no-recurse-submodules', 'origin', `refs/heads/${contentBranch}`);
    const sourceHead = git(contentRoot, 'rev-parse', 'FETCH_HEAD');
    if (sourceHead === candidate) return 'current';
    if (ancestor(contentRoot, candidate, sourceHead)) return 'superseded';
    throw new Error('Canonical content branch no longer contains candidate');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    git(root, 'fetch', '--no-recurse-submodules', 'origin', `refs/heads/${branch}`);
    const head = git(root, 'rev-parse', 'FETCH_HEAD');
    if (sourceState() === 'superseded') return { state: 'superseded', commit: head };
    const current = git(root, 'rev-parse', `${head}:content`);
    if (current !== candidate && ancestor(contentRoot, candidate, current)) {
      return { state: 'superseded', commit: head };
    }
    if (!ancestor(contentRoot, current, candidate)) {
      throw new Error('App content ancestry conflict');
    }

    const directory = await mkdtemp(path.join(os.tmpdir(), 'app-pin-'));
    try {
      git(root, 'worktree', 'add', '--detach', directory, head);
      if (current !== candidate) {
        git(directory, 'update-index', '--add', '--cacheinfo', `160000,${candidate},content`);
        git(directory,
          '-c', 'user.name=Content Publisher',
          '-c', 'user.email=content-publisher@users.noreply.github.com',
          'commit', '-m', `Publish content ${candidate}`,
        );
      }
      const commit = git(directory, 'rev-parse', 'HEAD');
      await verify(directory, commit);
      if (sourceState() === 'superseded') return { state: 'superseded', commit: head };
      try {
        // A rejected push restarts preparation and verification against the fresh app HEAD.
        git(directory, 'push', 'origin', `${commit}:refs/heads/${branch}`);
        return { state: 'published', commit };
      } catch (error) {
        if (attempt === 2) throw error;
      }
    } finally {
      try {
        git(root, 'worktree', 'remove', '--force', directory);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error('Missing required configuration: ' + name);
  return value;
}

async function installationToken() {
  const appId = required('GITHUB_APP_ID');
  const installation = required('GITHUB_INSTALLATION_ID');
  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({ iat: now - 60, exp: now + 540, iss: appId });
  const jwt = payload + '.' + createSign('RSA-SHA256').update(payload).sign(required('GITHUB_APP_PRIVATE_KEY'), 'base64url');
  const response = await fetch(`https://api.github.com/app/installations/${installation}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
    },
    body: JSON.stringify({
      repository_ids: [Number(required('GITHUB_APP_REPOSITORY_ID')), Number(required('GITHUB_CONTENT_REPOSITORY_ID'))],
      permissions: { contents: 'write' },
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.token) throw new Error('Installation token creation failed: ' + response.status);
  const expected = new Map([
    [Number(required('GITHUB_APP_REPOSITORY_ID')), 'gyungsubLee/subdev-blog'],
    [Number(required('GITHUB_CONTENT_REPOSITORY_ID')), 'gyungsubLee/subdev-blog-content'],
  ]);
  const unexpectedRepository = data.repositories?.some(repository => expected.get(repository.id) !== repository.full_name);
  if (expected.size !== 2 || data.repositories?.length !== 2 || unexpectedRepository) {
    throw new Error('Token repositories differ from configured application and content repositories');
  }
  console.log('::add-mask::' + data.token);
  await appendFile(required('GITHUB_OUTPUT'), `token=${data.token}\n`);
}
async function cli() {
  const command = process.argv[2];
  if (command === 'token') return installationToken();
  const candidate = required('CANDIDATE_SHA');
  const base = required('BASE_SHA');
  const root = required('CONTENT_REPOSITORY_PATH');
  if (command === 'validate') return validateCandidate({ root, base, candidate });
  if (command === 'promote') {
    const state = await promoteContent({ root, base, candidate, branch: required('GITHUB_CONTENT_BRANCH') });
    await appendFile(required('GITHUB_OUTPUT'), `state=${state}\n`);
    return;
  }
  if (command === 'pin') {
    const result = await updateAppGitlink({
      root: process.cwd(),
      contentRoot: root,
      candidate,
      branch: required('GITHUB_APP_BRANCH'),
      contentBranch: required('GITHUB_CONTENT_BRANCH'),
      verify: async (directory, commit) => {
        git(directory, 'submodule', 'init', 'content');
        git(directory, '-c', 'protocol.file.allow=always',
          '-c', `submodule.content.url=${root}`, 'submodule', 'update', 'content');
        const options = {
          cwd: directory,
          env: { ...process.env, GITHUB_SHA: commit },
          stdio: 'inherit',
        };
        execFileSync('npm', ['ci'], options);
        execFileSync('npm', ['run', 'check'], options);
        execFileSync('npm', ['run', 'check:content'], options);
        execFileSync('npm', ['run', 'build'], options);
      },
    });
    await appendFile(required('GITHUB_OUTPUT'), `state=${result.state}\ncommit=${result.commit}\n`);
    return;
  }
  throw new Error('Expected token, validate, promote, or pin');
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await cli();
