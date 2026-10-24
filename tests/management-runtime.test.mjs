import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { loadConfig, seal, setCookie } from "../server/auth.mjs";

test("Vercel configuration routes nested API requests and disables automatic Git deployment", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const route = config.rewrites.find(route => route.source === "/api/:path*");
  assert.equal(route.destination, "/api?path=:path*");
  assert.equal(config.git.deploymentEnabled, false);
});

test("Vite serves management requests with their method, body and separate cookies", async () => {
  const env = {
    CMS_ORIGIN: "http://127.0.0.1",
    GITHUB_CLIENT_ID: "client",
    GITHUB_CLIENT_SECRET: "secret",
    CMS_SESSION_KEY: "k".repeat(32),
    GITHUB_ADMIN_USER_ID: "42",
    GITHUB_APP_ID: "11",
    GITHUB_INSTALLATION_ID: "12",
    GITHUB_APP_REPOSITORY_ID: "13",
    GITHUB_CONTENT_REPOSITORY_ID: "14",
    GITHUB_APP_BRANCH: "main",
    GITHUB_CONTENT_BRANCH: "main",
  };
  const previousEnv = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  const nativeFetch = globalThis.fetch;
  let uploadedBlob;
  let server;
  Object.assign(process.env, env);
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    let result;
    if (path === "/user") {
      result = { id: 42, login: "owner" };
    } else if (path === "/user/installations") {
      result = { installations: [{ id: 12, app_id: 11, permissions: { contents: "write", actions: "write" } }] };
    } else if (path === "/user/installations/12/repositories") {
      result = { repositories: [{ id: 13 }, { id: 14 }] };
    } else if (path.endsWith("/branches/main")) {
      result = { commit: { sha: "b".repeat(40) } };
    } else if (path.endsWith("/contents/content")) {
      result = { type: "submodule", sha: "a".repeat(40), submodule_git_url: "https://github.com/gyungsubLee/subdev-blog-content.git" };
    } else if (path.endsWith("/contents/.gitmodules")) {
      result = { content: Buffer.from('[submodule "content"]\n path = content\n url = https://github.com/gyungsubLee/subdev-blog-content.git\n').toString("base64") };
    } else if (path.includes("/actions/workflows/")) {
      result = { state: "active" };
    } else if (path.includes("/contents/")) {
      result = { type: "file" };
    } else if (path.endsWith("/git/blobs") && options.method === "POST") {
      uploadedBlob = JSON.parse(options.body);
      result = { sha: "c".repeat(40) };
    } else if (path === "/repos/gyungsubLee/subdev-blog" || path === "/repos/gyungsubLee/subdev-blog-content") {
      result = { id: path.endsWith("-content") ? 14 : 13, default_branch: "main", permissions: { push: true } };
    } else {
      throw new Error(`Unexpected GitHub request: ${path}`);
    }
    return Response.json(result);
  };

  try {
    server = await createServer({ server: { host: "127.0.0.1", port: 0, watch: null } });
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    for (const path of ["/api/session", "/api?path=session"]) {
      const session = await nativeFetch(origin + path);
      assert.equal(session.headers.get("cache-control"), "no-store");
      assert.deepEqual(await session.json(), { state: "signed_out" });
    }
    assert.equal((await nativeFetch(`${origin}/api/session`, { method: "POST" })).status, 405);
    assert.equal((await nativeFetch(`${origin}/api/unknown`)).status, 404);

    const callback = await nativeFetch(`${origin}/api/auth/callback?error=access_denied`);
    assert.equal(callback.status, 401);
    assert.equal(callback.headers.getSetCookie().length, 2);
    assert.ok(callback.headers.getSetCookie().every(cookie => /Max-Age=0/.test(cookie)));

    const config = loadConfig(env);
    const cookie = setCookie(seal({ token: "private", csrfToken: "csrf", expires: Date.now() + 60000 }, config), config).split(";")[0];
    const headers = { cookie, origin: env.CMS_ORIGIN, "x-csrf-token": "csrf", "content-type": "application/json" };
    const upload = await nativeFetch(`${origin}/api/assets`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "YWJj" }),
    });
    const uploaded = await upload.json();
    assert.equal(upload.status, 200, uploaded.error);
    assert.deepEqual(uploaded, { sha: "c".repeat(40), size: 3 });
    assert.deepEqual(uploadedBlob, { content: "YWJj", encoding: "base64" });

    const tooLarge = await nativeFetch(`${origin}/api/assets`, {
      method: "POST",
      headers,
      body: JSON.stringify({ content: "A".repeat(4 * 1024 * 1024) }),
    });
    assert.equal(tooLarge.status, 413);
    assert.equal((await nativeFetch(`${origin}/apiary`)).headers.get("content-type"), "text/html");
  } finally {
    await server?.close();
    globalThis.fetch = nativeFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
