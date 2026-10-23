import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCategoryGroups } from "../src/features/post-category/catalog.ts";
import { rewriteContentLinks } from "../src/shared/content-links.mjs";
import { canonicalFilename, serializeMarkdownDocument } from "../src/shared/document.mjs";
import { validateContent } from "./content.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const appRoot = fileURLToPath(new URL("../", import.meta.url));

function contains(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
}

async function readRegularFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Expected a regular source file: " + filename);
  return readFile(filename);
}

function categoriesFor(posts) {
  return createCategoryGroups(posts).flatMap((group, order) => [
    { id: group.id, name: group.name, parent_id: null, order, sources: [] },
    ...group.categories.map((category, order) => ({
      id: category.id, name: category.name, parent_id: group.id, order, sources: [category.source],
    })),
  ]);
}

/**
 * Build a serializable audit report, then publish into a new external staging directory.
 * Dry-runs perform the same source reads and validation without creating any output.
 */
export async function migrateLegacyContent({
  postsPath, writtenDir, assetMapPath, publicRoot, targetRoot, dryRun = true,
}) {
  const report = {
    dryRun, counts: {}, inputs: [], documents: [], assets: [], categoryChanges: [],
    externalUrls: [], unownedFiles: [], outputFiles: [], errors: [],
  };
  let createdTarget = false;
  try {
    targetRoot = path.resolve(targetRoot);
    const physicalTarget = path.join(await realpath(path.dirname(targetRoot)), path.basename(targetRoot));
    for (const source of [appRoot, path.dirname(postsPath), writtenDir, publicRoot]) {
      let physicalSource;
      try {
        physicalSource = await realpath(source);
      } catch (error) {
        if (source !== writtenDir || error.code !== "ENOENT") throw error;
        physicalSource = path.resolve(source);
      }
      if (contains(physicalSource, physicalTarget))
        throw new Error("Staging must be outside the app and legacy inputs: " + targetRoot);
    }
    try {
      await lstat(targetRoot);
      throw new Error("Staging output already exists: " + targetRoot);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const sourceBytes = await readRegularFile(postsPath);
    report.inputs.push({ path: postsPath, sha256: hash(sourceBytes) });
    const originals = JSON.parse(sourceBytes);
    if (!Array.isArray(originals) || !originals.length) throw new Error("Legacy posts must be a nonempty array.");
    const posts = new Map();
    for (const post of originals) {
      if (posts.has(post.id)) throw new Error("Duplicate legacy ID: " + post.id);
      posts.set(post.id, post);
    }
    const before = new Map(originals.map((post) => [post.id, post]));
    let writtenNames = [];
    try {
      writtenNames = await readdir(writtenDir);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    for (const filename of writtenNames.sort()) {
      if (!filename.endsWith(".json")) continue;
      const sourcePath = path.join(writtenDir, filename);
      const bytes = await readRegularFile(sourcePath);
      const written = JSON.parse(bytes);
      if (!written || typeof written.id !== "string") throw new Error("Written post needs an ID: " + filename);
      posts.set(written.id, { ...posts.get(written.id), ...written });
      report.inputs.push({ path: sourcePath, sha256: hash(bytes) });
    }
    const mapBytes = await readRegularFile(assetMapPath);
    const assetMap = JSON.parse(mapBytes);
    if (!assetMap || Array.isArray(assetMap) || typeof assetMap !== "object")
      throw new Error("Asset map must be an object.");
    report.inputs.push({ path: assetMapPath, sha256: hash(mapBytes) });
    const publicDirectory = await realpath(publicRoot);
    const assetDirectory = path.join(publicDirectory, "notion/assets");
    const assetInfo = await lstat(assetDirectory);
    if (!assetInfo.isDirectory() || assetInfo.isSymbolicLink())
      throw new Error("Public assets must be a regular directory.");
    const inventory = new Map();
    for (const name of (await readdir(assetDirectory)).sort()) {
      const sourcePath = path.join(assetDirectory, name);
      const bytes = await readRegularFile(sourcePath);
      inventory.set("/notion/assets/" + name, {
        path: "notion/assets/" + name, absolutePath: sourcePath,
        sha256: hash(bytes), bytes: bytes.length,
      });
    }
    const categories = categoriesFor([...posts.values()]);
    const categoryIds = new Map(categories.flatMap((category) => category.sources.map((source) => [source, category.id])));
    const legacyPaths = new Map();
    for (const post of posts.values()) {
      if (typeof post.path !== "string") throw new Error("Missing legacy path: " + post.id);
      const legacyPath = path.posix.normalize(post.path);
      if (legacyPaths.has(legacyPath)) throw new Error("Duplicate legacy path: " + post.path);
      legacyPaths.set(legacyPath, post.id);
    }
    const usedAssets = new Set();
    const documents = new Map();
    const serialized = new Map();
    const siblingOrders = new Map();
    for (const post of posts.values()) {
      try {
        const { parentId, category, createdAt, updatedAt, path: legacyPath, url, markdown, ...extensions } = post;
        if (typeof category !== "string" || typeof markdown !== "string")
          throw new Error("Legacy category and body must be strings.");
        const parent = posts.get(parentId);
        const order = siblingOrders.get(parentId) ?? 0;
        siblingOrders.set(parentId, order + 1);
        const metadata = {
          ...extensions, schema_version: 1, parent_id: parentId, created: createdAt, updated: updatedAt,
          legacy_path: legacyPath, legacy_category: category, source_url: url, order,
          ...(!parent || parent.category !== category ? { category_id: categoryIds.get(category) } : {}),
        };
        const filename = path.posix.join("posts", post.id, canonicalFilename(post.title));
        const assets = new Map();
        const resolve = (destination) => {
          if (
            !destination || destination.startsWith("#") ||
            /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination)
          ) return destination;
          const suffixIndex = destination.search(/[?#]/);
          const pathname = suffixIndex < 0 ? destination : destination.slice(0, suffixIndex);
          const suffix = suffixIndex < 0 ? "" : destination.slice(suffixIndex);
          const decoded = decodeURIComponent(pathname);
          if (decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded))
            throw new Error("Unsafe legacy URL: " + destination);
          if (/\.md$/i.test(decoded)) {
            const candidate = path.posix.normalize(path.posix.join(path.posix.dirname(legacyPath), decoded));
            const linkedId = legacyPaths.get(candidate) ?? legacyPaths.get(path.posix.normalize(decoded));
            if (!linkedId) throw new Error("Missing legacy document: " + destination);
            return "#/post/" + linkedId + suffix.replace(/^\?[^#]*/, "");
          }
          const mapped = assetMap[pathname] ?? pathname;
          if (typeof mapped !== "string") throw new Error("Invalid asset mapping: " + pathname);
          const assetUrl = decodeURIComponent(mapped);
          if (!/^\/notion\/assets\/[^/]+$/.test(assetUrl))
            throw new Error("Unsupported local attachment: " + destination);
          const source = inventory.get(assetUrl);
          if (!source) throw new Error("Missing public attachment: " + assetUrl);
          const name = path.posix.basename(assetUrl);
          const existing = assets.get(name);
          if (existing && existing.absolutePath !== source.absolutePath)
            throw new Error("Conflicting attachment: " + name);
          assets.set(name, { name, absolutePath: source.absolutePath });
          usedAssets.add(assetUrl);
          return encodeURIComponent(name) + suffix;
        };
        const body = rewriteContentLinks(markdown, resolve);
        for (const key of ["cover", "icon"]) {
          const value = metadata[key];
          if (typeof value !== "string") continue;
          const opaqueIcon = key === "icon" && (
            value.startsWith("/icons/") || (!/[./\\:]/.test(value) && /\p{Emoji}/u.test(value))
          );
          if (!opaqueIcon) metadata[key] = resolve(value);
        }
        const document = { metadata, markdown: body, filename, allAssets: [...assets.values()], assets: [] };
        const bytes = serializeMarkdownDocument(document);
        documents.set(post.id, document);
        serialized.set(filename, bytes);
        report.documents.push({
          id: post.id, parent_id: parentId, order, legacy_category: category,
          category_id: metadata.category_id ?? null, sourceBodyHash: hash(markdown), outputBodyHash: hash(body),
          sourceHash: hash(JSON.stringify(post)), outputHash: hash(bytes), filename,
        });
        if (before.get(post.id)?.category !== category) {
          report.categoryChanges.push({
            id: post.id, before: before.get(post.id)?.category ?? null,
            after: category, category_id: metadata.category_id ?? null,
          });
        }
        for (const asset of assets.values()) {
          const source = inventory.get("/notion/assets/" + asset.name);
          report.assets.push({
            id: post.id, source: source.path, output: path.posix.join("posts", post.id, asset.name),
            sha256: source.sha256, bytes: source.bytes,
          });
        }
      } catch (error) {
        report.errors.push(post.id + ": " + error.message);
      }
    }
    const snapshot = { root: targetRoot, documents, categories, effectiveCategories: new Map() };
    if (!report.errors.length) {
      try {
        validateContent(snapshot);
        report.externalUrls = snapshot.externalDependencies;
        for (const document of report.documents)
          document.effective_category_id = snapshot.effectiveCategories.get(document.id);
      } catch (error) {
        report.errors.push(error.message);
      }
    }
    const categoryBytes = JSON.stringify(categories, null, 2) + "\n";
    serialized.set("categories.json", categoryBytes);
    report.unownedFiles = [...inventory.entries()]
      .filter(([url]) => !usedAssets.has(url))
      .map(([, asset]) => ({ path: asset.path, sha256: asset.sha256, bytes: asset.bytes }));
    report.outputFiles = [
      ...[...serialized].map(([path, bytes]) => ({ path, sha256: hash(bytes), bytes: Buffer.byteLength(bytes) })),
      ...report.assets.map((asset) => ({ path: asset.output, sha256: asset.sha256, bytes: asset.bytes })),
    ].sort((a, b) => a.path.localeCompare(b.path));
    report.outputHash = hash(JSON.stringify(report.outputFiles));
    report.counts = {
      posts: posts.size, categories: categories.length,
      explicitCategories: report.documents.filter((document) => document.category_id !== null).length,
      attachments: usedAssets.size, assetCopies: report.assets.length,
      publicAssets: inventory.size, publicAssetBytes: [...inventory.values()].reduce((sum, asset) => sum + asset.bytes, 0),
      unownedFiles: report.unownedFiles.length, externalUrls: report.externalUrls.length,
    };
    if (report.errors.length || dryRun) return report;

    await mkdir(targetRoot);
    createdTarget = true;
    for (const [filename, bytes] of serialized) {
      const target = path.join(targetRoot, filename);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
    for (const asset of report.assets) {
      const target = path.join(targetRoot, asset.output);
      await copyFile(path.join(publicDirectory, asset.source), target, constants.COPYFILE_EXCL);
      if (hash(await readRegularFile(target)) !== asset.sha256)
        throw new Error("Copied attachment hash differs: " + asset.output);
    }
  } catch (error) {
    report.errors.push(error.message);
    if (createdTarget) await rm(targetRoot, { recursive: true, force: true });
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputIndex = args.indexOf("--output");
  const unknownArgument = args.some((argument, index) =>
    index !== outputIndex && index !== outputIndex + 1 && argument !== "--dry-run",
  );
  if (outputIndex < 0 || !args[outputIndex + 1] || unknownArgument) {
    console.error("Usage: node scripts/migrate-content.mjs --output <external staging directory> [--dry-run]");
    process.exitCode = 1;
  } else {
    const report = await migrateLegacyContent({
      postsPath: path.join(appRoot, "content/posts.json"), writtenDir: path.join(appRoot, "content/written"),
      assetMapPath: path.join(appRoot, "public/notion/asset-map.json"), publicRoot: path.join(appRoot, "public"),
      targetRoot: args[outputIndex + 1], dryRun: args.includes("--dry-run"),
    });
    console.log(JSON.stringify(report, null, 2));
    if (report.errors.length) process.exitCode = 1;
  }
}
