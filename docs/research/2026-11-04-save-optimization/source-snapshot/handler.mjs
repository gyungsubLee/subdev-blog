import { createHash, randomBytes } from 'node:crypto';
import { loadConfig, authenticate, checkConnection, seal, readCookie, setCookie, equalSecret, sessionBinding } from './auth.mjs';
import { createGitHubClient, httpError } from './github.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const redirect = (location, cookies = []) => {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 302, headers });
};

export async function handleRequest(request, { env = process.env, fetcher = globalThis.fetch } = {}) {
  const url = new URL(request.url);
  const path = url.pathname === '/api' ? `/api/${url.searchParams.get('path') || ''}` : url.pathname;
  const allowed = {
    '/api/public': ['GET'],
    '/api/auth/github': ['GET'],
    '/api/auth/callback': ['GET'],
    '/api/session': ['GET'],
    '/api/logout': ['POST'],
    '/api/content': ['GET', 'POST'],
    '/api/assets': ['POST'],
    '/api/publish': ['GET', 'POST'],
  };
  if (!allowed[path]) return json({ error: 'Not found' }, 404);
  if (!allowed[path].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  try {
    if (path === '/api/public') {
      const { handlePublicRequest } = await import('./public-content.mjs');
      const normalized = new URL(request.url);
      normalized.pathname = path;
      normalized.searchParams.delete('path');
      return await handlePublicRequest(new Request(normalized, request), { env, fetcher });
    }
    const config = loadConfig(env);
    if (path === '/api/auth/github') {
      let pending;
      try {
        pending = readCookie(request, config, 'oauth');
        if (typeof pending.state !== 'string' || typeof pending.verifier !== 'string') pending = undefined;
      } catch { /* A missing or expired challenge starts a new login. */ }
      const state = pending?.state ?? randomBytes(32).toString('base64url');
      const verifier = pending?.verifier ?? randomBytes(32).toString('base64url');
      const target = new URL('https://github.com/login/oauth/authorize');
      target.search = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: `${config.origin}/api/auth/callback`,
        state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      return redirect(target.href, pending ? [] : [setCookie(seal({ state, verifier, expires: Date.now() + 600000 }, config), config, 'oauth', 600)]);
    }
    if (path === '/api/auth/callback') {
      const clear = setCookie('', config, 'oauth', 0);
      let matchesPending = false;
      try {
        const pending = readCookie(request, config, 'oauth');
        matchesPending = equalSecret(url.searchParams.get('state'), pending.state);
        if (url.searchParams.has('error') || !matchesPending || !url.searchParams.get('code')) {
          throw httpError(401, 'GitHub login was not completed');
        }
        const exchangeStartedAt = Date.now();
        let response;
        try {
          response = await fetcher('https://github.com/login/oauth/access_token', {
            method: 'POST',
            signal: AbortSignal.timeout(15000),
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              client_id: config.clientId,
              client_secret: config.clientSecret,
              code: url.searchParams.get('code'),
              code_verifier: pending.verifier,
              redirect_uri: `${config.origin}/api/auth/callback`,
            }),
          });
        } catch {
          throw httpError(502, 'GitHub login failed');
        }
        const result = await response.json();
        if (!response.ok || !result.access_token || !Number.isFinite(result.expires_in) || result.expires_in <= 1) {
          throw httpError(401, 'GitHub login failed');
        }
        const user = await createGitHubClient(result.access_token, fetcher)('/user');
        if (user.id !== config.adminUserId) {
          throw httpError(403, 'Owner access required');
        }
        await checkConnection(result.access_token, config, fetcher);
        const expires = exchangeStartedAt + Math.min(3600, Math.floor(result.expires_in) - 1) * 1000;
        const lifetime = Math.floor((expires - Date.now()) / 1000);
        if (lifetime <= 0) {
          throw httpError(401, 'GitHub token expired during login');
        }
        const session = seal({
          version: 1,
          issuedAt: exchangeStartedAt,
          binding: sessionBinding(config),
          user: { id: user.id, login: user.login, name: user.name },
          token: result.access_token,
          csrfToken: randomBytes(32).toString('base64url'),
          expires,
        }, config);
        return redirect(config.origin, [clear, setCookie(session, config, 'session', lifetime)]);
      } catch (error) {
        const result = json({ error: error.status ? error.message : 'GitHub login failed' }, error.status || 502);
        // A stale callback must not erase a newer challenge or an existing session.
        if (matchesPending) result.headers.append('Set-Cookie', clear);
        return result;
      }
    }
    if (path === '/api/session') {
      try {
        const auth = await authenticate(request, config, fetcher);
        const connection = auth.connection;
        return json({ state: 'ready', user: auth.user, csrfToken: auth.csrfToken, connection });
      } catch (error) {
        if (error.status === 401) {
          return json({ state: 'signed_out' });
        }
        return json({
          state: 'blocked',
          error: error.status ? error.message : 'GitHub connection failed',
          retryable: !error.status || error.status >= 500,
        });
      }
    }
    const auth = await authenticate(request, config, fetcher, { mutate: request.method !== 'GET' });
    if (path === '/api/logout') {
      const response = json({ state: 'signed_out' });
      response.headers.append('Set-Cookie', setCookie('', config, 'session', 0));
      return response;
    }
    const connection = auth.connection;
    const { handleContentRequest } = await import('./content.mjs');
    const normalized = new URL(request.url);
    normalized.pathname = path;
    normalized.searchParams.delete('path');
    return await handleContentRequest(new Request(normalized, request), { token: auth.token, config, fetcher, connection });
  } catch (error) {
    const message = error.status ? error.message : 'Management request failed';
    if (path === '/api/session') {
      return json({ state: 'blocked', error: message });
    }
    return json({
      error: message,
      ...(error.details ? { details: error.details } : {}),
    }, error.status || 500);
  }
}
