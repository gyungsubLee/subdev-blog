# Actual GitHub publication and E2E measurements

Remote bootstrap, automatic push generation, and real CMS create/update/delete completed. The disposable test post was removed, restoring all original source files byte-for-byte (Git blob SHA comparison). The canonical corpus has 3,033 posts again.

## Remote configuration

- Content workflow commit: `ae379ba3db9279e04fd12befb1b757091fbdbcb5`; only `.github/workflows/public-content.yml` changed.
- Trusted generator branch: `codex/public-content-generator-20261104` in the app repository.
- Pinned `PUBLIC_GENERATOR_APP_SHA`: `22905f58a7c18af51aac6c7d1ca0d6dfa70f16bf`.
- [Initial push/bootstrap run](https://github.com/gyungsubLee/subdev-blog-content/actions/runs/41824034965): success,137 seconds overall,84 seconds for validation/publication.
- Bootstrap artifact: `3691898cb231115b4594542ade7300d710e65544`;3,035 files;26,229,999 generated payload bytes excluding manifest. Index5,560,675 bytes,1,297,463 gzip bytes.
- No app-main merge/deployment or native rebuild. Existing local HEAD, staging, content checkout and unrelated edits preserved.

## Read measurements

Same source commit `ae379ba3db9279e04fd12befb1b757091fbdbcb5`,3,033 posts, production frontend build, connected Chrome. Actual GitHub REST/raw I/O; no fixture. Each median uses three empty-handler-cache samples. CDN/network caches were not forced cold. Vercel cold-start excluded.

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Index API median | 3.891s | 2.030s | 47.8% shorter |
| Home displayed median | 4.378s | 2.426s | 44.6% shorter |
| Home images complete median | 4.387s | 2.533s | 42.3% shorter |
| Representative first body navigation (one observation) | 0.211s | 0.492s | Slower by remote body fetch |

Before/after index and representative full-body SHA256 digests match exactly; see `parity.json`. No browser errors or image failures. A cookie-free request to the normal configured app without a public read token returned200.

The remaining first-read cost includes GitHub ref resolution and manifest/index transport. The index is still5.56MB uncompressed; these measurements do not isolate all network vs JSON/gzip CPU time. Full corpus validation/projection no longer runs in the reader.

## Real writes and cleanup

| Operation | HTTP | Time |
|---|---:|---:|
| Create recovery using same failed source candidate |200|71.48s|
| Fresh title update |200|161.17s|
| Delete disposable post |200|156.55s|

The first create attempt used the already-running native preview process, which held old publisher code in memory; it failed502 after144.01s. The process was preserved. The measurement backend was restarted with current modules, existing authentic session and CSRF checks, and the same source candidate was recovered. Its71.48s is not a fresh cold-create benchmark.

Create and update kept test ID `a1986037-7090-45ab-a3de-3208b34f7e7b`. The real reader displayed the updated title/body. Delete removed the Markdown/editor source and public index entry. `deleted.json` verifies every original source blob, not only post count. All three actual main pushes triggered successful workflows; see `workflow-runs.json`.

Full generation moves substantial work into writes. Fresh update/delete timings are the practical cost at this corpus size. The body first-navigation regression is reported above; repeat body API access was0.33ms from the existing cache.

## Failures discovered and fixed

GitHub rejected the all-files inline tree with422 (input too large). Bounded inline uploads succeeded, but a5.56MB inline index and a final3,035-entry SHA-only tree still produced502. Current code uses verified Blob API uploads for oversized files and sequential `base_tree` requests bounded to200 entries and2MiB serialized JSON. There is no final unbounded tree request. A ready ref is created only after every file and commit exists. Two new tests failed before these fixes and pass now. Independent read-only review found no remaining actionable issue.

## Verification limits

Publisher tests10/10, isolated generator checks7/7, HTTP E2E3/3 and production build passed. Earlier full suite was522/524; two unrelated category editor assertions remain failing. This report does not claim the complete unit suite is green. Local HTTP negative-path/category tests supplement, rather than replace, actual GitHub happy-path tests. No destructive remote category or fault-injection edits were made.

See `verification.json`, `source-hashes.json`, per-phase JSON, browser/API records, publication logs and screenshots for evidence. Credentials are not included.
