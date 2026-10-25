import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { readFile as readLocalFile } from 'node:fs/promises';
import { createGitHubClient, httpError } from './github.mjs';
import { canonicalFilename, parseMarkdownDocument } from '../src/shared/document.mjs';
import { validateContent, toPublicPosts, toPublicPost, toPublicCategories } from '../scripts/content.mjs';

const REPOSITORY = 'gyungsubLee/subdev-blog-content';
const REPO_PATH = '/repos/' + REPOSITORY;
const SHA = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HEAD_FRESH_MS = 30000;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_BLOB_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const COMPRESS_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const caches = new WeakMap();
let catalogFile;

function readCatalog() {
  catalogFile ??= readLocalFile(new URL('./content-catalog.json', import.meta.url), 'utf8')
    .then(JSON.parse)
    .catch(error => {
      if (error.code === 'ENOENT') return null;
      throw httpError(502, 'Invalid public content catalog');
    });
  return catalogFile;
}
function acceptsGzip(header) {
  if (header === null) return true;
  let gzip;
  let wildcard = false;
  for (const range of header.toLowerCase().split(',')) {
    const [name, ...parameters] = range.trim().split(';');
    const coding = name.trim();
    if (coding !== 'gzip' && coding !== '*') continue;
    const qualityParameter = parameters.find(parameter => /^\s*q\s*=/.test(parameter));
    const quality = qualityParameter === undefined ? 1 : Number(qualityParameter.split('=')[1].trim());
    const accepted = quality > 0 && quality <= 1;
    if (coding === 'gzip') gzip = accepted;
    else wildcard = accepted;
  }
  return gzip ?? wildcard;
}

function json(body, status = 200, acceptEncoding = null) {
  let bytes = Buffer.from(JSON.stringify(body));
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Accept-Encoding',
  };
  if (bytes.length > COMPRESS_BYTES) {
    if (acceptsGzip(acceptEncoding)) {
      bytes = gzipSync(bytes);
      if (bytes.length > MAX_RESPONSE_BYTES) {
        return json({ error: 'Public content response exceeds the compressed size limit' }, 502, acceptEncoding);
      }
      headers['Content-Encoding'] = 'gzip';
    } else if (bytes.length > MAX_RESPONSE_BYTES) {
      return json({ error: 'Gzip encoding is required for this public content response' }, 406, acceptEncoding);
    }
  }
  return new Response(bytes, { status, headers });
}

function requireValue(condition, message, status = 502) {
  if (!condition) throw httpError(status, message);
}

function cacheFor(fetcher, branch, token) {
  let configurations = caches.get(fetcher);
  if (!configurations) {
    configurations = new Map();
    caches.set(fetcher, configurations);
  }
  const key = branch + ':' + createHash('sha256').update(token ?? '').digest('hex');
  let cache = configurations.get(key);
  if (!cache) {
    // ponytail: caches are per process (4 configurations, 3 snapshots/128 MiB,
    // 32 MiB blob text each). A shared cache is the upgrade for frequent cold starts.
    cache = {
      head: null,
      checkedAt: 0,
      snapshots: new Map(),
      snapshotBytes: 0,
      blobs: new Map(),
      blobBytes: 0,
      pending: new Map(),
    };
    configurations.set(key, cache);
    while (configurations.size > 4) configurations.delete(configurations.keys().next().value);
  }
  return cache;
}

async function canonicalHead(cache, github, branch, after) {
  if (cache.head && Date.now() - cache.checkedAt < HEAD_FRESH_MS && (!after || after === cache.head)) return cache.head;
  if (!cache.headPending) {
    cache.headPending = (async () => {
      const repository = await github(REPO_PATH);
      requireValue(repository.private === false, 'Public content repository required', 403);
      const ref = await github(REPO_PATH + '/git/ref/heads/' + encodeURIComponent(branch));
      requireValue(ref.object?.type === 'commit' && SHA.test(ref.object.sha), 'Invalid canonical content ref');
      cache.head = ref.object.sha;
      cache.checkedAt = Date.now();
      return cache.head;
    })().finally(() => { cache.headPending = null; });
  }
  return cache.headPending;
}

function rawUrl(commit, filename) {
  return `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/` + filename.split('/').map(encodeURIComponent).join('/');
}

async function readFile(entry, commit, cache, fetcher) {
  if (cache.blobs.has(entry.sha)) return cache.blobs.get(entry.sha);
  requireValue(Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_FILE_BYTES, 'Public content file is too large');
  let response;
  try {
    response = await fetcher(rawUrl(commit, entry.path), { signal: AbortSignal.timeout(15000) });
  } catch {
    throw httpError(502, 'Public content connection failed');
  }
  requireValue(response.ok, 'Public content file request failed');
  const reader = response.body?.getReader();
  requireValue(reader, 'Invalid public content file');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE_BYTES) {
        await reader.cancel();
        throw httpError(502, 'Public content file is too large');
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    throw error.status ? error : httpError(502, 'Public content file read failed');
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const sha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  requireValue(sha === entry.sha, 'Public content file does not match its tree');
  const text = bytes.toString('utf8');
  cache.blobs.set(entry.sha, text);
  cache.blobBytes += text.length * 2;
  while (cache.blobBytes > MAX_BLOB_BYTES) {
    const oldest = cache.blobs.keys().next().value;
    cache.blobBytes -= cache.blobs.get(oldest).length * 2;
    cache.blobs.delete(oldest);
  }
  return text;
}

