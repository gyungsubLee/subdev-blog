import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";
import { parseMarkdownDocument } from "../src/shared/document.mjs";

const run = promisify(execFile);
const id = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const body = '<a id="anchor"></a>\r\n$E=mc^2$\r\n```mermaid\r\ngraph TD; A-->B\r\n```\r\n![image](./image.png)\r\n';
function full({ documentId = id, title = "Original", revision, markdown = body, fields = "" } = {}) {
  return `---\nschema_version: 1\nid: ${documentId}\ntitle: ${title}\nparent_id: null\ncategory_id: cat:dev\ncreated: 2026-10-22\nupdated: 2026-10-22\nsummary: AI_SECRET\ntags: [one, two]\nextension: {nested: [true, null, 3]}\n${revision ? `base_revision: ${revision}\n` : ""}${fields}---\n${markdown}`;
}
async function fixture(t, existing = true) {
  const base = await mkdtemp(path.join(os.tmpdir(), "content-import-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "content");
  const input = path.join(base, "input");
  await mkdir(path.join(root, "posts"), { recursive: true });
  await mkdir(input);
  await writeFile(path.join(root, "categories.json"), JSON.stringify([{ id: "cat:dev", name: "Development", parent_id: null, order: 0, sources: ["개발"] }]));
  if (existing) {
    await mkdir(path.join(root, "posts", id));
    await writeFile(path.join(root, "posts", id, "Original.md"), full());
    await writeFile(path.join(root, "posts", id, "image.png"), Buffer.from([0, 1, 2, 255]));
  }
  const source = path.join(input, "input.md");
  return { root, input, source };
}
async function importer() {
  const module = await import("../scripts/import-markdown.mjs");
  assert.equal(typeof module.importMarkdown, "function", "importer must be callable without running the CLI");
  return module.importMarkdown;
}
async function tree(root) {
  const result = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const filename = path.join(root, entry.name);
    if (entry.isDirectory()) {
      for (const [name, hash] of Object.entries(await tree(filename))) result[entry.name + "/" + name] = hash;
    } else result[entry.name] = digest(await readFile(filename));
  }
  return result;
}

test("full imports preserve metadata, original body and actual sibling bytes", async (t) => {
  const { root, input, source } = await fixture(t, false);
  await writeFile(source, full());
  await writeFile(path.join(input, "image.png"), Buffer.from([0, 1, 2, 255]));
  const result = await (await importer())(source, { contentRoot: root, dryRun: false });
  assert.equal(result.id, id);
  assert.equal(result.filename, `posts/${id}/Original.md`);
  const saved = await readFile(path.join(root, result.filename));
  assert.equal(result.revision, digest(saved));
  const document = parseMarkdownDocument(saved.toString());
  assert.equal(document.markdown, body);
  assert.equal(document.metadata.summary, "AI_SECRET");
  assert.deepEqual(document.metadata.extension, { nested: [true, null, 3] });
  assert.deepEqual(await readFile(path.join(root, "posts", id, "image.png")), Buffer.from([0, 1, 2, 255]));
});

test("stale public patches leave canonical files unchanged", async (t) => {
  const { root, source } = await fixture(t);
  const before = await tree(root);
  await writeFile(source, `---\nschema_version: 1\ndocument_mode: patch\nid: ${id}\nbase_revision: ${"0".repeat(64)}\ntitle: Renamed\n---\nchanged`);
  const importMarkdown = await importer();
  const applyStalePatch = () => importMarkdown(source, { contentRoot: root, dryRun: false });
  await assert.rejects(applyStalePatch(), /revision/i);
  assert.deepEqual(await tree(root), before);
});

test("guarded patches rename safely and retain hidden fields and owned public attachments", async (t) => {
  const { root, source } = await fixture(t);
  const revision = digest(await readFile(path.join(root, "posts", id, "Original.md")));
  await writeFile(source, `---\nschema_version: 1\ndocument_mode: patch\nid: ${id}\nbase_revision: ${revision}\ntitle: Renamed\n---\n![image](/content/assets/${id}/image.png)`);
  const result = await (await importer())(source, { contentRoot: root, dryRun: false });
  assert.equal(result.filename, `posts/${id}/Renamed.md`);
  const saved = parseMarkdownDocument(await readFile(path.join(root, result.filename), "utf8"));
  assert.equal(saved.metadata.summary, "AI_SECRET");
  assert.deepEqual(saved.metadata.extension, { nested: [true, null, 3] });
  assert.equal(saved.metadata.review_status, "needs_review");
  assert.deepEqual((await readdir(path.join(root, "posts", id))).sort(), ["Renamed.md", "image.png"]);
});

test("all existing full and legacy imports require one consistent current revision", async (t) => {
  const { root, source } = await fixture(t);
  const before = await tree(root);
  const revision = digest(await readFile(path.join(root, "posts", id, "Original.md")));
  const importMarkdown = await importer();
  for (const [text, expectedRevision] of [
    [full({ title: "Renamed" }), undefined],
    [full({ title: "Renamed", revision: "0".repeat(64) }), undefined],
    [full({ title: "Renamed", revision }), "0".repeat(64)],
    [`---\nid: ${other}\nsource_id: ${id}\ntitle: Legacy\n---\nbody`, undefined],
    [full({ documentId: other, revision }), revision],
  ]) {
    await writeFile(source, text);
    await assert.rejects(importMarkdown(source, { contentRoot: root, expectedRevision, dryRun: false }), /revision|exist/i);
    assert.deepEqual(await tree(root), before);
  }
  await writeFile(source, full({ title: "Renamed", revision }));
  await importMarkdown(source, { contentRoot: root, expectedRevision: revision, dryRun: false });
  assert.equal(parseMarkdownDocument(await readFile(path.join(root, "posts", id, "Renamed.md"), "utf8")).markdown, body);
});

test("invalid sibling and data attachments reject without touching canonical bytes", async (t) => {
  const { root, input, source } = await fixture(t);
  const before = await tree(root);
  const revision = digest(await readFile(path.join(root, "posts", id, "Original.md")));
  await symlink(path.join(root, "categories.json"), path.join(input, "escape.png"));
  for (const destination of ["./missing.png", "../escape.png", "./escape.png", "data:image/png;base64,!!!!", `/content/assets/${other}/image.png`]) {
    await writeFile(source, full({ revision, markdown: `![x](${destination})` }));
    await assert.rejects((await importer())(source, { contentRoot: root, dryRun: false }));
    assert.deepEqual(await tree(root), before);
  }
});

test("data images extract to deterministic siblings while protected source stays exact", async (t) => {
  const { root, source } = await fixture(t, false);
  const markdown = '![x](data:image/png;base64,AAEC/w==)\n`![example](data:image/png;base64,AAAA)`\n';
  await writeFile(source, full({ markdown }));
  const result = await (await importer())(source, { contentRoot: root, dryRun: false });
  const folder = path.join(root, "posts", id);
  const names = (await readdir(folder)).filter((name) => name.endsWith(".png"));
  assert.equal(names.length, 1);
  assert.deepEqual(await readFile(path.join(folder, names[0])), Buffer.from([0, 1, 2, 255]));
  const saved = parseMarkdownDocument(await readFile(path.join(root, result.filename), "utf8"));
  assert.equal(saved.markdown, `![x](./${names[0]})\n\`![example](data:image/png;base64,AAAA)\`\n`);
});

test("legacy source IDs localize old notion assets only within their canonical owner", async (t) => {
  const { root, source } = await fixture(t);
  const revision = digest(await readFile(path.join(root, "posts", id, "Original.md")));
  await writeFile(source, `---\nid: ${other}\nsource_id: ${id}\ntitle: Legacy\n---\n![old](/notion/assets/image.png)`);
  const result = await (await importer())(source, { contentRoot: root, expectedRevision: revision, dryRun: false });
  assert.equal(result.id, id);
  const saved = parseMarkdownDocument(await readFile(path.join(root, result.filename), "utf8"));
  assert.equal(saved.markdown.trim(), "![old](./image.png)");
  assert.equal(saved.metadata.summary, "AI_SECRET");
  await writeFile(source, "![old](/notion/assets/image.png)");
  await assert.rejects((await importer())(source, { contentRoot: root, dryRun: false }), /owner|attachment/i);
});

test("dry run validates references and returns the planned revision without writes", async (t) => {
  const { root, input, source } = await fixture(t, false);
  await writeFile(source, full());
  await writeFile(path.join(input, "image.png"), Buffer.from([0, 1, 2, 255]));
  const before = await tree(root);
  const importMarkdown = await importer();
  const planned = await importMarkdown(source, { contentRoot: root, dryRun: true });
  assert.equal(planned.dryRun, true);
  assert.deepEqual(await tree(root), before);
  const result = await importMarkdown(source, { contentRoot: root, dryRun: false });
  assert.equal(planned.revision, result.revision);
  assert.equal(planned.filename, result.filename);
  await writeFile(source, full({ documentId: other, markdown: "![x](missing.bin)" }));
  await assert.rejects(importMarkdown(source, { contentRoot: root, dryRun: true }));
});

test("CLI accepts positional input and canonical-root/dry-run options", async (t) => {
  const { root, source } = await fixture(t, false);
  await writeFile(source, full({ markdown: "body" }));
  const before = await tree(root);
  await importer();
  const { stdout } = await run(process.execPath, ["scripts/import-markdown.mjs", source, "--content-root", root, "--dry-run"]);
  assert.match(stdout, /11111111-1111-4111-8111-111111111111/);
  assert.deepEqual(await tree(root), before);
});

test("local CLI preserves a real binary sibling larger than the browser input limit", async (t) => {
  const { root, input, source } = await fixture(t, false);
  const bytes = Buffer.alloc(11 * 1024 * 1024, 37);
  bytes[0] = 17;
  bytes[bytes.length - 1] = 254;
  await writeFile(source, full({ markdown: "[large binary](./large.bin)\n" }));
  await writeFile(path.join(input, "large.bin"), bytes);
  const result = await (await importer())(source, { contentRoot: root, dryRun: false });
  const saved = await readFile(path.join(root, "posts", id, "large.bin"));
  assert.equal(result.id, id);
  assert.equal(saved.length, 11 * 1024 * 1024);
  assert.equal(digest(saved), digest(bytes));
  assert.equal(parseMarkdownDocument(await readFile(path.join(root, result.filename), "utf8")).markdown, "[large binary](./large.bin)\n");
});

test("local CLI extracts raster data URLs above the browser per-image limit", async (t) => {
  const { root, source } = await fixture(t, false);
  const bytes = Buffer.alloc(6 * 1024 * 1024, 27);
  const dataUrl = "data:image/png;base64," + bytes.toString("base64");
  await writeFile(source, full({ markdown: `![large image](${dataUrl})\n` }));
  const result = await (await importer())(source, { contentRoot: root, dryRun: false });
  const folder = path.join(root, "posts", id);
  const assets = (await readdir(folder)).filter((name) => name.endsWith(".png"));
  assert.equal(assets.length, 1);
  const saved = await readFile(path.join(folder, assets[0]));
  assert.equal(saved.length, 6 * 1024 * 1024);
  assert.equal(digest(saved), digest(bytes));
  assert.equal(parseMarkdownDocument(await readFile(path.join(root, result.filename), "utf8")).markdown, `![large image](./${assets[0]})\n`);
});
