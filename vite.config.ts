import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import manifest from "./package.json";
import { getContentProvenance } from "./scripts/content.mjs";

export default defineConfig(async ({ mode }) => {
  const buildEnv = loadEnv(mode, ".", ["CI", "GITHUB_", "VERCEL", "CONTENT_"]);
  const { contentCommit } = await getContentProvenance(buildEnv.CONTENT_ROOT ?? "content", {
    projectRoot: ".",
    env: buildEnv,
  });

  return {
    plugins: [
      react(),
      {
        name: "build-info",
        generateBundle() {
          this.emitFile({
            type: "asset",
            fileName: "build-info.json",
            source: JSON.stringify(
              {
                version: manifest.version,
                contentCommit,
                commit:
                  buildEnv.GITHUB_SHA ??
                  buildEnv.VERCEL_GIT_COMMIT_SHA ??
                  null,
                runId: buildEnv.GITHUB_RUN_ID ?? null,
                runNumber: buildEnv.GITHUB_RUN_NUMBER ?? null,
                runAttempt: buildEnv.GITHUB_RUN_ATTEMPT ?? null,
                workflow: buildEnv.GITHUB_WORKFLOW ?? null,
              },
              null,
              2,
            ) + "\n",
          });
        },
      },
    ],
  };
});
