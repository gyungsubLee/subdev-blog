import path from "node:path";
import { fileURLToPath } from "node:url";
import { readContent, getContentProvenance } from "../src/content.mjs";

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--check")
      throw new Error("Usage: node app/content/scripts/check-content.mjs --check");
    const root = process.env.CONTENT_ROOT ?? fileURLToPath(new URL("../../../content/", import.meta.url));
    const snapshot = await readContent(root);
    const provenance = await getContentProvenance(root);
    console.log(JSON.stringify({
      posts: snapshot.documents.size,
      categories: snapshot.categories.length,
      referencedAttachments: [...snapshot.documents.values()].reduce(
        (count, entry) => count + entry.assets.length, 0,
      ),
      errors: 0,
      ...provenance,
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
