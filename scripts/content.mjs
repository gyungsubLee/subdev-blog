import { createHash } from "node:crypto";
import {
  lstat, link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  canonicalFilename, parseMarkdownDocument, serializeMarkdownDocument,
} from "../src/shared/document.mjs";
import { rewriteContentLinks } from "../src/shared/content-links.mjs";

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const fallbackCategory = "group:unclassified";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

function decodePath(value) {
  let decoded = value;
  for (let count = 0; count < 5; count++) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error("Invalid percent-encoded content path: " + value);
    }
    if (next === decoded) return decoded;
    decoded = next;
    if (!/%[a-f0-9]{2}/i.test(decoded)) return decoded;
  }
  throw new Error("Repeated content path encoding: " + value);
}

function assetName(value) {
  const decoded = decodePath(value);
  if (
    !value ||
    decoded !== path.basename(decoded) ||
    /[\\/<>:"|?*\u0000-\u001f\u007f]/.test(decoded) ||
    decoded === "." || decoded === ".." || /[. ]$/.test(decoded) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(decoded) ||
    /\.md$/i.test(decoded) || Buffer.byteLength(decoded) > 255
  ) {
    throw new Error("Attachments need safe flat filenames: " + value);
  }
  return decoded;
}

async function regularPath(filename, directory = false) {
  const info = await lstat(filename);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile()))
    throw new Error(
      "Content paths must be regular " +
      (directory ? "directories: " : "files: ") + filename,
    );
}

/**
 * ContentEntry: { metadata, markdown, filename, absolutePath, revision, assets }.
 * filename is content-root-relative. assets contains referenced { name, absolutePath } only.
 * allAssets is an internal inventory used to validate missing and conflicting attachments.
 */
export async function readContent(root) {
  const directory = await realpath(root);
  await regularPath(path.join(directory, "categories.json"));
  await regularPath(path.join(directory, "posts"), true);
  const categories = JSON.parse(
    await readFile(path.join(directory, "categories.json"), "utf8"),
  );
  const documents = new Map();
  for (const id of (await readdir(path.join(directory, "posts"))).sort()) {
    if (!uuidPattern.test(id)) throw new Error("Invalid post folder ID: " + id);
    const folder = path.join(directory, "posts", id);
    await regularPath(folder, true);
    const names = await readdir(folder);
    const markdownNames = names.filter((name) => /\.md$/i.test(name));
    if (markdownNames.length !== 1)
      throw new Error("A post folder needs exactly one Markdown document: " + id);
    const filename = path.posix.join("posts", id, markdownNames[0]);
    const absolutePath = path.join(directory, filename);
    await regularPath(absolutePath);
    const bytes = await readFile(absolutePath);
    const parsed = parseMarkdownDocument(bytes.toString("utf8"));
    if (parsed.documentMode !== "full")
      throw new Error("Canonical content requires schema_version 1: " + filename);
    if (parsed.metadata.id !== id)
      throw new Error("Folder ID differs from document ID: " + filename);
    if (markdownNames[0] !== canonicalFilename(parsed.metadata.title))
      throw new Error("Document filename differs from title: " + filename);
    const allAssets = [];
    const portableNames = new Set([markdownNames[0].normalize("NFC").toLowerCase()]);
    for (const name of names.filter((name) => !markdownNames.includes(name))) {
      assetName(name);
      const key = name.normalize("NFC").toLowerCase();
      if (portableNames.has(key)) throw new Error("Conflicting content filenames: " + name);
      portableNames.add(key);
      const absolutePath = path.join(folder, name);
      await regularPath(absolutePath);
      allAssets.push({ name, absolutePath });
    }
    if (documents.has(parsed.metadata.id)) throw new Error("Duplicate post ID: " + parsed.metadata.id);
    documents.set(parsed.metadata.id, {
      metadata: parsed.metadata,
      markdown: parsed.markdown,
      filename,
      absolutePath,
      revision: hash(bytes),
      assets: [],
      allAssets,
    });
  }
  const snapshot = {
    root: directory,
    documents,
    categories,
    effectiveCategories: new Map(),
    externalDependencies: [],
  };
  validateContent(snapshot);
  return snapshot;
}

