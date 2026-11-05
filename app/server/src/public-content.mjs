import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createGitHubClient, httpError } from './github.mjs';
import { SHA, UUID, PUBLIC_VERSION, MAX_PUBLIC_FILE, requirePublic as requireValue, rawContentUrl, fetchPublicBytes, parsePublicJson } from './public-files.mjs';

const REPOSITORY = 'gyungsubLee/subdev-blog-content';
const REPO_PATH = '/repos/' + REPOSITORY;
const HEAD_FRESH_MS = 30000;
const MAX_BLOB_BYTES = 32 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 128 * 1024 * 1024;
const COMPRESS_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const caches = new WeakMap();

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

function json(body, status = 200, acceptEncoding = null, encoded = {}) {
  let bytes = encoded.identity ??= Buffer.from(JSON.stringify(body));
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Accept-Encoding',
  };
  if (bytes.length > COMPRESS_BYTES) {
    if (acceptsGzip(acceptEncoding)) {
      bytes = encoded.gzip ??= gzipSync(bytes);
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
      postPending: new Map(),
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
    cache.headPending = github(REPO_PATH + '/git/ref/heads/' + encodeURIComponent('public-ready/' + branch))
      .catch(error => {
        // Existing repositories remain readable before their first ready ref is
        // bootstrapped. The fallback still requires a complete immutable artifact.
        if (error.status === 404) return github(REPO_PATH + '/git/ref/heads/' + encodeURIComponent(branch));
        throw error;
      })
      .then(ref => {
        requireValue(ref.object?.type === 'commit' && SHA.test(ref.object.sha), 'Invalid content ref');
        cache.head = ref.object.sha;
        cache.checkedAt = Date.now();
        return cache.head;
      }).finally(() => { cache.headPending = null; });
  }
  return cache.headPending;
}

function trimSnapshots(cache) {
  while (cache.snapshots.size > 3 || cache.snapshotBytes > MAX_SNAPSHOT_BYTES) {
    const oldest = cache.snapshots.keys().next().value;
    cache.snapshotBytes -= cache.snapshots.get(oldest).bytes;
    cache.snapshots.delete(oldest);
  }
}

function accountBytes(cache, commit, snapshot, added) {
  snapshot.bytes += added;
  if (cache.snapshots.get(commit) === snapshot) {
    cache.snapshotBytes += added;
    trimSnapshots(cache);
  }
}

const POST_KEYS = new Set(['id', 'title', 'parentId', 'category', 'categoryId', 'createdAt', 'updatedAt', 'markdown', 'path', 'url', 'excerpt', 'cover', 'icon', 'order', 'revision', 'bodyLoaded']);
function validatePost(post, id, summary) {
  requireValue(post && typeof post === 'object' && !Array.isArray(post), 'Invalid public post');
  requireValue(Object.keys(post).every(key => POST_KEYS.has(key)), 'Non-public post fields');
  requireValue(UUID.test(post.id) && (!id || post.id === id) && post.bodyLoaded === !summary, 'Invalid public post identity');
  for (const key of ['title', 'category', 'categoryId', 'createdAt', 'updatedAt', 'markdown', 'path', 'url', 'excerpt', 'revision']) {
    requireValue(typeof post[key] === 'string', 'Invalid public post field');
  }
  requireValue(post.parentId === null || UUID.test(post.parentId), 'Invalid public parent');
  requireValue(Number.isSafeInteger(post.order) && post.order >= 0 && /^[a-f0-9]{64}$/.test(post.revision), 'Invalid public post revision');
  requireValue(!summary || post.markdown.length <= 1400, 'Invalid public summary');
  for (const key of ['cover', 'icon']) requireValue(post[key] == null || typeof post[key] === 'string', 'Invalid public image');
}

function validateIndex(data, snapshot, commit) {
  requireValue(data && Object.keys(data).every(key => ['posts', 'categories', 'contentCommit'].includes(key)) && data.contentCommit === commit && Array.isArray(data.posts) && Array.isArray(data.categories), 'Invalid public index');
  requireValue(data.posts.length === snapshot.ids.size, 'Incomplete public index');
  const seen = new Set();
  for (const post of data.posts) {
    validatePost(post, undefined, true);
    requireValue(snapshot.ids.has(post.id) && !seen.has(post.id), 'Invalid public index identity');
    seen.add(post.id);
  }
  for (const category of data.categories) {
    requireValue(category && Object.keys(category).every(key => ['id', 'name', 'parentId', 'order', 'sources'].includes(key)), 'Non-public category fields');
    requireValue(typeof category.id === 'string' && typeof category.name === 'string' && (category.parentId === null || typeof category.parentId === 'string') && Number.isSafeInteger(category.order) && Array.isArray(category.sources) && category.sources.every(source => typeof source === 'string'), 'Invalid public category');
  }
}

