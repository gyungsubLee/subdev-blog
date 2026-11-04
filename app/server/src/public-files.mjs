import { httpError } from './github.mjs';

export const SHA = /^[a-f0-9]{40}$/;
export const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const PUBLIC_VERSION = 1;
export const MAX_PUBLIC_FILE = 16 * 1024 * 1024;

export function requirePublic(condition, message, status = 502) {
  if (!condition) throw httpError(status, message);
}

export function rawContentUrl(repository, commit, path) {
  return `https://raw.githubusercontent.com/${repository}/${commit}/` + path.split('/').map(encodeURIComponent).join('/');
}

export async function fetchPublicBytes(fetcher, url, limit, missingStatus = 502, signal) {
  let response;
  try {
    response = await fetcher(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  } catch {
    throw httpError(502, 'Public content connection failed');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw httpError(response.status === 404 ? missingStatus : 502, 'Public content file unavailable');
  }
  const reader = response.body?.getReader();
  requirePublic(reader, 'Invalid public content file');
  const chunks = [];
  let size = 0;
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      requirePublic(size <= limit, 'Public content file too large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => { });
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export function parsePublicJson(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { throw httpError(502, 'Invalid public content JSON'); }
}

