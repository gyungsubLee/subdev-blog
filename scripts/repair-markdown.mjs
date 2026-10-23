import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderArchivedPosts } from "./export-notion.mjs";

const content = new URL("../content/", import.meta.url);
const [records, posts, manifest] = await Promise.all(
  ["records.json", "posts.json", "manifest.json"].map(async (filename) =>
    JSON.parse(await readFile(new URL(filename, content), "utf8")),
  ),
);
const repaired = renderArchivedPosts(records, posts, manifest);
if (repaired.length !== posts.length)
  throw new Error("본문을 다시 생성하면서 글 개수가 바뀌었습니다.");

for (let index = 0; index < posts.length; index++) {
  const { markdown, excerpt, ...originalMetadata } = posts[index];
  const {
    markdown: repairedMarkdown,
    excerpt: repairedExcerpt,
    ...repairedMetadata
  } = repaired[index];
  if (JSON.stringify(originalMetadata) !== JSON.stringify(repairedMetadata))
    throw new Error("글 메타데이터가 바뀌었습니다: " + posts[index].id);
}

const changed = repaired.filter(
  (post, index) => post.markdown !== posts[index].markdown,
).length;
if (changed) {
  const target = new URL("posts.json", content);
  const temporary = fileURLToPath(target) + "." + process.pid + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(repaired, null, 2) + "\n");
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
console.log(JSON.stringify({ posts: repaired.length, changed }));
