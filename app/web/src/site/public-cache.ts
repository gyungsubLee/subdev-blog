const CACHE_NAME = "second-brain:public:v1";
const FALLBACK_PREFIX = CACHE_NAME + ":";

export async function readPublicCache(path: string): Promise<unknown> {
  try {
    if (typeof caches !== "undefined") {
      const response = await (await caches.open(CACHE_NAME)).match(path);
      return response ? response.json() : null;
    }
    return JSON.parse(localStorage.getItem(FALLBACK_PREFIX + path) ?? "null");
  } catch {
    return null;
  }
}

export async function writePublicCache(path: string, value: unknown): Promise<void> {
  try {
    if (typeof caches !== "undefined") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(path, Response.json(value));
      const articles = (await cache.keys()).filter(request => new URL(request.url).searchParams.get("kind") === "post");
      // ponytail: retain the index and 32 visited bodies; expand only if offline use needs more.
      for (const request of articles.slice(0, Math.max(0, articles.length - 32))) await cache.delete(request);
    } else {
      localStorage.setItem(FALLBACK_PREFIX + path, JSON.stringify(value));
      const articles = Object.keys(localStorage).filter(key => key.startsWith(FALLBACK_PREFIX) && key.includes("kind=post"));
      for (const key of articles.slice(0, Math.max(0, articles.length - 32))) localStorage.removeItem(key);
    }
  } catch {
    // A full/disabled cache must not discard displayed content or user drafts.
  }
}
