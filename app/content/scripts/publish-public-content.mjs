import { pathToFileURL } from 'node:url';
import { createGitHubClient } from '../../server/src/github.mjs';
import { publishPublicSource, generatePublicFiles } from '../../server/src/public-publication.mjs';
import { SHA } from '../../server/src/public-files.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// This command reads only immutable source objects. Publishing requires an explicit flag.
export async function runPublicPublication(args, { env = process.env, fetcher = globalThis.fetch } = {}) {
  let commit;
  let output;
  let publish = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--commit') commit = args[++index];
    else if (args[index] === '--output') output = args[++index];
    else if (args[index] === '--publish') publish = true;
    else throw new Error('Unknown publication argument');
  }
  if (!SHA.test(commit ?? '') || (!output && !publish) || (output && publish)) {
    throw new Error('Use --commit <full SHA> with either --output <directory> or --publish');
  }
  const repository = 'gyungsubLee/subdev-blog-content';
  const client = createGitHubClient(env.GITHUB_TOKEN ?? env.GITHUB_PUBLIC_TOKEN, fetcher);
  const github = (path, options) => client('/repos/' + repository + path, options);
  const head = await github('/git/ref/heads/main');
  if (head.object?.sha !== commit) {
    const comparison = await github('/compare/' + commit + '...' + head.object?.sha);
    if (comparison.status !== 'ahead') throw new Error('Source commit is outside the canonical branch');
  }
  let catalog;
  try { catalog = JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../../server/generated/content-catalog.json', import.meta.url), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const options = { commit, repository, github, fetcher, catalog };
  if (publish) return publishPublicSource(options);
  const files = await generatePublicFiles(options);
  // A partial directory is not a published ref and must never be used as a readiness signal.
  for (const [filename, bytes] of files) {
    const destination = path.resolve(output, filename);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  return { sourceCommit: commit, files: files.size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const deadline = setTimeout(() => {
    console.error('Public generation exceeded its 180 second deadline; retry with the same source commit.');
    process.exit(2);
  }, 180000);
  try {
    const fetcher = async (url, options = {}) => {
      const started = Date.now();
      const method = options.method ?? 'GET';
      const path = new URL(url).pathname;
      const call = { method, host: new URL(url).host, path, startedAt: started, requestBytes: Buffer.byteLength(options.body ?? ''), responseBytes: 0, bodyComplete: false };
      let logged = false;
      const record = () => {
        if (logged) return;
        logged = true;
        console.error(JSON.stringify({ ...call, ms: Date.now() - started }));
      };
      try {
        const response = await fetch(url, options);
        call.status = response.status;
        if (!response.body) {
          call.bodyComplete = true;
          record();
          return response;
        }
        const reader = response.body.getReader();
        if (!response.ok) {
          // GitHub callers discard error bodies. Drain a bounded diagnostic body
          // here so misses and denied requests are still included in the trace.
          try {
            while (call.responseBytes <= 64 * 1024) {
              const { done, value } = await reader.read();
              if (done) { call.bodyComplete = true; break; }
              call.responseBytes += value.byteLength;
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
            record();
          }
          return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
        }
        const stream = new ReadableStream({
          async pull(controller) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                call.bodyComplete = true;
                record();
                reader.releaseLock();
                controller.close();
              } else {
                call.responseBytes += value.byteLength;
                controller.enqueue(value);
              }
            } catch (error) {
              call.bodyError = error.name;
              record();
              reader.releaseLock();
              controller.error(error);
            }
          },
          async cancel(reason) {
            call.cancelled = true;
            try { await reader.cancel(reason); }
            finally { reader.releaseLock(); record(); }
          },
        });
        return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
      } catch (error) {
        call.networkError = error.name;
        record();
        throw error;
      }
    };
    console.log(JSON.stringify(await runPublicPublication(process.argv.slice(2), { fetcher })));
  } catch (error) {
    console.error(error.status ? `Public generation failed (HTTP ${error.status}): ${error.message}` : error.message);
    process.exitCode = 1;
  } finally { clearTimeout(deadline); }
}