async function readSnapshot(commit, cache, github, fetcher, catalog) {
  if (cache.snapshots.has(commit)) return cache.snapshots.get(commit);
  if (cache.pending.has(commit)) return cache.pending.get(commit);
  const loading = (async () => {
    const record = await github(REPO_PATH + '/git/commits/' + commit);
    requireValue(record.sha === commit && SHA.test(record.tree?.sha), 'Invalid public content commit');
    const tree = await github(REPO_PATH + '/git/trees/' + record.tree.sha + '?recursive=1');
    requireValue(tree.truncated === false && Array.isArray(tree.tree), 'Public content tree is incomplete');
    const documents = new Map();
    let categoryFile;
    const paths = new Set();
    for (const entry of tree.tree) {
      requireValue(typeof entry.path === 'string' && !paths.has(entry.path), 'Invalid public content tree path');
      paths.add(entry.path);
      if (entry.path === 'categories.json') {
        requireValue(entry.type === 'blob' && entry.mode === '100644' && SHA.test(entry.sha), 'Unsafe public category tree');
        categoryFile = entry;
        continue;
      }
      if (!entry.path.startsWith('posts/')) continue;
      const parts = entry.path.split('/');
      requireValue(UUID.test(parts[1]), 'Invalid public post folder');
      if (parts.length === 2 && entry.type === 'tree' && entry.mode === '040000') continue;
      const name = parts[2];
      requireValue(parts.length === 3 && name && name !== '.' && name !== '..' && !/[\\/\u0000-\u001f\u007f]/.test(name), 'Unsafe public post path');
      requireValue(entry.type === 'blob' && entry.mode === '100644' && SHA.test(entry.sha), 'Unsafe public post tree');
      if (!documents.has(parts[1])) documents.set(parts[1], { files: [], assets: [] });
      const document = documents.get(parts[1]);
      if (/\.md$/i.test(name)) document.files.push(entry);
      else document.assets.push({ name, path: entry.path });
    }
    requireValue(categoryFile, 'Public categories are missing');
    requireValue(catalog || documents.size <= 64, 'Public content catalog is missing');
    if (catalog) requireValue(catalog.version === 1 && Array.isArray(catalog.documents), 'Invalid public content catalog');
    const baseline = new Map((catalog?.documents ?? []).map(entry => [entry.filename, entry]));
    const inputs = [categoryFile];
    for (const document of documents.values()) {
      requireValue(document.files.length === 1, 'Public document is missing or ambiguous');
      const file = document.files[0];
      const cached = baseline.get(file.path);
      document.baseline = cached?.blobSha === file.sha ? cached : null;
      if (!document.baseline) inputs.push(file);
    }
    requireValue(inputs.every(entry => Number.isSafeInteger(entry.size) && entry.size >= 0 && entry.size <= MAX_FILE_BYTES), 'Invalid public file size');
    requireValue(inputs.reduce((size, entry) => size + entry.size, 0) <= MAX_SOURCE_BYTES, 'Public content source is too large');
    const texts = new Map();
    let cursor = 0;
    let failure;
    await Promise.all(Array.from({ length: Math.min(8, inputs.length) }, async () => {
      while (cursor < inputs.length && !failure) {
        const entry = inputs[cursor++];
        try {
          texts.set(entry.path, await readFile(entry, commit, cache, fetcher));
        } catch (error) {
          failure = error;
        }
      }
    }));
    if (failure) throw failure;
    const snapshot = {
      categories: JSON.parse(texts.get(categoryFile.path)),
      documents: new Map(),
      allowUnresolvedLinks: true,
      assetUrl: asset => rawUrl(commit, asset.path),
    };
    for (const [id, document] of documents) {
      const file = document.files[0];
      const cached = document.baseline;
      if (cached) requireValue(typeof cached.markdown === 'string' && cached.markdown.length <= 1400 && /^[a-f0-9]{64}$/.test(cached.revision), 'Invalid public catalog document');
      const text = texts.get(file.path);
      const parsed = cached
        ? { documentMode: 'full', metadata: cached.metadata, markdown: cached.markdown }
        : parseMarkdownDocument(text);
      requireValue(parsed.documentMode === 'full' && parsed.metadata.id === id, 'Public document ID mismatch');
      requireValue(file.path === `posts/${id}/${canonicalFilename(parsed.metadata.title)}`, 'Public document filename mismatch');
      snapshot.documents.set(id, {
        metadata: parsed.metadata,
        markdown: parsed.markdown,
        filename: file.path,
        revision: cached?.revision ?? createHash('sha256').update(text).digest('hex'),
        sourceFile: file,
        fullBody: !cached,
        assets: [],
        allAssets: document.assets,
      });
    }
    validateContent(snapshot);
    const posts = toPublicPosts(snapshot);
    const result = { snapshot, posts, categories: toPublicCategories(snapshot), contentCommit: commit };
    result.bytes = JSON.stringify(result.categories).length * 2;
    for (const post of posts) {
      const entry = snapshot.documents.get(post.id);
      result.bytes += 1024 + JSON.stringify(entry.metadata).length * 2 + entry.markdown.length * 2;
      for (const value of Object.values(post)) {
        if (typeof value === 'string') result.bytes += value.length * 2;
      }
      for (const asset of entry.allAssets) result.bytes += (asset.name.length + asset.path.length) * 2 + 128;
    }
    if (result.bytes <= MAX_SNAPSHOT_BYTES) {
      cache.snapshots.set(commit, result);
      cache.snapshotBytes += result.bytes;
      while (cache.snapshots.size > 3 || cache.snapshotBytes > MAX_SNAPSHOT_BYTES) {
        const oldest = cache.snapshots.keys().next().value;
        cache.snapshotBytes -= cache.snapshots.get(oldest).bytes;
        cache.snapshots.delete(oldest);
      }
    }
    return result;
  })().finally(() => cache.pending.delete(commit));
  cache.pending.set(commit, loading);
  return loading;
}

