import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readContent } from "../scripts/content.mjs";
import { migrateLegacyContent } from "../scripts/migrate-content.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rootId = "10000000-0000-8000-8000-000000000001";
const childId = "10000000-0000-8000-8000-000000000002";
const siblingId = "10000000-0000-8000-8000-000000000003";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "content-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "legacy");
  const publicRoot = path.join(source, "public");
  const writtenDir = path.join(source, "written");
  await mkdir(path.join(publicRoot, "notion/assets"), { recursive: true });
  await mkdir(writtenDir);
  const posts = [
    { id: rootId, title: "Main", parentId: null, category: "Main", markdown: "\n" },
    {
      id: siblingId, title: "Sibling", parentId: rootId, category: "Main",
      markdown: "![shared](/notion/assets/old.png)\n",
    },
    { id: childId, title: "Original", parentId: rootId, category: "Main", markdown: "Original body\n" },
  ].map((post) => ({
    createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
    path: post.title + "/index.md", url: "https://www.notion.so/" + post.id.replaceAll("-", ""),
    breadcrumbs: [{ id: rootId, title: "Main" }], excerpt: "source excerpt", cover: null, icon: null,
    notionProperties: { "key ": " value ", id: "opaque", nested: [null, { keep: true }] },
    opaque: { nested: [{ value: 42 }], empty: [] }, ...post,
  }));
  const postsPath = path.join(source, "posts.json");
  const assetMapPath = path.join(publicRoot, "notion/asset-map.json");
  await writeFile(postsPath, JSON.stringify(posts));
  await writeFile(assetMapPath, JSON.stringify({ "/notion/assets/old.png": "/notion/assets/current.webp" }));
  await writeFile(path.join(publicRoot, "notion/assets/current.webp"), Buffer.from([0, 1, 2, 255]));
  await writeFile(path.join(publicRoot, "notion/assets/unowned.bin"), "retained backup");
  await writeFile(path.join(source, "archive.md"), "Never import this stale body");
  return { root, source, posts, postsPath, writtenDir, assetMapPath, publicRoot, targetRoot: path.join(root, "staging") };
}

// Dropping the written override, extension fields, mapping, or per-post copies breaks these literal expectations.
test("written overrides and current public asset bytes survive migration", async (t) => {
  const input = await fixture(t);
  const writtenBody = [
    "Latest body", "![image](/notion/assets/old.png)",
    '<img src="/notion/assets/old.png">',
    "`/notion/assets/old.png`", "```md", "![example](/notion/assets/old.png)", "```", "",
  ].join("\n");
  await writeFile(path.join(input.writtenDir, "override.json"), JSON.stringify({
    id: childId, title: "Written title", markdown: writtenBody,
    cover: "/notion/assets/old.png", icon: "/icons/book_blue.svg", category: "Spring ( Java )",
  }));
  const report = await migrateLegacyContent({ ...input, dryRun: false });
  assert.deepEqual(report.errors, []);
  const migrated = await readContent(input.targetRoot);
  const child = migrated.documents.get(childId);
  assert.equal(child.markdown, [
    "Latest body", "![image](current.webp)", '<img src="current.webp">',
    "`/notion/assets/old.png`", "```md", "![example](/notion/assets/old.png)", "```", "",
  ].join("\n"));
  assert.equal(child.metadata.title, "Written title");
  assert.deepEqual(child.metadata.notionProperties, input.posts[2].notionProperties);
  assert.deepEqual(child.metadata.opaque, input.posts[2].opaque);
  assert.deepEqual(child.metadata.breadcrumbs, input.posts[2].breadcrumbs);
  assert.equal(child.metadata.created, input.posts[2].createdAt);
  assert.equal(child.metadata.updated, input.posts[2].updatedAt);
  assert.equal(child.metadata.legacy_path, "Original/index.md");
  assert.equal(child.metadata.legacy_category, "Spring ( Java )");
  assert.equal(child.metadata.cover, "current.webp");
  assert.equal(child.metadata.icon, "/icons/book_blue.svg");
  assert.equal(child.metadata.category_id, "source:Spring ( Java )");
  assert.equal(migrated.documents.get(rootId).markdown, "\n");
  assert.equal(migrated.documents.get(siblingId).metadata.order, 0);
  assert.equal(child.metadata.order, 1);
  assert.equal(migrated.documents.get(siblingId).metadata.category_id, undefined);
  for (const id of [childId, siblingId]) {
    const copied = await readFile(path.join(input.targetRoot, "posts", id, "current.webp"));
    assert.equal(hash(copied), hash(Buffer.from([0, 1, 2, 255])));
  }
  const backend = migrated.categories.find((item) => item.id === "group:backend");
  assert.equal(backend.name, "백엔드");
  assert.deepEqual(migrated.categories.find((item) => item.id === "source:Spring ( Java )"), {
    id: "source:Spring ( Java )", name: "Spring ( Java )", parent_id: "group:backend",
    order: 0, sources: ["Spring ( Java )"],
  });
  assert.equal(report.categoryChanges[0].id, childId);
  assert.deepEqual(report.unownedFiles.map((item) => item.path), ["notion/assets/unowned.bin"]);
  assert.equal(await readFile(path.join(input.source, "archive.md"), "utf8"), "Never import this stale body");
});

