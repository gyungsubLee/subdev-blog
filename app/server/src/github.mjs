import { setTimeout as delay } from 'node:timers/promises';

export function httpError(status, message, details) {
  return Object.assign(new Error(message), { status, details });
}

export function createGitHubClient(token, fetcher = globalThis.fetch) {
  return async (path, { method = 'GET', body, headers = {}, readOnly = false } = {}) => {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw httpError(400, 'Invalid GitHub path');
    }
    // Explicit GraphQL queries are safe to retry; GraphQL mutations remain writes.
    const safeRead = method === 'GET' || (method === 'POST' && path === '/graphql' && readOnly);
    let response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await fetcher(`https://api.github.com${path}`, {
          method,
          signal: AbortSignal.timeout(15000),
          headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'X-GitHub-Api-Version': '2026-03-10',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch {
        if (safeRead && attempt < 2) {
          await delay(250 * 2 ** attempt);
          continue;
        }
        throw httpError(502, 'GitHub connection failed');
      }
      if (safeRead && attempt < 2 && [500, 502, 503, 504].includes(response.status)) {
        // Only retry safe reads; a write may have succeeded despite its error response.
        await response.body?.cancel();
        await delay(250 * 2 ** attempt);
        continue;
      }
      if (!response.ok) {
        const status = [400, 401, 403, 404, 409, 422].includes(response.status) ? response.status : 502;
        throw httpError(status, 'GitHub request failed');
      }
      if (response.status === 204) return null;
      try {
        return await response.json();
      } catch (error) {
        if (!(error instanceof SyntaxError) && safeRead && attempt < 2) {
          await delay(250 * 2 ** attempt);
          continue;
        }
        throw httpError(502, 'Invalid GitHub response');
      }
    }
  };
}
