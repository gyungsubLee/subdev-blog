import { mkdir, writeFile } from "node:fs/promises";
import { rewriteContentLinks } from "../../shared/content-links.mjs";
import { getContentProvenance, readContent, toPublicPosts } from "../../content/src/content.mjs";

const snapshot = await readContent(process.env.CONTENT_ROOT ?? "content");
const provenance = await getContentProvenance(snapshot.root, { projectRoot: process.cwd() });
const posts = toPublicPosts(snapshot);
if (!posts.length) throw new Error("The canonical content is empty.");

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
await mkdir("app/server/generated", { recursive: true });
await writeFile("app/server/generated/content-catalog.json", JSON.stringify(catalog));
console.log("Prepared server catalog for " + posts.length + " posts; content commit: " + provenance.contentCommit + " (" + provenance.contentState + ").");
