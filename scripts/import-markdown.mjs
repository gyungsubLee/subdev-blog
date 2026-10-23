#!/usr/bin/env node
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  attachmentName, canonicalFilename, mergeDocumentPatch,
  parseMarkdownDocument, serializeMarkdownDocument,
} from "../src/shared/document.mjs";
import { rewriteContentLinks } from "../src/shared/content-links.mjs";
import { readContent, validateContent, writeContentDocument } from "./content.mjs";

const defaultRoot = fileURLToPath(new URL("../content/", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function regularFile(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Attachments and inputs must be regular files: " + filename);
}

/** Import locally selected Markdown into canonical content, guarded by its source revision. */
export async function importMarkdown(inputFile, { contentRoot = process.env.CONTENT_ROOT ?? defaultRoot, expectedRevision, dryRun = false } = {}) {
  const input = path.resolve(inputFile);
  await regularFile(input);
  const parsed = parseMarkdownDocument(await readFile(input, "utf8"));
  const snapshot = await readContent(contentRoot);
  const id = parsed.documentMode === "patch" ? parsed.patch.id : parsed.id ?? randomUUID();
  const previous = snapshot.documents.get(id);
  const embeddedRevision = parsed.documentMode === "patch" ? parsed.patch.baseRevision : parsed.baseRevision;
  if (expectedRevision !== undefined && embeddedRevision !== undefined && expectedRevision !== embeddedRevision)
    throw new Error("Conflicting expected revision values.");
  const revision = expectedRevision ?? embeddedRevision;
  if (previous && (revision === undefined || revision !== previous.revision))
    throw new Error("The expected revision is missing or stale.");
  if (!previous && (revision !== undefined || parsed.documentMode === "patch"))
    throw new Error("The source document no longer exists; its revision cannot be applied.");

  let document;
  if (parsed.documentMode === "patch") {
    document = mergeDocumentPatch(previous, parsed.patch, previous.revision);
  } else if (parsed.documentMode === "full") {
    document = { metadata: parsed.metadata, markdown: parsed.markdown };
  } else {
    const now = new Date().toISOString();
    const legacy = { ...parsed.metadata };
    delete legacy.source_id;
    delete legacy.id;
    const category = snapshot.categories.find((item) => item.id === parsed.category || item.name === parsed.category || item.sources.includes(parsed.category));
    document = {
      metadata: {
        ...previous?.metadata,
        ...legacy,
        schema_version: 1, id,
        title: parsed.title ?? previous?.metadata.title ?? path.basename(input, path.extname(input)),
        parent_id: previous?.metadata.parent_id ?? null,
        created: parsed.createdAt ?? previous?.metadata.created ?? now,
        updated: parsed.updatedAt ?? previous?.metadata.updated ?? now,
        ...(category ? { category_id: category.id } : {}),
      },
      markdown: parsed.markdown,
    };
  }

  const incoming = new Map();
  const references = new Set();
  const resolve = (url) => {
    if (url.startsWith("data:")) {
      const match = url.match(/^data:(image\/(?:png|jpeg|gif|webp|avif));base64,([a-z\d+/]*={0,2})$/i);
      if (!match) throw new Error("Only supported raster image data URLs can become attachments.");
      const mime = match[1].toLowerCase();
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.toString("base64") !== match[2]) throw new Error("Invalid attachment base64 bytes.");
      const extension = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/avif": "avif" }[mime];
      const name = "image-" + digest(bytes).slice(0, 24) + "." + extension;
      incoming.set(name, { name, bytes: Buffer.from(bytes) });
      references.add(name);
      return "./" + name;
    }
    if (!url || url.startsWith("#") || /^(?:https?:)?\/\//i.test(url) || /^[a-z][a-z\d+.-]*:/i.test(url)) return url;
    const suffixIndex = url.search(/[?#]/);
    const pathname = suffixIndex < 0 ? url : url.slice(0, suffixIndex);
    const suffix = suffixIndex < 0 ? "" : url.slice(suffixIndex);
    const publicAsset = pathname.match(/^\/content\/assets\/([^/]+)\/(.+)$/);
    const legacyAsset = pathname.match(/^\/notion\/assets\/([^/]+)$/);
    let name;
    if (publicAsset) {
      if (publicAsset[1].toLowerCase() !== id) throw new Error("Attachment owner differs from its document.");
      name = attachmentName(decodeURIComponent(publicAsset[2]));
    } else if (legacyAsset) {
      if (!previous || !parsed.id) throw new Error("A legacy attachment needs its known canonical owner.");
      name = attachmentName(decodeURIComponent(legacyAsset[1]));
      if (!previous.allAssets.some((item) => item.name === name)) throw new Error("Missing owned attachment: " + name);
    } else {
      if (/\.md$/i.test(decodeURIComponent(pathname))) return url;
      name = attachmentName(decodeURIComponent(pathname.replace(/^\.\//, "")));
    }
    references.add(name);
    return legacyAsset ? "./" + encodeURIComponent(name) + suffix : url;
  };
  document.markdown = rewriteContentLinks(document.markdown, resolve);
  document.metadata = { ...document.metadata };
  for (const key of ["cover", "icon"]) {
    const value = document.metadata[key];
    if (typeof value === "string" && !(key === "icon" && (value.startsWith("/icons/") || (!/[./\\:]/.test(value) && /\p{Emoji}/u.test(value)))))
      document.metadata[key] = resolve(value);
  }
  const allAssets = [...(previous?.allAssets ?? [])];
  for (const name of references) {
    const existing = allAssets.find((item) => item.name === name);
    let asset = incoming.get(name);
    if (!asset) {
      const sibling = path.join(path.dirname(input), name);
      try {
        await regularFile(sibling);
        asset = { name, bytes: await readFile(sibling) };
      } catch (error) {
        if (error.code !== "ENOENT" || !existing) throw error;
      }
    }
    if (existing) {
      if (asset && !(await readFile(existing.absolutePath)).equals(Buffer.from(asset.bytes)))
        throw new Error("Conflicting attachment bytes: " + name);
    } else if (asset) {
      const key = name.normalize("NFC").toLowerCase();
      if (allAssets.some((item) => item.name.normalize("NFC").toLowerCase() === key))
        throw new Error("Conflicting attachment filename: " + name);
      allAssets.push({ name, absolutePath: path.join(path.dirname(input), name) });
    } else throw new Error("Missing attachment: " + name);
    if (asset) incoming.set(name, asset);
  }
  if (previous && previous.markdown !== document.markdown)
    document.metadata.review_status = "needs_review";
  const serialized = serializeMarkdownDocument(document);
  const normalized = parseMarkdownDocument(serialized);
  const filename = path.posix.join("posts", id, canonicalFilename(normalized.metadata.title));
  const planned = { id, filename, revision: digest(serialized) };
  snapshot.documents.set(id, {
    metadata: normalized.metadata, markdown: normalized.markdown,
    filename, absolutePath: path.join(snapshot.root, filename),
    revision: planned.revision, assets: [], allAssets,
  });
  // The same shared validator checks relationships and all link destinations before dry-run returns.
  validateContent(snapshot);
  if (dryRun) return { ...planned, dryRun: true };
  return writeContentDocument(snapshot.root, document, [...incoming.values()], { expectedRevision: revision });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values, positionals } = parseArgs({
      allowPositionals: true,
      options: { "content-root": { type: "string" }, "expected-revision": { type: "string" }, "dry-run": { type: "boolean", default: false } },
    });
    if (positionals.length !== 1) throw new Error("Usage: npm run import:md -- article.md [--content-root path] [--expected-revision sha256] [--dry-run]");
    const result = await importMarkdown(positionals[0], {
      contentRoot: values["content-root"] ?? process.env.CONTENT_ROOT ?? defaultRoot,
      expectedRevision: values["expected-revision"], dryRun: values["dry-run"],
    });
    console.log(JSON.stringify(result));
    for (const warning of result.cleanupWarnings ?? []) console.warn(warning);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
