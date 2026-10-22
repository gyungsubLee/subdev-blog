import { mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Bundle local imports while sharing the test's React instance and DOM globals.
export async function loadComponent(entry) {
  const result = await build({
    entryPoints: [resolve(entry)],
    bundle: true,
    packages: "external",
    platform: "node",
    format: "esm",
    write: false,
    jsx: "automatic",
    plugins: [
      {
        name: "omit-test-css",
        setup(api) {
          api.onResolve({ filter: /\.css$/ }, (args) => ({
            path: args.path,
            namespace: "empty-css",
          }));
          api.onLoad({ filter: /.*/, namespace: "empty-css" }, () => ({
            contents: "",
            loader: "js",
          }));
        },
      },
    ],
  });
  await mkdir(resolve(".tmp"), { recursive: true });
  const output = resolve(
    ".tmp",
    basename(entry) + "-" + process.pid + "-" + crypto.randomUUID() + ".mjs",
  );
  await writeFile(output, result.outputFiles[0].text);
  try {
    return await import(pathToFileURL(output).href);
  } finally {
    await unlink(output);
  }
}
