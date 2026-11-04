import { createHash } from 'node:crypto';
import { parseMarkdownDocument, canonicalFilename } from '../../shared/document.mjs';
import { EDITOR_FILENAME, isEditorFilename } from '../../shared/editor-document.mjs';
import { validateContent, toPublicPosts, toPublicCategories } from '../../content/src/content.mjs';

import { SHA, UUID, PUBLIC_VERSION, MAX_PUBLIC_FILE, requirePublic, rawContentUrl, fetchPublicBytes, parsePublicJson } from './public-files.mjs';
const MAX_SOURCE_FILE = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;

async function sourceSnapshot({ commit, repository, github, fetcher }) {
  const deadline = AbortSignal.timeout(180000);
  requirePublic(SHA.test(commit), 'Invalid source commit', 400);
  const record = await github('/git/commits/' + commit);
  requirePublic(record.sha === commit && SHA.test(record.tree?.sha), 'Invalid source commit');
  const tree = await github('/git/trees/' + record.tree.sha + '?recursive=1');
  requirePublic(tree.truncated === false && Array.isArray(tree.tree), 'Incomplete source tree');
  const documents = new Map();
  const paths = new Set();
  let categoryFile;
  for (const entry of tree.tree) {
    requirePublic(typeof entry.path === 'string' && !paths.has(entry.path), 'Duplicate source path');
    paths.add(entry.path);
    if (entry.path === 'categories.json') {
      requirePublic(entry.type === 'blob' && entry.mode === '100644' && SHA.test(entry.sha), 'Unsafe category tree');
      categoryFile = entry;
      continue;
    }
    if (!entry.path.startsWith('posts/')) continue;
    const parts = entry.path.split('/');
    requirePublic(UUID.test(parts[1]), 'Invalid post folder');
    if (parts.length === 2 && entry.type === 'tree' && entry.mode === '040000') continue;
    const name = parts[2];
    requirePublic(parts.length === 3 && name && !['.', '..'].includes(name) && !/[\\/\u0000-\u001f\u007f]/.test(name), 'Unsafe post path');
    requirePublic(entry.type === 'blob' && entry.mode === '100644' && SHA.test(entry.sha), 'Unsafe post tree');
    if (isEditorFilename(name)) {
      requirePublic(name === EDITOR_FILENAME, 'Reserved editor filename');
      continue;
    }
    if (!documents.has(parts[1])) documents.set(parts[1], { files: [], assets: [] });
    const document = documents.get(parts[1]);
    if (/\.md$/i.test(name)) document.files.push(entry);
    else document.assets.push({ name, path: entry.path });
  }
  requirePublic(categoryFile, 'Public categories missing');
  const inputs = [categoryFile];
  for (const document of documents.values()) {
    requirePublic(document.files.length === 1, 'Ambiguous public document');
    inputs.push(document.files[0]);
  }
  requirePublic(inputs.every(entry => Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_SOURCE_FILE), 'Invalid source file size');
  requirePublic(inputs.reduce((sum, entry) => sum + entry.size, 0) <= MAX_SOURCE_BYTES, 'Source too large');
  const texts = new Map();
  let cursor = 0;
  let failure;
  await Promise.all(Array.from({ length: Math.min(8, inputs.length) }, async () => {
    while (cursor < inputs.length && !failure) {
      const entry = inputs[cursor++];
      try {
        const bytes = await fetchPublicBytes(fetcher, rawContentUrl(repository, commit, entry.path), MAX_SOURCE_FILE, 502, deadline);
        const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        requirePublic(hash === entry.sha, 'Source blob differs from its tree');
        texts.set(entry.path, bytes);
      } catch (error) {
        failure = error;
      }
    }
  }));
  if (failure) throw failure;
  const snapshot = {
    categories: parsePublicJson(texts.get(categoryFile.path)), documents: new Map(),
    allowUnresolvedLinks: true, assetUrl: asset => rawContentUrl(repository, commit, asset.path),
  };
  for (const [id, document] of documents) {
    const file = document.files[0];
    const bytes = texts.get(file.path);
    const parsed = parseMarkdownDocument(bytes.toString('utf8'));
    requirePublic(parsed.documentMode === 'full' && parsed.metadata.id === id, 'Public document ID mismatch');
    requirePublic(file.path === `posts/${id}/${canonicalFilename(parsed.metadata.title)}`, 'Public document filename mismatch');
    snapshot.documents.set(id, { ...parsed, blobSha: file.sha, filename: file.path, revision: createHash('sha256').update(bytes).digest('hex'), assets: [], allAssets: document.assets });
  }
  return snapshot;
}

