import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import manifest from "./package.json";

export default defineConfig(({ mode }) => {
  const buildEnv = loadEnv(mode, ".", ["GITHUB_", "VERCEL_GIT_COMMIT_SHA"]);

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
