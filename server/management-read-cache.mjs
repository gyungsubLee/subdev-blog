import { createHash } from 'node:crypto';
import { createGitHubClient } from './github.mjs';

const caches = new WeakMap();
const MAX_ENTRIES = 32;
const MAX_BYTES = 8 * 1024 * 1024;

export function createManagementGitHubClient(token, config, fetcher = globalThis.fetch) {
  const github = createGitHubClient(token, fetcher);
  const key = createHash('sha256').update(JSON.stringify([
    token, config.origin, config.adminUserId, config.appId, config.installationId,
    config.app, config.content,
  ])).digest('hex');
  let configurations = caches.get(fetcher);
  if (!configurations) {
    configurations = new Map();
    caches.set(fetcher, configurations);
  }
  let cache = configurations.get(key);
  if (!cache) {
    // ponytail: per-process cache, at most four configurations, 32 entries/8 MiB
    // each. A shared cache is the upgrade if frequent cold starts warrant it.
    cache = { entries: new Map(), pending: new Map(), bytes: 0 };
    configurations.set(key, cache);
    while (configurations.size > 4) configurations.delete(configurations.keys().next().value);
  }

  return async (path, options = {}) => {
    // Never retain identity, installation grants, repository permissions or heads.
    // Only commit-addressed files and immutable Git objects may outlive a request.
    const immutable = /\/git\/(?:commits|trees|blobs)\/[a-f0-9]{40}$/.test(path) ||
      /\/contents\/(?:content|\.gitmodules|categories\.json|posts|CONTENT_SCHEMA\.md)\?ref=[a-f0-9]{40}$/.test(path);
    if (!immutable || (options.method ?? 'GET') !== 'GET' || Object.keys(options).length > 0) {
      return github(path, options);
    }
    if (cache.entries.has(path)) return cache.entries.get(path).value;
    if (cache.pending.has(path)) return cache.pending.get(path);
    if (cache.pending.size >= MAX_ENTRIES) return github(path, options);

    const loading = (async () => {
      const value = await github(path, options);
      const bytes = JSON.stringify(value).length * 2;
      if (bytes <= MAX_BYTES) {
        cache.entries.set(path, { value, bytes });
        cache.bytes += bytes;
        while (cache.entries.size > MAX_ENTRIES || cache.bytes > MAX_BYTES) {
          const oldest = cache.entries.keys().next().value;
          cache.bytes -= cache.entries.get(oldest).bytes;
          cache.entries.delete(oldest);
        }
      }
      return value;
    })().finally(() => { cache.pending.delete(path); });
    cache.pending.set(path, loading);
    return loading;
  };
}
