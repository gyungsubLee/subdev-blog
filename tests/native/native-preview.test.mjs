import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createServer, preview } from "vite";

test("native preview serves built files, its own health token and the existing API", { timeout: 60000 }, async () => {
  const { version } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const previousToken = process.env.SECOND_BRAIN_NATIVE_TOKEN;
  process.env.SECOND_BRAIN_NATIVE_TOKEN = "native-preview-check";
  let development;
  let production;
  try {
    development = await createServer({ optimizeDeps: { noDiscovery: true, include: [] }, server: { host: "127.0.0.1", port: 15174, strictPort: true, watch: null } });
    await development.listen();
    production = await preview({ preview: { host: "127.0.0.1", port: 15173, strictPort: true } });
    const origin = "http://127.0.0.1:15173";
    const health = await fetch(origin + "/__native/health", { signal: AbortSignal.timeout(5000) });
    assert.deepEqual(await health.json(), { token: "native-preview-check" });
    assert.equal(health.headers.get("cache-control"), "no-store");
    const info = await fetch(origin + "/build-info.json", { signal: AbortSignal.timeout(5000) });
    assert.equal(info.status, 200, "Build the web app before checking native preview");
    assert.equal((await info.json()).version, version);
    const home = await fetch(origin, { signal: AbortSignal.timeout(5000) });
    assert.equal(home.status, 200);
    assert.ok((await home.text()).includes("/assets/"), "Preview must serve the compiled page");

    for (const [label, port] of [["development", 15174], ["preview", 15173]]) {
      const start = performance.now();
      for (let index = 0; index < 20; index++) {
        const response = await fetch(`http://127.0.0.1:${port}/api/unknown`, { signal: AbortSignal.timeout(5000) });
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "Not found" });
      }
      console.log(`${label}: 20 identical local API requests in ${(performance.now() - start).toFixed(1)} ms`);
    }
    const large = await fetch(origin + "/api/assets", {
      method: "POST",
      body: "A".repeat(4 * 1024 * 1024 + 1),
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(large.status, 413);
    await large.arrayBuffer();
  } finally {
    production?.httpServer.closeAllConnections();
    if (production) await new Promise((resolve, reject) => production.httpServer.close(error => error ? reject(error) : resolve()));
    await development?.close();
    if (previousToken === undefined) delete process.env.SECOND_BRAIN_NATIVE_TOKEN;
    else process.env.SECOND_BRAIN_NATIVE_TOKEN = previousToken;
  }
});
