import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { rewriteContentLinks } from "../src/shared/content-links.mjs";
import { getContentProvenance, readContent, toPublicCategories, toPublicPosts } from "./content.mjs";

const snapshot = await readContent(process.env.CONTENT_ROOT ?? "content");
const provenance = await getContentProvenance(snapshot.root, { projectRoot: process.cwd() });
const posts = toPublicPosts(snapshot);
if (!posts.length) throw new Error("The canonical content is empty.");
const categories = toPublicCategories(snapshot);

// Validate the entire source before creating or replacing public output.
await mkdir("public", { recursive: true });
const stage = await mkdtemp(path.resolve("public/.content-stage-"));
const output = path.resolve("public/content");
const backup = path.join(stage, "previous");
let hadPrevious = false;
let preserveRecovery = false;
try {
  const next = path.join(stage, "next");
  await mkdir(path.join(next, "posts"), { recursive: true });
  for (const post of posts) {
    await writeFile(path.join(next, "posts", post.id + ".json"), JSON.stringify(post));
    const entry = snapshot.documents.get(post.id);
    if (!entry.assets.length) continue;
    const directory = path.join(next, "assets", post.id);
    await mkdir(directory, { recursive: true });
    for (const asset of entry.assets)
      await copyFile(asset.absolutePath, path.join(directory, asset.name));
  }
  const index = posts.map((post) => ({
    ...post,
    markdown: post.markdown.slice(0, 1400),
    bodyLoaded: false,
  }));
  await writeFile(path.join(next, "index.json"), JSON.stringify(index));
  await writeFile(path.join(next, "categories.json"), JSON.stringify(categories));
  try {
    await rename(output, backup);
    hadPrevious = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await rename(next, output);
  } catch (error) {
    if (hadPrevious) {
      try {
        await rename(backup, output);
      } catch (restoreError) {
        preserveRecovery = true;
        throw new AggregateError(
          [error, restoreError],
          "Public output recovery retained at " + backup,
        );
      }
    }
    throw error;
  }
} finally {
  if (!preserveRecovery) {
    try {
      await rm(stage, { recursive: true, force: true });
    } catch (error) {
      console.warn("Public output cleanup failed at " + stage + ": " + error.message);
    }
  }
}
// Keep source summaries with their Git blob IDs so a cold server reads only changed files.
const references = new Map(posts.map((post) => {
  const ids = new Set();
  const collect = (destination) => {
    if (typeof destination === "string" && destination.startsWith("#/post/")) {
      ids.add(destination.slice(7).split(/[?#]/)[0]);
    }
    return destination;
  };
  rewriteContentLinks(post.markdown, collect);
  collect(post.cover);
  collect(post.icon);
  return [post.id, [...ids]];
}));
const catalog = {
  version: 1,
  documents: [...snapshot.documents.values()].map((entry) => ({
    blobSha: entry.blobSha,
    metadata: entry.metadata,
    markdown: entry.markdown.slice(0, 1400),
    filename: entry.filename,
    revision: entry.revision,
    assets: entry.allAssets.map((asset) => ({ name: asset.name })),
    references: references.get(entry.metadata.id),
  })),
};
await mkdir("server", { recursive: true });
await writeFile("server/content-catalog.json", JSON.stringify(catalog));
console.log("Prepared " + posts.length + " page summaries and separate article bodies.");
console.log("Content root: " + snapshot.root + "; content commit: " + provenance.contentCommit + " (" + provenance.contentState + ").");
