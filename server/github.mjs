export function httpError(status, message, details) {
  return Object.assign(new Error(message), { status, details });
}

export function createGitHubClient(token, fetcher = globalThis.fetch) {
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw httpError(400, 'Invalid GitHub path');
    }
    let response;
    try {
      response = await fetcher(`https://api.github.com${path}`, {
        method,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2026-03-10',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw httpError(502, 'GitHub connection failed');
    }
    if (!response.ok) {
      const status = [400, 401, 403, 404, 409, 422].includes(response.status) ? response.status : 502;
      throw httpError(status, 'GitHub request failed');
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw httpError(502, 'Invalid GitHub response');
    }
  };
}
