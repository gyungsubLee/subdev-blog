#!/usr/bin/env node
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseMarkdownDocument } from "../src/import-document.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = process.argv[2];
if (!input)
  throw new Error("Usage: npm run import:md -- /absolute/path/article.md");
const fullPath = path.resolve(input);
const {
  title,
  category,
  id: savedId,
  sourceId,
  createdAt,
  markdown,
} = parseMarkdownDocument(await readFile(fullPath, "utf8"));
const validId = (id) =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
const id = validId(sourceId)
  ? sourceId
  : validId(savedId)
    ? savedId
    : randomUUID();
const now = new Date().toISOString();
const posts = JSON.parse(
  await readFile(path.join(root, "content/posts.json"), "utf8"),
);
const previous = posts.find((post) => post.id === id);
const post = {
  id,
  title: title || path.basename(fullPath, path.extname(fullPath)),
  category: category || "기록",
  parentId: previous?.parentId ?? null,
  path: previous?.path ?? "Written/" + id + "/index.md",
  url: previous?.url ?? "",
  createdAt:
    createdAt && !Number.isNaN(Date.parse(createdAt)) ? createdAt : now,
  updatedAt: now,
  markdown,
  excerpt: markdown
    .replace(/[#*_>\x60]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180),
};
const directory = path.join(root, "content/written");
await mkdir(directory, { recursive: true });
const target = path.join(directory, id + ".json");
await writeFile(target + ".tmp", JSON.stringify(post, null, 2) + "\n");
await rename(target + ".tmp", target);
console.log(
  "Imported: " +
    post.title +
    "\nPage: #/post/" +
    id +
    "\nRun npm run build, then deploy to Vercel to publish.",
);