export async function handlePublicRequest(request, { env = process.env, fetcher = globalThis.fetch, catalog } = {}) {
  const respond = (body, status) => json(body, status, request.headers.get('Accept-Encoding'));
  if (request.method !== 'GET') return respond({ error: 'Method not allowed' }, 405);
  try {
    const query = new URL(request.url).searchParams;
    const kind = query.get('kind');
    const allowed = new Set(['path', 'kind', ...(kind === 'index' ? ['after'] : ['id', 'commit'])]);
    requireValue([...query.keys()].every(key => allowed.has(key) && query.getAll(key).length === 1), 'Invalid public content parameters', 400);
    requireValue(kind === 'index' || kind === 'post', 'Invalid public content kind', 400);
    const after = query.get('after');
    requireValue(after === null || SHA.test(after), 'Invalid content commit', 400);
    const id = query.get('id');
    const requestedCommit = query.get('commit');
    if (kind === 'post') requireValue(UUID.test(id ?? '') && SHA.test(requestedCommit ?? ''), 'Post ID and full content commit required', 400);
    const branch = env.GITHUB_CONTENT_BRANCH || 'main';
    requireValue(typeof branch === 'string' && branch.length > 0 && branch.length <= 255 && !/[\u0000-\u001f\u007f]/.test(branch), 'Invalid public content branch', 500);
    const cache = cacheFor(fetcher, branch, env.GITHUB_PUBLIC_TOKEN);
    const github = createGitHubClient(env.GITHUB_PUBLIC_TOKEN, fetcher);
    const head = await canonicalHead(cache, github, branch, after);
    const commit = requestedCommit ?? head;
    if (commit !== head && cache.snapshots.get(commit)?.validatedHead !== head) {
      const comparison = await github(REPO_PATH + '/compare/' + commit + '...' + head);
      requireValue(comparison.status === 'ahead', 'Content commit is outside public history', 404);
    }
    const snapshot = await readSnapshot(commit, cache, github, fetcher, catalog ?? await readCatalog());
    snapshot.validatedHead = head;
    if (kind === 'index') return respond({
      posts: snapshot.posts.map(post => ({ ...post, markdown: post.markdown.slice(0, 1400), bodyLoaded: false })),
      categories: snapshot.categories,
      contentCommit: commit,
    });
    const entry = snapshot.snapshot.documents.get(id);
    requireValue(entry, 'Post not found', 404);
    if (entry.fullBody) return respond(toPublicPost(snapshot.snapshot, id));
    const text = await readFile(entry.sourceFile, commit, cache, fetcher);
    const parsed = parseMarkdownDocument(text);
    requireValue(parsed.documentMode === 'full' && parsed.metadata.id === id, 'Public document ID mismatch');
    // Keep full bodies in the bounded blob cache; the catalog snapshot remains summaries.
    const detail = { ...snapshot.snapshot, documents: new Map(snapshot.snapshot.documents) };
    detail.documents.set(id, { ...entry, metadata: parsed.metadata, markdown: parsed.markdown });
    return respond(toPublicPost(detail, id));
  } catch (error) {
    return respond({ error: error.status ? error.message : 'Invalid public content' }, error.status || 502);
  }
}
