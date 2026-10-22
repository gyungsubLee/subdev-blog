import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";

const archived = JSON.parse(await readFile("content/posts.json", "utf8"));
const byId = new Map(archived.map((post) => [post.id, post]));
await mkdir("content/written", { recursive: true });
for (const filename of await readdir("content/written")) {
  if (!filename.endsWith(".json")) continue;
  const written = JSON.parse(
    await readFile("content/written/" + filename, "utf8"),
  );
  byId.set(written.id, written);
}
let posts = [...byId.values()].sort((a, b) =>
  (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""),
);
if (!posts.length)
  throw new Error(
    "The archive is empty; finish the Notion export before building.",
  );
let assetMap = {};
try {
  assetMap = JSON.parse(await readFile("public/notion/asset-map.json", "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const remapAssets = (text) =>
  text.replace(
    /\/notion\/assets\/[A-Za-z0-9._%-]+/g,
    (url) => assetMap[url] || url,
  );
posts = posts.map((post) => ({
  ...post,
  markdown: remapAssets(post.markdown),
  cover: typeof post.cover === "string" ? remapAssets(post.cover) : post.cover,
}));
for (const post of posts) {
  if (!/^[a-f0-9-]{32,36}$/i.test(post.id))
    throw new Error("Invalid archive page ID: " + post.id);
}
await rm("public/content/posts", { recursive: true, force: true });
await rm("public/content/posts.json", { force: true });
await mkdir("public/content/posts", { recursive: true });
for (const post of posts) {
  await writeFile(
    "public/content/posts/" + post.id + ".json",
    JSON.stringify({ ...post, bodyLoaded: true }),
  );
}
const index = posts.map((post) => ({
  ...post,
  markdown: post.markdown.slice(0, 1400),
  bodyLoaded: false,
}));
await writeFile("public/content/index.json", JSON.stringify(index));
console.log(
  "Prepared " + posts.length + " page summaries and separate article bodies.",
);