export async function generatePublicFiles(options) {
  const snapshot = await sourceSnapshot(options);
  validateContent(snapshot);
  const fullPosts = toPublicPosts(snapshot);
  const files = new Map(fullPosts.map(post => [`posts/${post.id}.json`, Buffer.from(JSON.stringify(post))]));
  // Preserve the existing distinction between catalog summaries and changed source bodies.
  const baseline = new Map((options.catalog?.documents ?? []).map(entry => [entry.filename, entry]));
  const summaryDocuments = new Map();
  for (const [id, entry] of snapshot.documents) {
    const cached = baseline.get(entry.filename);
    const markdown = cached?.blobSha === entry.blobSha
      ? entry.markdown.slice(0, 1400)
      : entry.markdown;
    summaryDocuments.set(id, { ...entry, markdown });
  }
  const summaries = { ...snapshot, documents: summaryDocuments };
  validateContent(summaries);
  const index = {
    posts: toPublicPosts(summaries).map(post => ({ ...post, markdown: post.markdown.slice(0, 1400), bodyLoaded: false })),
    categories: toPublicCategories(snapshot), contentCommit: options.commit,
  };
  files.set('index.json', Buffer.from(JSON.stringify(index)));
  const inventory = Object.fromEntries([...files].map(([path, bytes]) => [path, { size: bytes.length, sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') }]));
  const manifest = { version: PUBLIC_VERSION, sourceCommit: options.commit, posts: fullPosts.map(post => post.id), files: inventory };
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  requirePublic([...files.values()].every(bytes => bytes.length <= MAX_PUBLIC_FILE), 'Generated file too large');
  requirePublic([...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) <= MAX_SOURCE_BYTES, 'Generated publication too large');
  return files;
}

export async function findPublicPublication({ commit, github }) {
  try {
    const ref = await github('/git/ref/heads/' + encodeURIComponent('public-data/' + commit));
    requirePublic(ref.object?.type === 'commit' && SHA.test(ref.object.sha), 'Invalid publication ref');
    return ref.object.sha;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

export async function verifyPublicPublication(options, artifact) {
  const { commit, github, repository, fetcher } = options;
  const bytes = await fetchPublicBytes(fetcher, rawContentUrl(repository, artifact, 'manifest.json'), MAX_PUBLIC_FILE);
  const manifest = parsePublicJson(bytes);
  requirePublic(manifest.version === PUBLIC_VERSION && manifest.sourceCommit === commit && Array.isArray(manifest.posts), 'Publication identity mismatch');
  requirePublic(manifest.posts.every(id => UUID.test(id)) && new Set(manifest.posts).size === manifest.posts.length, 'Invalid publication inventory');
  requirePublic(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'Missing publication files');
  const expected = new Set(['index.json', ...manifest.posts.map(id => `posts/${id}.json`)]);
  requirePublic(Object.keys(manifest.files).length === expected.size, 'Publication file inventory mismatch');
  const record = await github('/git/commits/' + artifact);
  requirePublic(record.sha === artifact && SHA.test(record.tree?.sha), 'Invalid generated commit');
  const tree = await github('/git/trees/' + record.tree.sha + '?recursive=1');
  requirePublic(tree.truncated === false && Array.isArray(tree.tree), 'Incomplete generated tree');
  const entries = new Map(tree.tree.filter(entry => entry.type !== 'tree').map(entry => [entry.path, entry]));
  requirePublic(entries.size === expected.size + 1, 'Incomplete generated publication');
  for (const path of expected) {
    const file = manifest.files[path];
    const entry = entries.get(path);
    requirePublic(file && SHA.test(file.sha) && Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= MAX_PUBLIC_FILE, 'Invalid generated file inventory');
    requirePublic(entry?.mode === '100644' && entry.type === 'blob' && entry.sha === file.sha && entry.size === file.size, 'Generated file differs from inventory');
  }
  const manifestEntry = entries.get('manifest.json');
  const manifestSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  requirePublic(manifestEntry?.mode === '100644' && manifestEntry.sha === manifestSha, 'Generated manifest differs from tree');
  return artifact;
}

export async function ensurePublicPublication(options) {
  const { commit, github } = options;
  requirePublic(SHA.test(commit), 'Invalid source commit', 400);
  const verify = artifact => verifyPublicPublication(options, artifact);
  const existing = await findPublicPublication(options);
  if (existing) return verify(existing);
  const files = await generatePublicFiles(options);
  const tree = await github('/git/trees', { method: 'POST', body: { tree: [...files].map(([path, bytes]) => ({ path, mode: '100644', type: 'blob', content: bytes.toString('utf8') })) } });
  requirePublic(SHA.test(tree.sha), 'Invalid generated tree');
  const artifact = await github('/git/commits', { method: 'POST', body: { message: 'public-data:' + commit, tree: tree.sha, parents: [] } });
  requirePublic(SHA.test(artifact.sha), 'Invalid generated commit');
  try {
    await github('/git/refs', { method: 'POST', body: { ref: 'refs/heads/public-data/' + commit, sha: artifact.sha } });
  } catch (error) {
    // A competing generation or lost response can have published the complete ref.
    const recovered = await findPublicPublication(options);
    if (recovered) return verify(recovered);
    throw error;
  }
  return artifact.sha;
}
