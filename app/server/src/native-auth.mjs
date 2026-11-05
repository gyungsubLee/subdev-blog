import { randomBytes } from 'node:crypto';
import { cookieName, equalSecret } from './auth.mjs';

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

// One local app owns one login. No timers, files, or session tokens in URLs.
export function createNativeAuth({ token, origin, handleRequest, now = Date.now }) {
  let flow;
  const sessionName = cookieName({ origin: origin ?? '' });

  return async function handleNativeRequest(request) {
    const url = new URL(request.url);
    const nativeRoute = url.pathname.startsWith('/__native/auth/');
    if (!token) return nativeRoute ? json({ error: 'Not found' }, 404) : handleRequest(request);
    if (flow && flow.expires <= now()) flow = undefined;

    if (nativeRoute) {
      if (url.origin !== origin) return json({ error: 'Invalid origin' }, 403);
      const browserLogin = url.pathname === '/__native/auth/login';
      if (!browserLogin && (!equalSecret(request.headers.get('X-Second-Brain-Native'), token) ||
          (request.headers.has('origin') && request.headers.get('origin') !== origin))) {
        return json({ error: 'Forbidden' }, 403);
      }
      if (url.pathname === '/__native/auth/start') {
        if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
        if (!flow || flow.state === 'failed' || request.headers.get('X-Second-Brain-Restart') === '1') {
          flow = { id: randomBytes(32).toString('base64url'), expires: now() + 600000, state: 'waiting' };
        }
        return json({ flow: flow.id, url: `${origin}/__native/auth/login?flow=${flow.id}` });
      }
      if (!flow || !equalSecret(url.searchParams.get('flow'), flow.id)) {
        return json({ error: 'Login expired or cancelled' }, 410);
      }
      if (browserLogin) {
        if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
        if (flow.oauthState) return json({ error: 'Login already started' }, 410);
        const active = flow;
        // A new native flow owns a new challenge; an abandoned browser cookie
        // must not let its late callback complete the replacement flow.
        const headers = new Headers(request.headers);
        const oauthName = cookieName({ origin }, 'oauth');
        headers.set('cookie', (headers.get('cookie') || '').split(';')
          .map(part => part.trim()).filter(part => !part.startsWith(`${oauthName}=`)).join('; '));
        const result = await handleRequest(new Request(`${origin}/api/auth/github`, { headers }));
        const destination = result.headers.get('location');
        if (flow === active && result.status === 302 && destination) {
          active.oauthState = new URL(destination).searchParams.get('state');
          result.headers.set('Referrer-Policy', 'no-referrer');
        } else if (flow === active) {
          active.state = 'failed';
        }
        return result;
      }
      if (url.pathname === '/__native/auth/result') {
        if (request.method === 'DELETE') {
          flow = undefined;
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
        }
        if (request.method === 'POST') {
          if (flow.state !== 'complete') return json({ error: 'Login is not complete' }, 409);
          flow = undefined;
          return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
        }
        if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
        const result = json({ state: flow.state }, flow.state === 'waiting' ? 202 : 200);
        if (flow.state === 'complete') result.headers.append('Set-Cookie', flow.cookie);
        // Keep completed cookies until acknowledgement; a lost response may be retried.
        if (flow.state === 'failed') flow = undefined;
        return result;
      }
      return json({ error: 'Not found' }, 404);
    }

    const active = flow;
    const callback = url.pathname === '/api/auth/callback' && active?.state === 'waiting' && active.oauthState &&
      equalSecret(url.searchParams.get('state'), active.oauthState);
    const result = await handleRequest(request);
    if (!callback || flow !== active || active.expires <= now()) return result;
    const session = result.headers.getSetCookie().find(cookie => cookie.startsWith(`${sessionName}=`) &&
      !/Max-Age=0(?:;|$)/i.test(cookie));
    active.state = result.status === 302 && session ? 'complete' : 'failed';
    active.cookie = active.state === 'complete' ? session : undefined;
    const message = active.state === 'complete'
      ? '로그인을 완료했습니다. Second Brain 앱으로 돌아가세요.'
      : '로그인을 완료하지 못했습니다. Second Brain 앱에서 다시 시도해 주세요.';
    const headers = new Headers({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    });
    for (const cookie of result.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
    return new Response(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Second Brain 로그인</title><body style="font-family:system-ui;padding:48px;line-height:1.7"><p>${message}</p></body></html>`, { headers });
  };
}