function validateHierarchy(records, idOf, parentOf, label) {
  const byId = new Map();
  for (const record of records) {
    const id = idOf(record);
    if (byId.has(id)) throw new Error("Duplicate " + label + " ID: " + id);
    byId.set(id, record);
  }
  const visited = new Set();
  for (const record of records) {
    let current = record;
    const ancestors = new Set();
    while (current && !visited.has(idOf(current))) {
      const id = idOf(current);
      if (ancestors.has(id)) throw new Error("Cycle in " + label + " hierarchy: " + id);
      ancestors.add(id);
      const parent = parentOf(current);
      if (parent !== null && !byId.has(parent))
        throw new Error("Missing " + label + " parent: " + parent);
      current = byId.get(parent);
    }
    for (const id of ancestors) visited.add(id);
  }
  return byId;
}

/** Validate documents and references; populate inherited category and asset projections. */
export function validateContent(snapshot) {
  if (!Array.isArray(snapshot.categories) || !(snapshot.documents instanceof Map))
    throw new Error("Content needs a category array and document map.");
  const entries = [...snapshot.documents.values()];
  const sources = new Set();
  for (const category of snapshot.categories) {
    if (
      !category ||
      typeof category.id !== "string" || !category.id ||
      typeof category.name !== "string" ||
      (category.parent_id !== null && typeof category.parent_id !== "string") ||
      !Number.isSafeInteger(category.order) || category.order < 0 || !Array.isArray(category.sources)
    ) {
      throw new Error("Invalid category record.");
    }
    for (const source of category.sources) {
      if (typeof source !== "string" || sources.has(source))
        throw new Error("Invalid or duplicate category source: " + source);
      sources.add(source);
    }
  }
  const categories = validateHierarchy(
    snapshot.categories, (record) => record.id,
    (record) => record.parent_id, "category",
  );
  for (const entry of entries) {
    // Reuse the document boundary validator without altering opaque extension values.
    serializeMarkdownDocument(entry);
  }
  const byId = validateHierarchy(
    entries, (entry) => entry.metadata.id,
    (entry) => entry.metadata.parent_id, "post",
  );
  const effectiveCategories = new Map();
  for (const entry of entries) {
    const metadata = entry.metadata;
    for (const reference of [...(metadata.related_ids ?? []), ...(metadata.source_ids ?? [])]) {
      if (!byId.has(reference)) throw new Error("Missing document reference: " + reference);
    }
    if (Object.hasOwn(metadata, "category_id") && !categories.has(metadata.category_id))
      throw new Error("Missing explicit category: " + metadata.category_id);
    let ancestor = entry;
    while (ancestor && ancestor.metadata.category_id === undefined)
      ancestor = byId.get(ancestor.metadata.parent_id);
    effectiveCategories.set(metadata.id, ancestor?.metadata.category_id ?? fallbackCategory);
  }
  for (const [id, entry] of snapshot.documents) {
    if (id !== entry.metadata.id) throw new Error("Document map key differs from its ID: " + id);
  }
  snapshot.effectiveCategories = effectiveCategories;
  const externalDependencies = new Set();
  const paths = new Map();
  for (const entry of entries) {
    for (const alias of [entry.filename, entry.metadata.legacy_path]) {
      if (!alias) continue;
      // Stored paths are literal filenames, including percent characters.
      const normalized = path.posix.normalize(alias);
      if (paths.has(normalized) && paths.get(normalized) !== entry.metadata.id)
        throw new Error("Duplicate document path alias: " + alias);
      paths.set(normalized, entry.metadata.id);
    }
  }
  snapshot.paths = paths;
  for (const entry of entries) {
    const assets = new Map();
    const resolve = linkResolver(snapshot, entry, assets, externalDependencies);
    rewriteContentLinks(entry.markdown, resolve);
    for (const key of ["cover", "icon"]) {
      const value = entry.metadata[key];
      if (typeof value === "string" && !opaqueIcon(key, value))
        resolve(value, { kind: "image" });
    }
    entry.assets = [...assets.values()];
  }
  snapshot.externalDependencies = [...externalDependencies].sort();
}

