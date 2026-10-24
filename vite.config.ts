import { defineConfig, loadEnv, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import manifest from "./package.json";
import { getContentProvenance } from "./scripts/content.mjs";
import { handleRequest } from "./server/handler.mjs";

type ManagementRequest = {
  url?: string;
  method: string;
  headers: HeadersInit;
  iterator(options: { destroyOnReturn: boolean }): AsyncIterable<Uint8Array<ArrayBuffer>>;
  resume(): void;
};

export default defineConfig(async ({ mode }) => {
  const buildEnv = loadEnv(mode, ".", ["CI", "CMS_", "GITHUB_", "VERCEL", "CONTENT_"]);
  const { contentCommit } = await getContentProvenance(buildEnv.CONTENT_ROOT ?? "content", {
    projectRoot: ".",
    env: buildEnv,
  });

  return {
    plugins: [
      react(),
      {
        name: "management-api",
        configureServer(server: ViteDevServer) {
          server.middlewares.use(async (incoming, response, next) => {
            try {
              const request = incoming as unknown as ManagementRequest;
              const url = new URL(request.url ?? "/", "http://localhost");
              if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
                next();
                return;
              }

              let body;
              if (request.method !== "GET" && request.method !== "HEAD") {
                const chunks: BlobPart[] = [];
                let size = 0;
                for await (const chunk of request.iterator({ destroyOnReturn: false })) {
                  size += chunk.byteLength;
                  if (size > 4 * 1024 * 1024) {
                    request.resume();
                    response.writeHead(413, {
                      "Content-Type": "application/json",
                      "Cache-Control": "no-store",
                    });
                    response.end(JSON.stringify({ error: "Request too large" }));
                    return;
                  }
                  chunks.push(chunk);
                }
                body = new Blob(chunks);
              }

              const result = await handleRequest(
                new Request(url, {
                  method: request.method,
                  headers: request.headers,
                  body,
                }),
                { env: buildEnv },
              );
              response.statusCode = result.status;
              for (const [name, value] of result.headers) {
                if (name !== "set-cookie") response.setHeader(name, value);
              }
              const cookies = result.headers.getSetCookie();
              if (cookies.length) response.setHeader("Set-Cookie", cookies);
              response.end(new Uint8Array(await result.arrayBuffer()));
            } catch {
              response.writeHead(500, {
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              });
              response.end(JSON.stringify({ error: "Management request failed" }));
            }
          });
        },
      },
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
