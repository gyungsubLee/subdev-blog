import assert from "node:assert/strict";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "../support/load-component.mjs";
const dom = new JSDOM("", { url: "http://localhost" });
const originalStorage = globalThis.localStorage;
globalThis.localStorage = dom.window.localStorage;
const { ensureWriterCategory } = await loadComponent(
  "app/web/src/features/content-management/writer-category.ts",
);
const pending = [
  { id: "parent", name: "Parent", parent_id: null, order: 0, sources: [] },
  { id: "new", name: "New", parent_id: "parent", order: 0, sources: [] },
  {
    id: "unrelated",
    name: "Unrelated",
    parent_id: null,
    order: 1,
    sources: [],
  },
];
const reply = (value, status = 200) => ({
  ok: status < 400,
  status,
  json: async () => value,
});
after(() => {
  dom.window.close();
  globalThis.localStorage = originalStorage;
});

test(
  "first-post category creation preserves a lost-response request but refreshes a definite conflict",
  { timeout: 5000 },
  async () => {
    const previous = globalThis.fetch;
    let phase = "conflict";
    let reads = 0;
    const payloads = [];
    globalThis.fetch = async (url, options = {}) => {
      if (url === "/api/content?kind=categories") {
        reads++;
        return reply({
          categories: [],
          revision: "r" + reads,
          contentCommit: "b" + reads,
        });
      }
      const request = JSON.parse(options.body);
      payloads.push(request);
      assert.equal(options.headers["x-csrf-token"], "csrf");
      if (phase === "conflict")
        return reply({ error: "Canonical branch changed" }, 409);
      if (phase === "lost") throw Error("connection lost");
      return reply({ state: "published", contentCommit: "published" });
    };
    try {
      localStorage.clear();
      await assert.rejects(
        () => ensureWriterCategory("new", pending, "csrf"),
        /branch changed/,
      );
      assert.ok(
        localStorage.getItem("second-brain:writer-category:new") === null,
        "confirmed conflicts permit fresh source on next attempt",
      );
      phase = "lost";
      await assert.rejects(
        () => ensureWriterCategory("new", pending, "csrf"),
        /connection lost/,
      );
      const retained = localStorage.getItem("second-brain:writer-category:new");
      assert.ok(retained !== null);
      phase = "success";
      assert.equal(
        await ensureWriterCategory("new", pending, "csrf"),
        "published",
      );
      assert.equal(reads, 2, "lost-response retry reuses the captured source");
      assert.equal(
        JSON.stringify(payloads[1]),
        JSON.stringify(payloads[2]),
        "retry sends the exact captured payload",
      );
      assert.deepEqual(
        payloads[2].operation.categories.map((category) => category.id),
        ["parent", "new"],
      );
      assert.equal(
        localStorage.getItem("second-brain:writer-category:new"),
        null,
      );
    } finally {
      globalThis.fetch = previous;
    }
  },
);