async function readSnapshot(commit, cache, github, fetcher) {
  if (cache.snapshots.has(commit)) return cache.snapshots.get(commit);
  if (cache.pending.has(commit)) return cache.pending.get(commit);
  const loading = (async () => {
    let ref;
    try {
      ref = await github(REPO_PATH + '/git/ref/heads/' + encodeURIComponent('public-data/' + commit));
    } catch (error) {
      if (error.status === 404) throw httpError(503, 'Public content is not ready for this commit');
      throw error;
    }
    requireValue(ref.object?.type === 'commit' && SHA.test(ref.object.sha), 'Invalid publication ref');
    const artifact = ref.object.sha;
    const bytes = await fetchPublicBytes(fetcher, rawContentUrl(REPOSITORY, artifact, 'manifest.json'), MAX_PUBLIC_FILE, 503);
    const manifest = parsePublicJson(bytes);
    requireValue(manifest.version === PUBLIC_VERSION && manifest.sourceCommit === commit && Array.isArray(manifest.posts), 'Publication identity mismatch');
    requireValue(Object.keys(manifest).every(key => ['version', 'sourceCommit', 'posts', 'files'].includes(key)) && manifest.posts.every(id => UUID.test(id)), 'Invalid publication manifest');
    const ids = new Set(manifest.posts);
    requireValue(ids.size === manifest.posts.length, 'Duplicate publication post');
    const snapshot = { artifact, ids, encoded: {}, bytes: bytes.length + manifest.posts.length * 128 };
    cache.snapshots.set(commit, snapshot);
    cache.snapshotBytes += snapshot.bytes;
    trimSnapshots(cache);
    return snapshot;
  })().finally(() => cache.pending.delete(commit));
  cache.pending.set(commit, loading);
  return loading;
}

async function indexBytes(snapshot, commit, cache, fetcher) {
  if (snapshot.encoded.identity) return;
  if (!snapshot.indexPending) {
    snapshot.indexPending = (async () => {
      const bytes = await fetchPublicBytes(fetcher, rawContentUrl(REPOSITORY, snapshot.artifact, 'index.json'), MAX_PUBLIC_FILE, 503);
      validateIndex(parsePublicJson(bytes), snapshot, commit);
      snapshot.encoded.identity = bytes;
      accountBytes(cache, commit, snapshot, bytes.length);
    })().finally(() => { snapshot.indexPending = null; });
  }
  await snapshot.indexPending;
}

async function postBytes(snapshot, id, cache, fetcher) {
  requireValue(snapshot.ids.has(id), 'Post not found', 404);
  const key = snapshot.artifact + ':' + id;
  if (cache.blobs.has(key)) return cache.blobs.get(key);
  if (!cache.postPending.has(key)) {
    const pending = (async () => {
      const bytes = await fetchPublicBytes(fetcher, rawContentUrl(REPOSITORY, snapshot.artifact, `posts/${id}.json`), MAX_PUBLIC_FILE, 503);
      validatePost(parsePublicJson(bytes), id, false);
      cache.blobs.set(key, bytes);
      cache.blobBytes += bytes.length;
      while (cache.blobBytes > MAX_BLOB_BYTES) {
        const oldest = cache.blobs.keys().next().value;
        cache.blobBytes -= cache.blobs.get(oldest).length;
        cache.blobs.delete(oldest);
      }
      return bytes;
    })().finally(() => cache.postPending.delete(key));
    cache.postPending.set(key, pending);
  }
  return cache.postPending.get(key);
}

export async function handlePublicRequest(request, { env = process.env, fetcher = globalThis.fetch } = {}) {
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
    requireValue(typeof branch === 'string' && branch.length <= 255 && !/[\u0000-\u001f\u007f]/.test(branch), 'Invalid content branch', 500);
    const cache = cacheFor(fetcher, branch, env.GITHUB_PUBLIC_TOKEN);
    const github = createGitHubClient(env.GITHUB_PUBLIC_TOKEN, fetcher);
    const head = await canonicalHead(cache, github, branch, after);
    const commit = requestedCommit ?? head;
    if (commit !== head && cache.snapshots.get(commit)?.validatedHead !== head) {
      const comparison = await github(REPO_PATH + '/compare/' + commit + '...' + head);
      requireValue(comparison.status === 'ahead', 'Content commit is outside public history', 404);
    }
    const snapshot = await readSnapshot(commit, cache, github, fetcher);
    snapshot.validatedHead = head;
    if (kind === 'index') {
      await indexBytes(snapshot, commit, cache, fetcher);
      const before = snapshot.encoded.gzip?.length ?? 0;
      const response = json(null, 200, request.headers.get('Accept-Encoding'), snapshot.encoded);
      accountBytes(cache, commit, snapshot, (snapshot.encoded.gzip?.length ?? 0) - before);
      return response;
    }
    const bytes = await postBytes(snapshot, id, cache, fetcher);
    return json(null, 200, request.headers.get('Accept-Encoding'), { identity: bytes });
  } catch (error) {
    return respond({ error: error.status ? error.message : 'Invalid public content' }, error.status || 502);
  }
}