// Writing during dry-run, unstable order, or overwriting an existing output breaks this check.
test("dry-run leaves inputs untouched and independent staging outputs are deterministic", async (t) => {
  const input = await fixture(t);
  const before = await readFile(input.postsPath);
  const dry = await migrateLegacyContent({ ...input, dryRun: true });
  assert.deepEqual(dry.errors, []);
  assert.deepEqual(await readdir(input.root), ["legacy"]);
  assert.deepEqual(await readFile(input.postsPath), before);
  assert.equal(dry.counts.posts, 3);
  assert.equal(dry.counts.attachments, 1);
  assert.equal(dry.counts.assetCopies, 1);
  const first = await migrateLegacyContent({ ...input, dryRun: false });
  const second = await migrateLegacyContent({ ...input, targetRoot: path.join(input.root, "repeat"), dryRun: false });
  assert.equal(first.outputHash, dry.outputHash);
  assert.equal(first.outputHash, second.outputHash);
  assert.deepEqual(first.outputFiles, second.outputFiles);
  const existing = await migrateLegacyContent({ ...input, dryRun: false });
  assert.match(existing.errors.join("\n"), /exist/i);
  assert.deepEqual(await readFile(input.postsPath), before);
});

// Missing bytes must never produce a success report or a partly published tree.
test("missing or escaping attachments fail before staging is created", async (t) => {
  const input = await fixture(t);
  await writeFile(path.join(input.writtenDir, "bad.json"), JSON.stringify({
    id: childId, markdown: "![missing](/notion/assets/missing.png)\n",
  }));
  const missing = await migrateLegacyContent({ ...input, dryRun: false });
  assert.match(missing.errors.join("\n"), /missing.png/);
  assert.deepEqual(await readdir(input.root), ["legacy"]);
  await writeFile(path.join(input.assetMapPath), JSON.stringify({
    "/notion/assets/old.png": "/notion/assets/%2e%2e/%2e%2e/private.txt",
  }));
  const escaping = await migrateLegacyContent({ ...input, dryRun: false });
  assert(escaping.errors.length > 0);
  assert.deepEqual(await readdir(input.root), ["legacy"]);
});

// An optional written cache must not become a required migration input.
test("a missing written directory uses the current posts unchanged", async (t) => {
  const input = await fixture(t);
  await rm(input.writtenDir, { recursive: true });
  const report = await migrateLegacyContent({ ...input, dryRun: true });
  assert.deepEqual(report.errors, []);
  assert.equal(report.counts.posts, 3);
  assert.equal(report.documents.find((document) => document.id === childId).sourceBodyHash, hash("Original body\n"));
});

// Stored filenames contain literal percent characters; only URL destinations are decoded.
test("literal percent in source paths and canonical titles survives URL lookup", async (t) => {
  const input = await fixture(t);
  input.posts[2].title = "vw, vh, %";
  input.posts[2].path = "vw, vh, %/index.md";
  input.posts[1].markdown = "[percent](../vw%2C%20vh%2C%20%25/index.md#section)\n";
  await writeFile(input.postsPath, JSON.stringify(input.posts));
  const report = await migrateLegacyContent({ ...input, dryRun: false });
  assert.deepEqual(report.errors, []);
  const migrated = await readContent(input.targetRoot);
  assert.equal(migrated.documents.get(childId).metadata.legacy_path, "vw, vh, %/index.md");
  assert.equal(migrated.documents.get(siblingId).markdown, "[percent](#/post/" + childId + "#section)\n");
});

// Decoding twice would resolve this URL to a different file with a space in its name.
test("percent-encoded-looking raw paths are decoded only at the URL boundary", async (t) => {
  const input = await fixture(t);
  input.posts[2].title = "literal %20";
  input.posts[2].path = "literal %20/index.md";
  input.posts[1].markdown = "[literal](../literal%20%2520/index.md)\n";
  await writeFile(input.postsPath, JSON.stringify(input.posts));
  const report = await migrateLegacyContent({ ...input, dryRun: false });
  assert.deepEqual(report.errors, []);
  const migrated = await readContent(input.targetRoot);
  assert.equal(migrated.documents.get(childId).metadata.legacy_path, "literal %20/index.md");
  assert.equal(migrated.documents.get(siblingId).markdown, "[literal](#/post/" + childId + ")\n");
});
