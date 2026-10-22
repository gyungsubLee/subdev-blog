import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
);
const lock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url)),
);

assert.equal(lock.version, manifest.version, "Lockfile must match package.json");
assert.equal(
  lock.packages[""].version,
  manifest.version,
  "Lockfile root must match package.json",
);
if (process.env.GITHUB_REF_TYPE === "tag") {
  assert.equal(
    process.env.GITHUB_REF_NAME,
    "v" + manifest.version,
    "Tag must match the package version",
  );
}

console.log("Version v" + manifest.version + " is consistent.");
