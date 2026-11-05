import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseMarkdownDocument, canonicalFilename } from '../../shared/document.mjs';
import { EDITOR_FILENAME, isEditorFilename } from '../../shared/editor-document.mjs';
import { validateContent, toPublicPosts, toPublicCategories } from '../../content/src/content.mjs';
import { SHA, UUID, PUBLIC_VERSION, MAX_PUBLIC_FILE, requirePublic, rawContentUrl, fetchPublicBytes, parsePublicJson } from './public-files.mjs';

const MAX_SOURCE_FILE = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const GENERATION_VERSION = 1;
const FACT_KEYS = ['schema_version', 'id', 'title', 'parent_id', 'created', 'updated', 'category_id', 'legacy_path', 'legacy_category', 'related_ids', 'source_ids'];
const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const signature = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const catalogSignature = catalog => signature((catalog?.documents ?? []).map(({ filename, blobSha }) => [filename, blobSha]).sort(([a], [b]) => a.localeCompare(b)));
const postOrder = (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id);

async function sourceTree({ commit, github }) {
  requirePublic(SHA.test(commit), 'Invalid source commit', 400);
  const record = await github('/git/commits/' + commit);
  requirePublic(record.sha === commit && SHA.test(record.tree?.sha), 'Invalid source commit');
  const tree = await github('/git/trees/' + record.tree.sha + '?recursive=1');
  requirePublic(tree.truncated === false && Array.isArray(tree.tree), 'Incomplete source tree');
  const documents = new Map();
  const paths = new Set();
  let categories;
  for (const entry of tree.tree) {
    requirePublic(typeof entry.path === 'string' && !paths.has(entry.path), 'Duplicate source path');
    paths.add(entry.path);
    if (entry.path === 'categories.json') {
      requirePublic(entry.type === 'blob' && entry.mode === '100644' && SHA.test(entry.sha), 'Unsafe category tree');
      categories = entry;
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
    else document.assets.push({ name, path: entry.path, sha: entry.sha, size: entry.size });
  }
  requirePublic(categories, 'Public categories missing');
  const inputs = [categories];
  for (const document of documents.values()) {
    requirePublic(document.files.length === 1, 'Ambiguous public document');
    document.assets.sort((a, b) => a.name.localeCompare(b.name));
    document.input = signature([document.files[0].path, document.files[0].sha, document.assets]);
    inputs.push(document.files[0]);
  }
  requirePublic(inputs.every(entry => Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_SOURCE_FILE), 'Invalid source file size');
  requirePublic(inputs.reduce((sum, entry) => sum + entry.size, 0) <= MAX_SOURCE_BYTES, 'Source too large');
  return { record, documents, categories };
}

async function previousPublication(options, source) {
  const parent = source.record.parents?.[0]?.sha;
  if (!SHA.test(parent ?? '')) return null;
  const artifact = await findPublicPublication({ ...options, commit: parent });
  if (!artifact) return null;
  const previous = await readVerifiedPublication({ ...options, commit: parent }, artifact);
  const cachedFile = previous.manifest.files['generation.json'];
  if (!cachedFile) return null;
  const cachedBytes = await fetchPublicBytes(options.fetcher, rawContentUrl(options.repository, artifact, 'generation.json'), MAX_PUBLIC_FILE);
  requirePublic(blobSha(cachedBytes) === cachedFile.sha, 'Generation cache differs from inventory');
  const generation = parsePublicJson(cachedBytes);
  if (!generation || generation.version !== GENERATION_VERSION || generation.catalog !== catalogSignature(options.catalog)) return null;
  requirePublic(generation.documents && typeof generation.documents === 'object' && !Array.isArray(generation.documents), 'Invalid generation cache');
  requirePublic(Object.keys(generation.documents).length === previous.manifest.posts.length && Array.isArray(generation.categories) && SHA.test(generation.categorySha), 'Incomplete generation cache');
  for (const id of previous.manifest.posts) {
    const cached = generation.documents[id];
    requirePublic(cached && /^[a-f0-9]{64}$/.test(cached.input) && cached.metadata?.id === id && Array.isArray(cached.dependencies) && cached.dependencies.every(key => typeof key === 'string'), 'Invalid cached input');
    requirePublic(Object.keys(cached.metadata).every(key => FACT_KEYS.includes(key)) && typeof cached.filename === 'string' && cached.filename.startsWith(`posts/${id}/`), 'Invalid cached facts');
  }
  const bytes = await fetchPublicBytes(options.fetcher, rawContentUrl(options.repository, artifact, 'index.json'), MAX_PUBLIC_FILE);
  requirePublic(blobSha(bytes) === previous.manifest.files['index.json'].sha, 'Cached index differs from inventory');
  const index = parsePublicJson(bytes);
  requirePublic(index.contentCommit === parent && Array.isArray(index.posts) && index.posts.length === previous.manifest.posts.length, 'Invalid cached index');
  const posts = new Map(index.posts.map(post => [post.id, post]));
  requirePublic(posts.size === index.posts.length && previous.manifest.posts.every(id => posts.has(id)), 'Incomplete cached index');
  return { ...previous, generation, posts };
}

async function preparePublicFiles(options, incremental) {
  const source = await sourceTree(options);
  const previous = incremental ? await previousPublication(options, source) : null;
  const selected = new Set();
  const documents = new Map();
  for (const [id, input] of source.documents) {
    const cached = previous?.generation.documents[id];
    const file = input.files[0];
    if (cached?.input === input.input) {
      documents.set(id, { metadata: cached.metadata, markdown: '', filename: file.path, allAssets: input.assets, assets: [] });
    } else selected.add(id);
  }
  const deadline = AbortSignal.timeout(180000);
  async function download(entry) {
    const bytes = await fetchPublicBytes(options.fetcher, rawContentUrl(options.repository, options.commit, entry.path), MAX_SOURCE_FILE, 502, deadline);
    requirePublic(blobSha(bytes) === entry.sha, 'Source blob differs from its tree');
    return bytes;
  }
  async function loadDocuments(ids) {
    const inputs = [...ids];
    let cursor = 0;
    let failure;
    await Promise.all(Array.from({ length: Math.min(8, inputs.length) }, async () => {
      while (cursor < inputs.length && !failure) {
        const id = inputs[cursor++];
        const input = source.documents.get(id);
        const file = input.files[0];
        try {
          const bytes = await download(file);
          const parsed = parseMarkdownDocument(bytes.toString('utf8'));
          requirePublic(parsed.documentMode === 'full' && parsed.metadata.id === id, 'Public document ID mismatch');
          requirePublic(file.path === `posts/${id}/${canonicalFilename(parsed.metadata.title)}`, 'Public document filename mismatch');
          documents.set(id, { ...parsed, filename: file.path, blobSha: file.sha, revision: createHash('sha256').update(bytes).digest('hex'), assets: [], allAssets: input.assets });
        } catch (error) { failure = error; }
      }
    }));
    if (failure) throw failure;
  }
  const categories = previous?.generation.categorySha === source.categories.sha
    ? previous.generation.categories : parsePublicJson(await download(source.categories));
  await loadDocuments(selected);
  // Restore source-tree order independently of concurrent download completion.
  const ordered = () => new Map([...source.documents.keys()].map(id => [id, documents.get(id)]));
  const snapshot = {
    categories, documents: ordered(), allowUnresolvedLinks: true,
    assetUrl: asset => rawContentUrl(options.repository, options.commit, asset.path),
    linkDependencies: new Map(),
  };
  const reused = () => new Set([...documents.keys()].filter(id => !selected.has(id)));
  // Global graph checks remain cheap and catch cycles, deleted references and alias
  // collisions. Unchanged document boundaries and Markdown are not reprocessed.
  validateContent(snapshot, { validatedDocuments: reused(), transformDocuments: new Set() });
  if (previous) {
    const oldPaths = new Map();
    for (const [id, cached] of Object.entries(previous.generation.documents)) {
      for (const alias of [cached.filename, cached.metadata.legacy_path]) if (alias) oldPaths.set(path.posix.normalize(alias), id);
    }
    const changedKeys = new Set();
    for (const alias of new Set([...oldPaths.keys(), ...snapshot.paths.keys()])) {
      if (oldPaths.get(alias) !== snapshot.paths.get(alias)) changedKeys.add('path:' + alias);
    }
    for (const id of new Set([...previous.posts.keys(), ...documents.keys()])) {
      if (previous.posts.has(id) !== documents.has(id)) changedKeys.add('id:' + id);
    }
    const categoryMap = new Map(categories.map(category => [category.id, category]));
    const affected = new Set();
    for (const [id, entry] of documents) {
      if (selected.has(id)) continue;
      const cached = previous.generation.documents[id];
      const oldPost = previous.posts.get(id);
      const categoryId = snapshot.effectiveCategories.get(id);
      let category = categoryId === 'group:unclassified' ? '미분류' : categoryId;
      if (categoryMap.get(categoryId)?.sources.includes(entry.metadata.legacy_category)) category = entry.metadata.legacy_category;
      if (oldPost.categoryId !== categoryId || oldPost.category !== category || cached.dependencies.some(key => changedKeys.has(key))) affected.add(id);
    }
    await loadDocuments(affected);
    for (const id of affected) selected.add(id);
    snapshot.documents = ordered();
  }
  validateContent(snapshot, { validatedDocuments: reused(), transformDocuments: selected });
  const files = new Map();
  for (const post of toPublicPosts(snapshot, selected)) files.set(`posts/${post.id}.json`, Buffer.from(JSON.stringify(post)));
  const baseline = new Map((options.catalog?.documents ?? []).map(entry => [entry.filename, entry]));
  const summaryDocuments = new Map(snapshot.documents);
  for (const id of selected) {
    const entry = documents.get(id);
    const cached = baseline.get(entry.filename);
    summaryDocuments.set(id, { ...entry, markdown: cached?.blobSha === entry.blobSha ? entry.markdown.slice(0, 1400) : entry.markdown });
  }
  const summaries = { ...snapshot, documents: summaryDocuments, linkDependencies: new Map() };
  validateContent(summaries, { validatedDocuments: reused(), transformDocuments: selected });
  const updatedSummaries = new Map(toPublicPosts(summaries, selected).map(post => [post.id, { ...post, markdown: post.markdown.slice(0, 1400), bodyLoaded: false }]));
  const posts = [...source.documents.keys()].map(id => updatedSummaries.get(id) ?? previous.posts.get(id)).sort(postOrder);
  const index = { posts, categories: toPublicCategories(snapshot), contentCommit: options.commit };
  files.set('index.json', Buffer.from(JSON.stringify(index)));
  const inventory = Object.fromEntries(posts.map(post => {
    const name = `posts/${post.id}.json`;
    const bytes = files.get(name);
    return [name, bytes ? { size: bytes.length, sha: blobSha(bytes) } : previous.manifest.files[name]];
  }));
  inventory['index.json'] = { size: files.get('index.json').length, sha: blobSha(files.get('index.json')) };
  const state = Object.fromEntries(posts.map(post => {
    const id = post.id;
    if (!selected.has(id)) return [id, previous.generation.documents[id]];
    const entry = documents.get(id);
    return [id, {
      input: source.documents.get(id).input, filename: entry.filename,
      metadata: Object.fromEntries(FACT_KEYS.filter(key => Object.hasOwn(entry.metadata, key)).map(key => [key, entry.metadata[key]])),
      dependencies: [...new Set([...(snapshot.linkDependencies.get(id) ?? []), ...(summaries.linkDependencies.get(id) ?? [])])].sort(),
    }];
  }));
  const generation = { version: GENERATION_VERSION, catalog: catalogSignature(options.catalog), categories: categories.map(({ id, name, parent_id, order, sources }) => ({ id, name, parent_id, order, sources })), categorySha: source.categories.sha, documents: state, generatedPosts: selected.size, reusedPosts: posts.length - selected.size };
  const generationBytes = Buffer.from(JSON.stringify(generation));
  files.set('generation.json', generationBytes);
  inventory['generation.json'] = { size: generationBytes.length, sha: blobSha(generationBytes) };
  const manifest = { version: PUBLIC_VERSION, sourceCommit: options.commit, posts: posts.map(post => post.id), files: inventory };
  files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  requirePublic([...files.values()].every(bytes => bytes.length <= MAX_PUBLIC_FILE), 'Generated file too large');
  requirePublic(Object.values(inventory).reduce((sum, file) => sum + file.size, files.get('manifest.json').length) <= MAX_SOURCE_BYTES, 'Generated publication too large');
  return { files, baseTree: previous?.treeSha, removed: previous ? previous.manifest.posts.filter(id => !source.documents.has(id)).map(id => `posts/${id}.json`) : [] };
}

export async function generatePublicFiles(options) {
  return (await preparePublicFiles(options, false)).files;
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

async function readVerifiedPublication(options, artifact) {
  const { commit, github, repository, fetcher } = options;
  const bytes = await fetchPublicBytes(fetcher, rawContentUrl(repository, artifact, 'manifest.json'), MAX_PUBLIC_FILE);
  const manifest = parsePublicJson(bytes);
  requirePublic(manifest.version === PUBLIC_VERSION && manifest.sourceCommit === commit && Array.isArray(manifest.posts), 'Publication identity mismatch');
  requirePublic(manifest.posts.every(id => UUID.test(id)) && new Set(manifest.posts).size === manifest.posts.length, 'Invalid publication inventory');
  requirePublic(manifest.files && typeof manifest.files === 'object' && !Array.isArray(manifest.files), 'Missing publication files');
  const expected = new Set(['index.json', ...manifest.posts.map(id => `posts/${id}.json`)]);
  if (Object.hasOwn(manifest.files, 'generation.json')) expected.add('generation.json');
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
  return { manifest, treeSha: record.tree.sha };
}

export async function verifyPublicPublication(options, artifact) {
  await readVerifiedPublication(options, artifact);
  return artifact;
}

export async function ensurePublicPublication(options) {
  const { commit, github } = options;
  requirePublic(SHA.test(commit), 'Invalid source commit', 400);
  const verify = artifact => verifyPublicPublication(options, artifact);
  const existing = await findPublicPublication(options);
  if (existing) return verify(existing);
  const { files, baseTree, removed } = await preparePublicFiles(options, true);
  // GitHub times out even for large SHA-only trees. Extend a small tree at
  // each step; only the final commit/ref makes the full publication visible.
  const batches = [];
  let batch = [];
  const envelopeBytes = Buffer.byteLength(JSON.stringify({ base_tree: '0'.repeat(40), tree: [] }));
  let batchBytes = envelopeBytes;
  for (const [path, bytes] of files) {
    let entry = { path, mode: '100644', type: 'blob', content: bytes.toString('utf8') };
    let entryBytes = Buffer.byteLength(JSON.stringify(entry));
    if (entryBytes + envelopeBytes > 2 * 1024 * 1024) {
      const blob = await github('/git/blobs', {
        method: 'POST', body: { content: bytes.toString('base64'), encoding: 'base64' },
      });
      const expected = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      requirePublic(blob.sha === expected, 'Uploaded blob differs from generated file');
      entry = { path, mode: '100644', type: 'blob', sha: blob.sha };
      entryBytes = Buffer.byteLength(JSON.stringify(entry));
    }
    if (batch.length && (batch.length >= 200 || batchBytes + entryBytes + 1 > 2 * 1024 * 1024)) {
      batches.push(batch);
      batch = [];
      batchBytes = envelopeBytes;
    }
    batch.push(entry);
    batchBytes += entryBytes + 1;
  }
  for (const path of removed) {
    const entry = { path, mode: '100644', type: 'blob', sha: null };
    const entryBytes = Buffer.byteLength(JSON.stringify(entry));
    if (batch.length && (batch.length >= 200 || batchBytes + entryBytes + 1 > 2 * 1024 * 1024)) {
      batches.push(batch);
      batch = [];
      batchBytes = envelopeBytes;
    }
    batch.push(entry);
    batchBytes += entryBytes + 1;
  }
  if (batch.length) batches.push(batch);
  let tree = baseTree ? { sha: baseTree } : undefined;
  for (const entries of batches) {
    tree = await github('/git/trees', {
      method: 'POST', body: { ...(tree ? { base_tree: tree.sha } : {}), tree: entries },
    });
    requirePublic(SHA.test(tree.sha), 'Invalid generated tree');
  }
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
