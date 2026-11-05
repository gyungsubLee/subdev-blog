# Precomputed public content: operation and activation

Public reads now consume generated JSON for an exact source commit. They do not validate or project the corpus. This checkout does not publish generated files or deploy itself.

## Managed saves

The shared save/publish boundary prepares `refs/heads/public-data/<source SHA>` before advancing canonical HEAD. Source conflict checks, immutable request branches and lost-response recovery remain in place. A publication failure leaves the source candidate available for retry. An unchanged or recovered save also requires a ready publication.

The generated ref points to an independent Git commit containing `manifest.json`, `index.json` and `posts/<UUID>.json`. Only public fields are written. The manifest records source identity and the exact file inventory. Reuse and authenticated publication status verify that inventory against the generated Git tree. The public reader performs request/envelope checks and preserves historical eligibility, bounded caches, gzip and no-store responses.

Missing generated output returns 503. Invalid output fails explicitly. There is no source-reading fallback and no silent stale latest response.

Generation has eight source-download lanes, 2 MiB source-file and 64 MiB aggregate source/output bounds, a 180-second source-download deadline, and 15-second individual transport deadlines. The CLI has a 180-second whole-command deadline. The server function and content-save client request permit 300 seconds. Explicit client cancellation still takes precedence; existing 30-second read deadlines remain unchanged.

The full-generation approach is deliberately simple. It reads all Markdown at write time: a live run for 3,033 posts took 116.9 seconds, excluding Git object upload. The final local-object run separately measures processing without remote transport. Write latency has not been preserved. Subsequent authorized real-GitHub E2E measured create recovery71.48s, fresh title update161.17s and delete156.55s; see the remote report.

## Push workflow and bootstrap

The workflow is maintained only in `content/.github/workflows/public-content.yml`; the duplicate app-repository template was removed at user request. The nested repository change must be published separately from the app repository change.

The workflow runs for **every** main-branch push, including non-content changes, because output is keyed by the full source commit. Generated-ref pushes do not trigger it. Manual bootstrap accepts a full source SHA; the CLI verifies canonical-history eligibility. It executes trusted application code from the content repository's `PUBLIC_GENERATOR_APP_SHA` variable, which must be the full reviewed app commit containing this implementation. It does not execute scripts from the content revision being processed. The trusted app's pinned content submodule prepares the baseline catalog to preserve the existing summary semantics.

Before activating the new reader remotely:

1. Publish the reviewed application generator code without activating the new reader prematurely.
2. Set `PUBLIC_GENERATOR_APP_SHA` in the content repository to that reviewed full app commit. Publish the local content workflow through the normal repository process.
3. Manually generate output for the current canonical content SHA and verify index/post responses and attachment URLs. With an existing read/write token confined to the content repository, the equivalent explicit command is:

   ```sh
   node app/content/scripts/publish-public-content.mjs --commit <full-source-SHA> --publish
   ```

4. Activate the app reader after bootstrap has completed. Test one managed save and one direct source push, including the temporary 503 interval for direct pushes.

For read-only generation into a local directory:

```sh
node app/content/scripts/publish-public-content.mjs --commit <full-source-SHA> --output /tmp/public-content-output
```

Use an existing server-only read token through `GITHUB_PUBLIC_TOKEN` for authenticated reads; use `GITHUB_TOKEN` only when an explicitly authorized publishing operation needs write access. Never expose these values in browser settings, output or Git.

The later user-authorized remote activation is complete. The trusted generator is pinned to `22905f58a7c18af51aac6c7d1ca0d6dfa70f16bf` on app branch `codex/public-content-generator-20261104`. Content workflow installation `ae379ba3db9279e04fd12befb1b757091fbdbcb5` triggered successful bootstrap; subsequent real CMS create/update/delete pushes also completed successfully. No app-main merge/deployment or native rebuild was performed.

Remote GitHub rejected oversized one-shot trees. Generation now uploads oversized files through the verified Blob API and assembles trees sequentially using `base_tree`, with each tree request bounded to200 entries and2MiB serialized JSON. There is no final unbounded tree request. This preserves publication atomicity while fitting GitHub's observed processing limits.

See [actual GitHub E2E evidence](../2026-11-04-public-data-remote/README.md). Original source files were restored exactly after deleting the disposable test post. The already-running native preview held old code and was preserved; real write verification used a separate current-module backend with the existing genuine session and normal authorization/CSRF checks. The native preview must load current code on its next normal restart.


## Incremental publication follow-up

User-requested incremental generation is implemented and remotely verified. Current trusted pin is `9c7a699f3ec2b2e1839fd1371baf52eabd5eca30`. Changed/affected bodies only are validated/projected; verified existing body blobs and immutable asset URLs are reused through the prior generated tree. Cheap global graph checks and aggregate index/cache writes remain. Separate `generation.json` state does not add a public-reader download or change its manifest keys. An old/missing/incompatible cache takes one full bootstrap. State bootstrap completed on the real repository. See [incremental actual GitHub timings](../2026-11-04-incremental-public-data/README.md): independent create22.28s, update20.73s and delete28.21s, compared with prior full update161.17s/delete156.55s. Original10294 files preserved;5 push workflows passed. The earlier full-generation timings describe historical behavior.
