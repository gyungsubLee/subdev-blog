import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { serializeMarkdownDocument } from "../src/shared/document.mjs";

const prepare = path.resolve("scripts/prepare-site.mjs");
const parentId = "12345678-1234-8234-9234-123456789012";
const childId = "12345678-1234-8234-9234-123456789013";

async function fixture(t) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "content-build-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const root = path.join(cwd, "canonical");
  await mkdir(path.join(root, "posts"), { recursive: true });
  await writeFile(path.join(root, "categories.json"), JSON.stringify([
    { id: "merged", name: "Renamed", parent_id: null, order: 0, sources: ["Main", "Old"] },
    { id: "fresh", name: "Fresh category", parent_id: null, order: 1, sources: [] },
  ]));
  const markdown = '# Body\n\n---\n\n```js\nconst text = "---";\n```\n\n[PDF](./첨부.pdf)\n\n' + "body ".repeat(400);
  for (const [id, metadata, body] of [
    [parentId, { category_id: "merged", legacy_category: "Main" }, markdown],
    [childId, { parent_id: parentId, legacy_category: "Old", updated: "2026-01-01T00:00:00.000Z" }, "Child body"],
  ]) {
    const folder = path.join(root, "posts", id);
    await mkdir(folder);
    await writeFile(path.join(folder, "Title.md"), serializeMarkdownDocument({
      metadata: {
        schema_version: 1, id, title: "Title", parent_id: null,
        created: "2025-01-01T00:00:00.000Z", updated: "2025-01-02T00:00:00.000Z",
        summary: "AI_INTERNAL_SENTINEL", tags: ["AI_INTERNAL_SENTINEL"],
        agent: { secret: "AI_INTERNAL_SENTINEL" }, ...metadata,
      },
      markdown: body,
    }));
  }
  await writeFile(path.join(root, "posts", parentId, "첨부.pdf"), "PDF_BYTES");
  await writeFile(path.join(root, "posts", parentId, "unused.txt"), "AI_INTERNAL_SENTINEL");
  await mkdir(path.join(cwd, "public", "notion"), { recursive: true });
  await writeFile(path.join(cwd, "public", "notion", "keep.bin"), "ORIGINAL_BYTES");
  return { cwd, root };
}

function build({ cwd, root }, imports = []) {
  return spawnSync(
    process.execPath,
    [...imports.flatMap((filename) => ["--import", filename]), prepare],
    { cwd, env: { ...process.env, CONTENT_ROOT: root }, encoding: "utf8" },
  );
}

test("public projections exclude agent metadata and preserve attachment URLs", async (t) => {
  const input = await fixture(t);
  const result = build(input);
  assert.equal(result.status, 0, result.stderr);
  const output = path.join(input.cwd, "public", "content");
  const indexBytes = await readFile(path.join(output, "index.json"), "utf8");
  const index = JSON.parse(indexBytes);
  const bodyBytes = await readFile(path.join(output, "posts", parentId + ".json"), "utf8");
  const post = JSON.parse(bodyBytes);
  const categories = await readFile(path.join(output, "categories.json"), "utf8");
  assert.doesNotMatch(indexBytes + bodyBytes + categories, /AI_INTERNAL_SENTINEL/);
  assert.equal(index.length, 2);
  assert.equal(index[0].id, childId, "normal lists retain descending update time");
  assert.ok(index.every((item) => item.bodyLoaded === false && item.markdown.length <= 1400));
  assert.equal(post.bodyLoaded, true);
  assert.ok(post.markdown.length > 1400);
  assert.match(post.markdown, /\n---\n/);
  assert.match(post.markdown, /const text = "---"/);
  assert.ok(post.markdown.includes(`/content/assets/${parentId}/%EC%B2%A8%EB%B6%80.pdf`));
  assert.equal(post.category, "Main");
  assert.equal(index.find((item) => item.id === childId).category, "Old");
  assert.ok(index.every((item) => item.categoryId === "merged"));
  assert.equal(JSON.parse(categories).find((item) => item.id === "merged").name, "Renamed");
  assert.deepEqual(JSON.parse(categories).find((item) => item.id === "fresh").sources, ["fresh"]);
  const source = await readFile(path.join(input.root, "posts", parentId, "Title.md"));
  assert.equal(post.revision, createHash("sha256").update(source).digest("hex"));
  assert.deepEqual(await readdir(path.join(output, "assets", parentId)), ["첨부.pdf"]);
  assert.equal(await readFile(path.join(output, "assets", parentId, "첨부.pdf"), "utf8"), "PDF_BYTES");
  assert.equal(await readFile(path.join(input.cwd, "public", "notion", "keep.bin"), "utf8"), "ORIGINAL_BYTES");
  assert.match(result.stdout, /content commit.*unavailable/i);
});

test("invalid canonical input preserves the previous public output", async (t) => {
  const input = await fixture(t);
  const output = path.join(input.cwd, "public", "content");
  await mkdir(output);
  await writeFile(path.join(output, "index.json"), "PREVIOUS_OUTPUT");
  await writeFile(path.join(input.root, "categories.json"), "[]");
  assert.notEqual(build(input).status, 0);
  assert.equal(await readFile(path.join(output, "index.json"), "utf8"), "PREVIOUS_OUTPUT");
  assert.deepEqual(await readdir(path.join(input.cwd, "public")), ["content", "notion"]);
});

for (const failure of ["publish", "cleanup"]) {
  test(`public output handles ${failure} failure according to publication outcome`, async (t) => {
    const input = await fixture(t);
    const output = path.join(input.cwd, "public", "content");
    await mkdir(output);
    await writeFile(path.join(output, "index.json"), "PREVIOUS_OUTPUT");
    const inject = path.join(input.cwd, "inject.mjs");
    await writeFile(inject, `
      import fs from "node:fs/promises";
      import { syncBuiltinESMExports } from "node:module";
      const rename = fs.rename;
      const rm = fs.rm;
      fs.rename = async (from, to) => {
        if (${JSON.stringify(failure)} === "publish" && from.endsWith("/next"))
          throw new Error("INJECTED_PUBLISH_FAILURE");
        return rename(from, to);
      };
      fs.rm = async (target, options) => {
        if (${JSON.stringify(failure)} === "cleanup" && String(target).includes(".content-stage-"))
          throw new Error("INJECTED_CLEANUP_FAILURE");
        return rm(target, options);
      };
      syncBuiltinESMExports();
    `);
    const result = build(input, [inject]);
    const bytes = await readFile(path.join(output, "index.json"), "utf8");
    if (failure === "publish") {
      assert.notEqual(result.status, 0);
      assert.equal(bytes, "PREVIOUS_OUTPUT");
      assert.match(result.stderr, /INJECTED_PUBLISH_FAILURE/);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(bytes).length, 2);
      assert.match(result.stderr, /cleanup.*INJECTED_CLEANUP_FAILURE/i);
    }
  });
}
