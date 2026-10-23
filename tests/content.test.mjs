import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { serializeMarkdownDocument } from "../src/shared/document.mjs";
import { readContent, validateContent, toPublicPosts, toPublicCategories, writeContentDocument } from "../scripts/content.mjs";
import * as content from "../scripts/content.mjs";

const parentId = "1c3eda9b-0fe1-819c-beab-c6a3a1072bb9";
const inheritedChildId = "1d4eda9b-0fe1-80a2-95f7-e975482b1dcd";
const explicitChildId = "1dceda9b-0fe1-80d4-80ac-ee6d24a0638c";
const otherId = "12345678-1234-8234-9234-123456789012";
const categories = [
  { id: "source:리액트", name: "React", parent_id: null, order: 0, sources: ["리액트", "React 원문"] },
  { id: "source:CSS", name: "CSS", parent_id: null, order: 1, sources: ["CSS"] },
];
function document(id = parentId, overrides = {}, markdown = "# Body\n\nVisible body.\n") {
  return { metadata: {
    schema_version: 1, id, title: "Title", parent_id: null,
    created: "2025-01-01T00:00:00.000Z", updated: "2025-01-02T00:00:00.000Z",
    ...overrides,
  }, markdown };
}
async function fixture(t, docs = [document(parentId, { category_id: "source:리액트" }), document(inheritedChildId, { parent_id: parentId }), document(explicitChildId, { parent_id: parentId, category_id: "source:CSS" })]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "content-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "categories.json"), JSON.stringify(categories));
  await mkdir(path.join(root, "posts"));
  for (const doc of docs) {
    const directory = path.join(root, "posts", doc.metadata.id);
    await mkdir(directory);
    await writeFile(path.join(directory, "Title.md"), serializeMarkdownDocument(doc));
  }
  return root;
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("explicit child categories override inherited categories", async (t) => {
  const root = await fixture(t);
  const snapshot = await readContent(root);
  assert.equal(snapshot.effectiveCategories.get(inheritedChildId), "source:리액트");
  assert.equal(snapshot.effectiveCategories.get(explicitChildId), "source:CSS");
  validateContent(snapshot);
  assert.equal([...snapshot.documents.values()][0].filename.startsWith("posts/"), true);
});

test("rejects invalid post relations, duplicate IDs and categories", async (t) => {
  for (const [name, change] of [
    ["cycle", (s) => { [...s.documents.values()][0].metadata.parent_id = inheritedChildId; }],
    ["missing parent", (s) => { [...s.documents.values()][0].metadata.parent_id = otherId; }],
    ["duplicate ID", (s) => { s.documents.set("duplicate", [...s.documents.values()][0]); }],
    ["invalid category", (s) => { [...s.documents.values()][0].metadata.category_id = "missing"; }],
    ["missing reference", (s) => { [...s.documents.values()][0].metadata.related_ids = [otherId]; }],
    ["missing source", (s) => { [...s.documents.values()][0].metadata.source_ids = [otherId]; }],
    ["category cycle", (s) => { s.categories[0].parent_id = s.categories[1].id; s.categories[1].parent_id = s.categories[0].id; }],
    ["missing category parent", (s) => { s.categories[0].parent_id = "missing"; }],
    ["duplicate category", (s) => { s.categories.push(s.categories[0]); }],
    ["duplicate source", (s) => { s.categories[1].sources.push("리액트"); }],
  ]) {
    const snapshot = await readContent(await fixture(t));
    change(snapshot);
    assert.throws(() => validateContent(snapshot), undefined, name);
  }
});

test("public projection allowlists fields and uses each original category source only when valid", async (t) => {
  const root = await fixture(t, [document(parentId, { category_id: "source:리액트", legacy_category: "React 원문", summary: "SECRET", tags: ["SECRET"], notionProperties: { token: "SECRET" } }), document(inheritedChildId, { parent_id: parentId, legacy_category: "old" }), document(explicitChildId)]);
  const snapshot = await readContent(root);
  const posts = toPublicPosts(snapshot);
  assert.equal(posts.find((post) => post.id === parentId).category, "React 원문");
  assert.equal(posts.find((post) => post.id === inheritedChildId).category, "source:리액트");
  assert.equal(posts.find((post) => post.id === explicitChildId).category, "미분류");
  assert.equal(posts.find((post) => post.id === explicitChildId).categoryId, "group:unclassified");
  assert.equal(JSON.stringify(posts).includes("SECRET"), false);
  assert.ok(posts.every((post) => post.excerpt.includes("Visible body")));
  assert.equal(snapshot.documents.get(parentId).metadata.notionProperties.token, "SECRET");
  const publicCategories = toPublicCategories(snapshot);
  assert.ok(publicCategories.find((category) => category.id === "source:리액트").sources.includes("source:리액트"));
  assert.ok(publicCategories.find((category) => category.id === "group:unclassified").sources.includes("미분류"));
  const bytes = await readFile(path.join(root, "posts", parentId, "Title.md"));
  assert.equal(posts.find((post) => post.id === parentId).revision, digest(bytes));
});

test("collects referenced attachments, preserves icon expressions and resolves public links", async (t) => {
  const root = await fixture(t, [document(parentId, { category_id: "source:리액트", cover: "./a&b.webp", icon: "📖", legacy_path: "old/Parent.md" }, `![image](./a&amp;b.webp#part)\n[child](../${inheritedChildId}/Title.md#block)\n<img srcset="./a&amp;b.webp 1x, ./second.webp 2x">\n\n[external](https://example.com/file.pdf)\n\n\`![ignore](missing.webp)\``), document(inheritedChildId, { icon: "/icons/book_gray.svg" })]);
  const folder = path.join(root, "posts", parentId);
  await Promise.all([writeFile(path.join(folder, "a&b.webp"), "one"), writeFile(path.join(folder, "second.webp"), "two"), writeFile(path.join(folder, "unused.zip"), "unused")]);
  const snapshot = await readContent(root);
  const entry = snapshot.documents.get(parentId);
  assert.deepEqual(entry.assets.map((asset) => asset.name).sort(), ["a&b.webp", "second.webp"]);
  assert.ok(entry.assets.every((asset) => path.isAbsolute(asset.absolutePath)));
  const post = toPublicPosts(snapshot).find((item) => item.id === parentId);
  assert.ok(post.markdown.includes(`/content/assets/${parentId}/a%26b.webp#part`));
  assert.ok(post.markdown.includes(`#/post/${inheritedChildId}#block`));
  assert.equal(post.cover, `/content/assets/${parentId}/a%26b.webp`);
  assert.equal(post.icon, "📖");
  assert.equal(toPublicPosts(snapshot).find((item) => item.id === inheritedChildId).icon, "/icons/book_gray.svg");
  assert.ok(snapshot.externalDependencies.includes("https://example.com/file.pdf"));
});

test("keeps public attachment URLs as attachments even when they include an existing post ID", async (t) => {
  const root = await fixture(t, [document(parentId, {}, `[download](/content/assets/${parentId}/file.pdf#page=2)`)]);
  await writeFile(path.join(root, "posts", parentId, "file.pdf"), "PDF");
  const post = toPublicPosts(await readContent(root))[0];
  assert.equal(post.markdown, `[download](/content/assets/${parentId}/file.pdf#page=2)`);
});

test("rejects missing attachments, decoded traversal and symlink escapes", async (t) => {
  for (const url of ["./missing.png", "../outside.png", "./%2e%2e%2foutside.png", "./%252e%252e%252foutside.png", "./a%5cb.png"]) {
    const root = await fixture(t, [document(parentId, {}, `![x](${url})`)]);
    await assert.rejects(readContent(root), undefined, url);
  }
  const root = await fixture(t, [document(parentId, {}, "![x](./escape.png)")]);
  await symlink(path.join(root, "categories.json"), path.join(root, "posts", parentId, "escape.png"));
  await assert.rejects(readContent(root));
});

test("writes new documents with flat assets and returns root-relative filename", async (t) => {
  const root = await fixture(t, []);
  const doc = document(parentId, { title: "New/title", category_id: "source:CSS" }, "![x](./picture.webp)\n");
  const result = await writeContentDocument(root, doc, [{ name: "picture.webp", bytes: Buffer.from("image") }]);
  assert.equal(result.filename, `posts/${parentId}/New_title.md`);
  assert.equal(result.id, parentId);
  const bytes = await readFile(path.join(root, result.filename));
  assert.equal(result.revision, digest(bytes));
  assert.equal([...(await readContent(root)).documents.values()][0].markdown, doc.markdown);
});

test("existing writes require current revision and rename only after valid save", async (t) => {
  const root = await fixture(t);
  const snapshot = await readContent(root);
  const entry = snapshot.documents.get(parentId);
  const doc = { metadata: { ...entry.metadata, title: "Renamed" }, markdown: entry.markdown };
  await assert.rejects(writeContentDocument(root, doc, []));
  await assert.rejects(writeContentDocument(root, doc, [], { expectedRevision: "0".repeat(64) }));
  const result = await writeContentDocument(root, doc, [], { expectedRevision: entry.revision });
  assert.equal(result.filename, `posts/${parentId}/Renamed.md`);
  assert.deepEqual(await readdir(path.join(root, "posts", parentId)), ["Renamed.md"]);
});

test("failed validation leaves old Markdown and asset bytes unchanged", async (t) => {
  const root = await fixture(t, [document(parentId, {}, "![x](./picture.webp)")]);
  const folder = path.join(root, "posts", parentId);
  await writeFile(path.join(folder, "picture.webp"), "original");
  const entry = [...(await readContent(root)).documents.values()][0];
  const before = await readFile(path.join(folder, "Title.md"));
  for (const [doc, assets] of [
    [{ metadata: { ...entry.metadata, title: "Invalid" }, markdown: "![x](./missing.png)" }, []],
    [{ metadata: { ...entry.metadata, parent_id: otherId }, markdown: entry.markdown }, []],
    [entry, [{ name: "picture.webp", bytes: Buffer.from("different") }]],
    [entry, [{ name: "../escape.webp", bytes: Buffer.from("bad") }]],
    [entry, [{ name: "bad%2fpath.webp", bytes: Buffer.from("bad") }]],
    [entry, [{ name: "Title.md", bytes: Buffer.from("bad") }]],
    [entry, [{ name: "Picture.webp", bytes: Buffer.from("new") }]],
  ]) {
    await assert.rejects(writeContentDocument(root, doc, assets, { expectedRevision: entry.revision }));
    assert.equal(digest(await readFile(path.join(folder, "Title.md"))), digest(before));
    assert.equal(await readFile(path.join(folder, "picture.webp"), "utf8"), "original");
    assert.deepEqual((await readdir(folder)).sort(), ["Title.md", "picture.webp"]);
  }
});

test("new IDs cannot clobber an existing folder and folder symlinks are rejected", async (t) => {
  const root = await fixture(t, []);
  await mkdir(path.join(root, "posts", parentId));
  await writeFile(path.join(root, "posts", parentId, "keep.txt"), "keep");
  await assert.rejects(writeContentDocument(root, document(), []));
  assert.equal(await readFile(path.join(root, "posts", parentId, "keep.txt"), "utf8"), "keep");
  await rm(path.join(root, "posts", parentId), { recursive: true });
  await symlink(root, path.join(root, "posts", parentId));
  await assert.rejects(readContent(root));
});

test("allows attachment names that coincide with internal staging filenames", async (t) => {
  const root = await fixture(t, []);
  await writeContentDocument(root, document(parentId, {}, "[download](./document.tmp)"), [{ name: "document.tmp", bytes: Buffer.from("download") }]);
  assert.equal(await readFile(path.join(root, "posts", parentId, "document.tmp"), "utf8"), "download");
});

test("metadata-only moves preserve body bytes, IDs and explicit child categories", async (t) => {
  const root = await fixture(t);
  const snapshot = await readContent(root);
  const entry = snapshot.documents.get(inheritedChildId);
  await writeContentDocument(root, { metadata: { ...entry.metadata, parent_id: explicitChildId }, markdown: entry.markdown }, [], { expectedRevision: entry.revision });
  const moved = await readContent(root);
  assert.equal(moved.documents.get(inheritedChildId).filename, entry.filename);
  assert.equal(moved.documents.get(inheritedChildId).markdown, entry.markdown);
  assert.equal(moved.effectiveCategories.get(inheritedChildId), "source:CSS");
  assert.equal(moved.effectiveCategories.get(explicitChildId), "source:CSS");
});

test("resolves Markdown aliases and known Notion links while retaining block fragments", async (t) => {
  const root = await fixture(t, [document(parentId, { legacy_path: "old/Title.md" }), document(inheritedChildId, {}, `[old](old/Title.md#heading) [notion](https://www.notion.so/Title-${parentId.replace(/-/g, "")}#block) [anchor](#section)`)]);
  const post = toPublicPosts(await readContent(root)).find((item) => item.id === inheritedChildId);
  assert.equal(post.markdown, `[old](#/post/${parentId}#heading) [notion](#/post/${parentId}#block) [anchor](#section)`);
});

test("preserves keycap emoji icons from the existing corpus", async (t) => {
  const root = await fixture(t, [document(parentId, { icon: "9️⃣" })]);
  assert.equal(toPublicPosts(await readContent(root))[0].icon, "9️⃣");
});

test("supports case-only title renames without deleting the replacement", async (t) => {
  const root = await fixture(t, [document()]);
  const entry = (await readContent(root)).documents.get(parentId);
  const result = await writeContentDocument(root, { metadata: { ...entry.metadata, title: "title" }, markdown: entry.markdown }, [], { expectedRevision: entry.revision });
  assert.equal(result.filename, `posts/${parentId}/title.md`);
  assert.deepEqual(await readdir(path.join(root, "posts", parentId)), ["title.md"]);
  assert.equal((await readContent(root)).documents.get(parentId).markdown, entry.markdown);
});

test("keeps the original source URL in the reader's source link", async (t) => {
  const root = await fixture(t, [document(parentId, { source_url: "https://example.notion.site/original" }), document(inheritedChildId)]);
  const posts = toPublicPosts(await readContent(root));
  assert.equal(posts.find((post) => post.id === parentId).url, "https://example.notion.site/original");
  assert.equal(posts.find((post) => post.id === inheritedChildId).url, "");
});


test("orders mixed-offset timestamps chronologically and retains the original strings", async (t) => {
  const root = await fixture(t, [
    document(parentId, { updated: "2025-01-02T00:30:00+09:00" }),
    document(inheritedChildId, { updated: "2025-01-01T20:00:00Z" }),
    document(explicitChildId, { updated: "2025-01-01T20:00:00.000Z" }),
  ]);
  const posts = toPublicPosts(await readContent(root));
  assert.deepEqual(posts.map((post) => post.id), [inheritedChildId, explicitChildId, parentId]);
  assert.equal(posts[2].updatedAt, "2025-01-02T00:30:00+09:00");
});

test("returns a committed save with a cleanup warning and still releases its lock", async (t) => {
  const root = await fixture(t, [document()]);
  const original = (await readContent(root)).documents.get(parentId);
  const realRm = fsPromises.rm;
  t.mock.method(fsPromises, "rm", async (filename, options) => {
    if (String(filename).includes(".content-stage-")) {
      const error = new Error("Injected stage cleanup denial");
      error.code = "EACCES";
      throw error;
    }
    return realRm(filename, options);
  });
  syncBuiltinESMExports();
  let result;
  try {
    result = await writeContentDocument(root, { metadata: original.metadata, markdown: "Committed new body" }, [], { expectedRevision: original.revision });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.equal((await readContent(root)).documents.get(parentId).markdown, "Committed new body");
  assert.ok(result.cleanupWarnings.some((warning) => warning.includes("Injected stage cleanup denial")));
  assert.equal((await readdir(root)).includes(".content-write-lock"), false);
  const saved = (await readContent(root)).documents.get(parentId);
  await writeContentDocument(root, { metadata: saved.metadata, markdown: "Next save" }, [], { expectedRevision: saved.revision });
});

test("publication failure restores old Markdown and removes newly published attachments", async (t) => {
  const root = await fixture(t, [document()]);
  const original = (await readContent(root)).documents.get(parentId);
  const bytes = await readFile(original.absolutePath);
  const realRm = fsPromises.rm;
  const failure = Object.assign(new Error("Injected old-document removal denial"), { code: "EACCES" });
  t.mock.method(fsPromises, "rm", async (filename, options) => {
    if (filename === original.absolutePath) throw failure;
    return realRm(filename, options);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(writeContentDocument(root, { metadata: { ...original.metadata, title: "Renamed" }, markdown: "![new](./new.png)" }, [{ name: "new.png", bytes: Buffer.from("new") }], { expectedRevision: original.revision }), (error) => error === failure);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(await readFile(original.absolutePath), bytes);
  assert.deepEqual(await readdir(path.dirname(original.absolutePath)), ["Title.md"]);
  assert.equal((await readdir(root)).includes(".content-write-lock"), false);
});

test("retains recovery bytes and the publication cause when rollback cannot restore", async (t) => {
  const root = await fixture(t, [document()]);
  const original = (await readContent(root)).documents.get(parentId);
  const bytes = await readFile(original.absolutePath);
  const realRm = fsPromises.rm;
  const realRename = fsPromises.rename;
  const publicationError = new Error("Injected publication failure");
  const restorationError = new Error("Injected restoration failure");
  t.mock.method(fsPromises, "rm", async (filename, options) => {
    if (filename === original.absolutePath) throw publicationError;
    return realRm(filename, options);
  });
  t.mock.method(fsPromises, "rename", async (from, to) => {
    if (path.basename(from) === "original.tmp") throw restorationError;
    return realRename(from, to);
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(writeContentDocument(root, { metadata: { ...original.metadata, title: "Renamed" }, markdown: "New body" }, [], { expectedRevision: original.revision }), (error) => {
      assert.equal(error.cause, publicationError);
      assert.ok(error.errors.includes(restorationError));
      return true;
    });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  assert.deepEqual(await readFile(original.absolutePath), bytes);
  const recovery = (await readdir(root)).find((name) => name.startsWith(".content-stage-"));
  assert.ok(recovery);
  assert.deepEqual(await readFile(path.join(root, recovery, "original.tmp")), bytes);
  assert.equal((await readdir(root)).includes(".content-write-lock"), false);
});

test("keeps literal percent filenames and legacy aliases while resolving encoded destinations", async (t) => {
  const legacyPath = "Main/리액트-c6a3a1072bb9/React + GSAP-e975482b1dcd/vw, vh, %-e3bc5990fb11/index.md";
  const root = await fixture(t, [
    document(parentId, { title: "vw, vh, %", legacy_path: legacyPath }),
    document(inheritedChildId, {}, `[legacy](${encodeURI(legacyPath)}#block) [canonical](../${parentId}/vw,%20vh,%20%25.md#body)`),
  ]);
  const folder = path.join(root, "posts", parentId);
  await fsPromises.rename(path.join(folder, "Title.md"), path.join(folder, "vw, vh, %.md"));
  const snapshot = await readContent(root);
  assert.equal(snapshot.documents.get(parentId).filename, `posts/${parentId}/vw, vh, %.md`);
  assert.equal(snapshot.documents.get(parentId).metadata.legacy_path, legacyPath);
  assert.equal(snapshot.paths.get(legacyPath), parentId);
  const post = toPublicPosts(snapshot).find((item) => item.id === inheritedChildId);
  assert.equal(post.markdown, `[legacy](#/post/${parentId}#block) [canonical](#/post/${parentId}#body)`);
});

test("does not decode stored percent-encoded-looking aliases into different paths", async (t) => {
  const root = await fixture(t, [
    document(parentId, { legacy_path: "old/literal%20name.md" }),
    document(inheritedChildId, { legacy_path: "old/literal name.md" }),
    document(explicitChildId, {}, "[percent](old/literal%2520name.md) [space](old/literal%20name.md)"),
  ]);
  const snapshot = await readContent(root);
  assert.equal(snapshot.paths.get("old/literal%20name.md"), parentId);
  assert.equal(snapshot.paths.get("old/literal name.md"), inheritedChildId);
  const post = toPublicPosts(snapshot).find((item) => item.id === explicitChildId);
  assert.equal(post.markdown, `[percent](#/post/${parentId}) [space](#/post/${inheritedChildId})`);
});

function checkContent(root, cwd = process.cwd(), script = path.resolve("scripts/content.mjs")) {
  const env = { ...process.env };
  for (const name of ["CI", "GITHUB_ACTIONS", "VERCEL", "GITHUB_SHA", "VERCEL_GIT_COMMIT_SHA", "CONTENT_COMMIT_SHA"])
    delete env[name];
  if (root === undefined) delete env.CONTENT_ROOT;
  else env.CONTENT_ROOT = root;
  return spawnSync(process.execPath, [script, "--check"], {
    cwd, env, encoding: "utf8", timeout: 10_000,
  });
}

test("content checking validates the selected corpus and preserves canonical files", async (t) => {
  const root = await fixture(t, [document(parentId, {}, "![image](./picture.webp)\n![again](./picture.webp)")]);
  const filename = path.join(root, "posts", parentId, "Title.md");
  const asset = path.join(root, "posts", parentId, "picture.webp");
  await writeFile(asset, "IMAGE_BYTES");
  const before = await readFile(filename);
  const result = checkContent(root);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.trim(), "The content CLI must report corpus counts");
  assert.deepEqual(JSON.parse(result.stdout), {
    posts: 1, categories: 2, referencedAttachments: 1, errors: 0,
    contentCommit: null, contentState: "local-staging",
  });
  assert.equal(digest(await readFile(filename)), digest(before));
  assert.equal(await readFile(asset, "utf8"), "IMAGE_BYTES");
  await rm(asset);
  const missingAssetCheck = checkContent(root);
  assert.notEqual(missingAssetCheck.status, 0);
  assert.match(missingAssetCheck.stderr, /Missing attachment/);
  assert.equal(digest(await readFile(filename)), digest(before));
});

test("content checking defaults to app content and never falls back to legacy JSON", async (t) => {
  const project = await legacyProject(t);
  const canonical = await fixture(t, [document()]);
  await cp(canonical, path.join(project, "content"), { recursive: true });
  const script = path.join(project, "scripts/content.mjs");
  const result = checkContent(undefined, project, script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).posts, 1);
  await rm(path.join(project, "content/categories.json"));
  assert.notEqual(checkContent(undefined, project, script).status, 0);
});

test("content checking rejects invalid hierarchy and missing or uninitialized content", async (t) => {
  const invalid = await fixture(t, [document(parentId, { parent_id: otherId })]);
  const result = checkContent(invalid);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing post parent/);
  for (const root of [path.join(invalid, "missing"), await fixture(t, [])]) {
    if (!root.endsWith("missing")) await rm(path.join(root, "categories.json"));
    const missing = checkContent(root);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /ENOENT|initializ/i);
  }
});

async function legacyProject(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "legacy-content-cli-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "scripts"));
  for (const filename of ["content.mjs", "export-notion.mjs", "repair-markdown.mjs", "prepare-web-assets.mjs"])
    await cp(path.resolve("scripts", filename), path.join(root, "scripts", filename));
  await cp(path.resolve("src/shared"), path.join(root, "src/shared"), { recursive: true });
  await symlink(path.resolve("node_modules"), path.join(root, "node_modules"));
  await mkdir(path.join(root, "content"));
  await mkdir(path.join(root, "public/notion"), { recursive: true });
  for (const [filename, value] of [
    ["posts.json", []], ["records.json", {}],
    ["manifest.json", { assetDetails: [], archivePath: path.join(root, "archive") }],
  ]) await writeFile(path.join(root, "content", filename), JSON.stringify(value));
  await writeFile(path.join(root, "public/notion/asset-map.json"), "PREVIOUS_PUBLIC_BYTES");
  return root;
}

for (const script of ["export-notion.mjs", "repair-markdown.mjs", "prepare-web-assets.mjs"]) {
  test(`${script} refuses direct legacy writes for selected and uninitialized canonical content`, async (t) => {
    const project = await legacyProject(t);
    const canonical = await fixture(t, [document()]);
    const filename = path.join(canonical, "posts", parentId, "Title.md");
    const canonicalBefore = digest(await readFile(filename));
    const publicFilename = path.join(project, "public/notion/asset-map.json");
    const legacyFilename = path.join(project, "content/posts.json");
    for (const mode of ["selected", "selected-missing", "default", "marker", "uninitialized", "missing"]) {
      if (mode === "default") {
        await cp(canonical, path.join(project, "content"), { recursive: true });
      } else if (mode === "marker") {
        await rm(path.join(project, "content/posts"), { recursive: true });
        await rm(path.join(project, "content/categories.json"));
        await writeFile(path.join(project, ".gitmodules"), '[submodule "content"]\n\tpath = content\n\turl = ../canonical.git\n');
      } else if (mode === "uninitialized") {
        await rm(path.join(project, "content"), { recursive: true });
        await mkdir(path.join(project, "content"));
      } else if (mode === "missing") {
        await rm(path.join(project, ".gitmodules"));
      }
      const env = { ...process.env };
      delete env.CONTENT_ROOT;
      if (mode.startsWith("selected"))
        env.CONTENT_ROOT = mode === "selected" ? canonical : path.join(canonical, "missing");
      // Restrict writes to the disposable clone: the old exporter has a personal archive path.
      const result = spawnSync(process.execPath, [
        "--permission", "--allow-fs-read=*", `--allow-fs-write=${project}`,
        path.join(project, "scripts", script),
      ], { cwd: project, env, encoding: "utf8", timeout: 10_000 });
      assert.notEqual(result.status, 0, script + ": " + mode);
      assert.match(result.stderr, /Legacy content writes are disabled/, script + ": " + mode);
      assert.equal(digest(await readFile(filename)), canonicalBefore);
      assert.equal(await readFile(publicFilename, "utf8"), "PREVIOUS_PUBLIC_BYTES");
      if (!["uninitialized", "missing"].includes(mode))
        assert.equal(await readFile(legacyFilename, "utf8"), "[]");
      assert.equal((await readdir(path.join(project, "content"))).includes("raw"), false);
    }
  });
}

test("legacy modules remain importable without reading or writing content", async (t) => {
  const project = await legacyProject(t);
  await rm(path.join(project, "content"), { recursive: true });
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
    for (const filename of ["export-notion.mjs", "repair-markdown.mjs", "prepare-web-assets.mjs"])
      await import(${JSON.stringify("file://" + project + "/scripts/")} + filename);
    console.log("IMPORTED");
  `], { cwd: project, env: { ...process.env, CONTENT_ROOT: "missing" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "IMPORTED");
  assert.equal((await readdir(project)).includes("content"), false);
  assert.deepEqual(await readdir(path.join(project, "public/notion")), ["asset-map.json"]);
});

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commit(cwd) {
  git(cwd, "-c", "user.name=Content Test", "-c", "user.email=content@example.invalid", "commit", "-qm", "Fixture");
  return git(cwd, "rev-parse", "HEAD");
}

async function provenanceFixture(t) {
  const project = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-provenance-")));
  t.after(() => rm(project, { recursive: true, force: true }));
  const root = path.join(project, "content");
  await cp(await fixture(t, [document()]), root, { recursive: true });
  git(root, "init", "-q");
  git(root, "add", ".");
  const sha = commit(root);
  git(project, "init", "-q");
  await writeFile(path.join(project, ".gitmodules"), '[submodule "content"]\n\tpath = content\n\turl = https://example.invalid/content.git\n');
  git(project, "add", ".gitmodules");
  git(project, "update-index", "--add", "--cacheinfo", `160000,${sha},content`);
  commit(project);
  return { root, projectRoot: project, sha };
}

test("content provenance reports pinned HEAD and accepts an equivalent root path", async (t) => {
  const input = await provenanceFixture(t);
  const result = await content.getContentProvenance(input.root + path.sep + ".", {
    projectRoot: input.projectRoot, env: { CI: "true", CONTENT_COMMIT_SHA: input.sha },
  });
  assert.deepEqual(result, { contentCommit: input.sha, contentState: "git-pinned" });
});

for (const kind of ["post", "asset"]) {
  test(`content provenance rejects ignored canonical ${kind} inputs in deployment`, async (t) => {
    const input = await provenanceFixture(t);
    const relative = kind === "post"
      ? `posts/${otherId}/Title.md`
      : `posts/${parentId}/ignored.webp`;
    await writeFile(path.join(input.root, ".git/info/exclude"), relative + "\n");
    if (kind === "post") await mkdir(path.dirname(path.join(input.root, relative)));
    await writeFile(path.join(input.root, relative), kind === "post"
      ? serializeMarkdownDocument(document(otherId))
      : "IGNORED_ASSET");
    assert.equal(git(input.root, "status", "--porcelain=v1", "--untracked-files=all"), "");
    const snapshot = await readContent(input.root);
    if (kind === "post") assert.equal(snapshot.documents.size, 2);
    else assert.equal(snapshot.documents.get(parentId).allAssets[0].name, "ignored.webp");
    await assert.rejects(content.getContentProvenance(input.root, {
      projectRoot: input.projectRoot, env: { CI: "true" },
    }), /ignored|untracked|canonical/i);
    assert.equal((await content.getContentProvenance(input.root, {
      projectRoot: input.projectRoot, env: {},
    })).contentCommit, input.sha);
  });
}

test("content provenance allows ignored cache files outside canonical inputs", async (t) => {
  const input = await provenanceFixture(t);
  await writeFile(path.join(input.root, ".git/info/exclude"), ".cache/\n");
  await mkdir(path.join(input.root, ".cache"));
  await writeFile(path.join(input.root, ".cache/local.json"), "LOCAL_CACHE");
  assert.deepEqual(await content.getContentProvenance(input.root, {
    projectRoot: input.projectRoot, env: { CI: "true" },
  }), { contentCommit: input.sha, contentState: "git-pinned" });
});

for (const marker of ["CI", "GITHUB_ACTIONS", "VERCEL", "GITHUB_SHA", "VERCEL_GIT_COMMIT_SHA"]) {
  test(`content provenance enforces deployment cleanliness for ${marker}`, async (t) => {
    const input = await provenanceFixture(t);
    await writeFile(path.join(input.root, "untracked.txt"), "dirty");
    await assert.rejects(content.getContentProvenance(input.root, {
      projectRoot: input.projectRoot, env: { [marker]: "true" },
    }), /dirty|clean|uncommitted/i);
    assert.deepEqual(await content.getContentProvenance(input.root, {
      projectRoot: input.projectRoot, env: {},
    }), { contentCommit: input.sha, contentState: "git-local-dirty" });
  });
}

for (const change of ["tracked", "staged", "head", "index", "missing-gitlink"]) {
  test(`content provenance rejects a deployment with ${change} changes`, async (t) => {
    const input = await provenanceFixture(t);
    if (change === "tracked" || change === "staged" || change === "head") {
      await writeFile(path.join(input.root, "categories.json"), "[]");
      if (change !== "tracked") git(input.root, "add", "categories.json");
      if (change === "head") commit(input.root);
    } else if (change === "index") {
      git(input.projectRoot, "update-index", "--force-remove", "content");
    } else {
      git(input.projectRoot, "update-index", "--force-remove", "content");
      commit(input.projectRoot);
    }
    await assert.rejects(content.getContentProvenance(input.root, {
      projectRoot: input.projectRoot, env: { CI: "true" },
    }), /dirty|clean|gitlink|mismatch|commit/i);
  });
}

test("content provenance rejects invalid or mismatched supplied commit IDs", async (t) => {
  const input = await provenanceFixture(t);
  for (const value of ["", "HEAD", input.sha.slice(0, 8), "g".repeat(40), "a".repeat(40)]) {
    await assert.rejects(content.getContentProvenance(input.root, {
      projectRoot: input.projectRoot, env: { CI: "true", CONTENT_COMMIT_SHA: value },
    }), /CONTENT_COMMIT_SHA|mismatch/i);
  }
});

test("content provenance distinguishes Gitless package attestation from local staging", async (t) => {
  const projectRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "content-package-")));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  const root = path.join(projectRoot, "content");
  await cp(await fixture(t), root, { recursive: true });
  assert.deepEqual(await content.getContentProvenance(root, { projectRoot, env: {} }), {
    contentCommit: null, contentState: "local-staging",
  });
  await assert.rejects(content.getContentProvenance(root, { projectRoot, env: { VERCEL: "1" } }), /CONTENT_COMMIT_SHA/);
  assert.deepEqual(await content.getContentProvenance(root, {
    projectRoot, env: { VERCEL: "1", CONTENT_COMMIT_SHA: "a".repeat(40) },
  }), { contentCommit: "a".repeat(40), contentState: "package-attested" });
  await writeFile(path.join(root, ".git"), "gitdir: /missing/content/repository\n");
  await assert.rejects(content.getContentProvenance(root, {
    projectRoot, env: { VERCEL: "1", CONTENT_COMMIT_SHA: "a".repeat(40) },
  }), /git|repository/i);
});

test("content provenance rejects uninitialized submodules and external deployment roots", async (t) => {
  const input = await provenanceFixture(t);
  await rm(path.join(input.root, ".git"), { recursive: true });
  await assert.rejects(content.getContentProvenance(input.root, {
    projectRoot: input.projectRoot, env: { CI: "true", CONTENT_COMMIT_SHA: input.sha },
  }), /initializ|submodule|git/i);
  const external = await fixture(t);
  assert.deepEqual(await content.getContentProvenance(external, {
    projectRoot: input.projectRoot, env: {},
  }), { contentCommit: null, contentState: "local-staging" });
  await assert.rejects(content.getContentProvenance(external, {
    projectRoot: input.projectRoot, env: { CI: "true", CONTENT_COMMIT_SHA: input.sha },
  }), /CONTENT_ROOT|external|content root/i);
});