function opaqueIcon(key, value) {
  return key === "icon" && (
    value.startsWith("/icons/") ||
    (!/[./\\:]/.test(value) && /\p{Emoji}/u.test(value))
  );
}

function linkResolver(snapshot, entry, assets = new Map(), externals = new Set()) {
  return (destination) => {
    if (!destination) return destination;
    if (destination.startsWith("#/post/")) {
      const id = destination.slice(7).split(/[?#]/)[0];
      if (!snapshot.documents.has(id)) throw new Error("Missing linked document: " + id);
      return destination;
    }
    if (destination.startsWith("#")) return destination;
    const suffixIndex = destination.search(/[?#]/);
    const pathname = suffixIndex < 0 ? destination : destination.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? "" : destination.slice(suffixIndex);
    // Asset URLs contain UUIDs too; classify them before considering document URLs.
    const publicAsset = pathname.match(/^\/content\/assets\/([^/]+)\/(.+)$/);
    if (publicAsset) {
      if (publicAsset[1] !== entry.metadata.id)
        throw new Error("Attachments must belong to their document: " + destination);
      return resolveAsset(publicAsset[2]) + suffix;
    }
    if (/^(?:https?:)?\/\//i.test(destination)) {
      const url = new URL(destination, "https://content.invalid");
      if (/(?:^|\.)(?:notion\.so|notion\.site)$/i.test(url.hostname)) {
        const match = url.pathname.match(/([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})(?:\/)?$/i);
        if (match) {
          const compact = match[1].replace(/-/g, "").toLowerCase();
          const id = compact.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
          if (snapshot.documents.has(id)) return "#/post/" + id + url.hash;
        }
      }
      externals.add(destination);
      return destination;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(destination)) {
      if (/^(?:javascript|vbscript|file):/i.test(destination))
        throw new Error("Unsafe content URL: " + destination);
      if (!destination.startsWith("data:")) externals.add(destination);
      return destination;
    }
    // Decode URL input once; "%2520" names a literal "%20", not a space.
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded))
      throw new Error("Unsafe content path: " + destination);
    if (/\.md$/i.test(decoded)) {
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(entry.filename), decoded));
      const id = snapshot.paths.get(relative) ?? snapshot.paths.get(path.posix.normalize(decoded));
      if (!id) throw new Error("Missing Markdown document: " + destination);
      return "#/post/" + id + suffix.replace(/^\?[^#]*/, "");
    }
    return resolveAsset(decoded.replace(/^\.\//, "")) + suffix;
  };

  function resolveAsset(name) {
    const decoded = assetName(name);
    const asset = (entry.allAssets ?? entry.assets).find((item) => item.name === decoded);
    if (!asset) throw new Error("Missing attachment for " + entry.metadata.id + ": " + name);
    assets.set(asset.name, asset);
    return "/content/assets/" + entry.metadata.id + "/" + encodeURIComponent(asset.name);
  }
}

export function toPublicCategories(snapshot) {
  const categories = snapshot.categories.map((record) => ({
    id: record.id,
    name: record.name,
    parentId: record.parent_id,
    order: record.order,
    sources: [...new Set([
      ...record.sources,
      record.id,
      ...(record.id === fallbackCategory ? ["미분류"] : []),
    ])],
  }));
  if (!categories.some((category) => category.id === fallbackCategory))
    categories.push({
      id: fallbackCategory,
      name: "미분류",
      parentId: null,
      order: 0,
      sources: [fallbackCategory, "미분류"],
    });
  return categories.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

export function toPublicPosts(snapshot) {
  const categories = new Map(snapshot.categories.map((category) => [category.id, category]));
  return [...snapshot.documents.values()].map((entry) => {
    const metadata = entry.metadata;
    const categoryId = snapshot.effectiveCategories.get(metadata.id);
    const category = categories.get(categoryId);
    const legacyCategory = metadata.legacy_category;
    const resolve = linkResolver(snapshot, entry);
    const markdown = rewriteContentLinks(entry.markdown, resolve);
    const publicImage = (key) => {
      const value = metadata[key];
      return typeof value === "string" && !opaqueIcon(key, value)
        ? resolve(value)
        : value;
    };
    let compatibleCategory = categoryId === fallbackCategory ? "미분류" : categoryId;
    if (category?.sources.includes(legacyCategory)) compatibleCategory = legacyCategory;
    const excerpt = entry.markdown
      .replace(/<[^>]*>/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[#*`_>]/g, "")
      .replace(/\s+/g, " ").trim().slice(0, 180);
    return {
      id: metadata.id,
      title: metadata.title,
      parentId: metadata.parent_id,
      category: compatibleCategory,
      categoryId,
      createdAt: metadata.created,
      updatedAt: metadata.updated,
      markdown,
      path: entry.filename,
      url: metadata.source_url ?? "",
      excerpt,
      cover: publicImage("cover"),
      icon: publicImage("icon"),
      order: metadata.order ?? 0,
      revision: entry.revision,
      bodyLoaded: true,
    };
  }).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id));
}

/**
 * Validate before publication. A committed save may return cleanupWarnings;
 * rejected publication preserves its cause and retains recovery files if restoration fails.
 */
export async function writeContentDocument(
  root, document, assets, { expectedRevision } = {},
) {
  const serialized = serializeMarkdownDocument(document);
  const parsed = parseMarkdownDocument(serialized);
  const metadata = parsed.metadata;
  const incoming = new Map();
  for (const asset of assets) {
    const name = assetName(asset.name);
    if (name !== asset.name || !(asset.bytes instanceof Uint8Array))
      throw new Error("Invalid attachment input: " + asset.name);
    const key = name.normalize("NFC").toLowerCase();
    if (incoming.has(key)) throw new Error("Duplicate attachment filename: " + name);
    incoming.set(key, { name, bytes: Buffer.from(asset.bytes) });
  }
  const directory = await realpath(root);
  // ponytail: one fail-fast lock serializes repository writes; use per-ID locks if writes become concurrent.
  const lock = path.join(directory, ".content-write-lock");
  await mkdir(lock);
  let stage;
  let createdFolder = false;
  const publishedAssets = [];
  const folder = path.join(directory, "posts", metadata.id);
  let publishedMarkdown;
  let renamedOriginal;
  let previous;
  let backup;
  let sameFilesystemPath = false;
  let result;
  let failure;
  let retainStage = false;
  const cleanupErrors = [];
  try {
    const snapshot = await readContent(directory);
    previous = snapshot.documents.get(metadata.id);
    if (previous && (expectedRevision === undefined || expectedRevision !== previous.revision))
      throw new Error("The expected revision is missing or stale.");
    if (!previous && expectedRevision !== undefined)
      throw new Error("The document no longer exists.");
    if (!previous) {
      try {
        await lstat(folder);
        throw new Error("A new document cannot replace an existing folder.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    const filename = path.posix.join("posts", metadata.id, canonicalFilename(metadata.title));
    const absolutePath = path.join(directory, filename);
    const allAssets = [...(previous?.allAssets ?? [])];
    for (const asset of incoming.values()) {
      const existing = allAssets.find((item) =>
        item.name.normalize("NFC").toLowerCase() === asset.name.normalize("NFC").toLowerCase(),
      );
      if (existing) {
        const bytes = await readFile(existing.absolutePath);
        if (existing.name !== asset.name || !bytes.equals(asset.bytes))
          throw new Error("Conflicting attachment bytes or filename: " + asset.name);
      } else {
        allAssets.push({ name: asset.name, absolutePath: path.join(folder, asset.name) });
      }
    }
    const candidate = {
      metadata,
      markdown: parsed.markdown,
      filename,
      absolutePath,
      revision: hash(serialized),
      assets: [],
      allAssets,
    };
    snapshot.documents.set(metadata.id, candidate);
    validateContent(snapshot);

    stage = await mkdtemp(path.join(directory, ".content-stage-"));
    await writeFile(path.join(stage, "document.tmp"), serialized, { flag: "wx" });
    await mkdir(path.join(stage, "assets"));
    for (const asset of incoming.values())
      await writeFile(path.join(stage, "assets", asset.name), asset.bytes, { flag: "wx" });
    if (previous) {
      await regularPath(previous.absolutePath);
      const originalBytes = await readFile(previous.absolutePath);
      if (hash(originalBytes) !== expectedRevision)
        throw new Error("The source revision changed before save.");
      backup = path.join(stage, "original.tmp");
      await writeFile(backup, originalBytes, { flag: "wx", mode: 0o600 });
    } else {
      await mkdir(folder);
      createdFolder = true;
    }
    for (const asset of incoming.values()) {
      if (previous?.allAssets.some((existing) => existing.name === asset.name)) continue;
      const target = path.join(folder, asset.name);
      await link(path.join(stage, "assets", asset.name), target);
      publishedAssets.push(target);
    }
    sameFilesystemPath = previous?.absolutePath === absolutePath;
    if (previous && !sameFilesystemPath) {
      try {
        const target = await lstat(absolutePath);
        const original = await lstat(previous.absolutePath);
        sameFilesystemPath = target.dev === original.dev && target.ino === original.ino;
        if (!sameFilesystemPath)
          throw new Error("The renamed Markdown filename already exists.");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (sameFilesystemPath && previous.absolutePath !== absolutePath) {
      // Case-insensitive filesystems retain the old spelling when replacing an existing file.
      await rename(previous.absolutePath, absolutePath);
      renamedOriginal = absolutePath;
    }
    await rename(path.join(stage, "document.tmp"), absolutePath);
    publishedMarkdown = absolutePath;
    if (previous && !sameFilesystemPath) await rm(previous.absolutePath);
    result = { id: metadata.id, filename, revision: candidate.revision };
  } catch (error) {
    const restore = [];
    if (renamedOriginal)
      restore.push(() => rename(renamedOriginal, previous.absolutePath));
    if (publishedMarkdown && previous)
      restore.push(() => rename(backup, previous.absolutePath));
    if (publishedMarkdown && !sameFilesystemPath)
      restore.push(() => rm(publishedMarkdown, { force: true }));
    for (const asset of publishedAssets)
      restore.push(() => rm(asset, { force: true }));
    if (createdFolder)
      restore.push(() => rm(folder, { recursive: true, force: true }));

    const restorationErrors = [];
    for (const operation of restore) {
      try {
        await operation();
      } catch (restoreError) {
        restorationErrors.push(restoreError);
      }
    }
    failure = error;
    if (restorationErrors.length) {
      retainStage = true;
      failure = new AggregateError(
        [error, ...restorationErrors],
        "Content publication failed and restoration is incomplete. Recovery files: " + stage,
        { cause: error },
      );
    }
  } finally {
    const cleanupTargets = [lock];
    if (stage && !retainStage) cleanupTargets.unshift(stage);
    for (const target of cleanupTargets) {
      try {
        await rm(target, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push({ target, error });
      }
    }
  }
  if (failure) {
    if (cleanupErrors.length)
      throw new AggregateError(
        [failure, ...cleanupErrors.map(({ error }) => error)],
        "Content publication failed and cleanup is incomplete.",
        { cause: failure },
      );
    throw failure;
  }
  if (cleanupErrors.length)
    result.cleanupWarnings = cleanupErrors.map(
      ({ target, error }) => "Cleanup failed for " + target + ": " + error.message,
    );
  return result;
}
