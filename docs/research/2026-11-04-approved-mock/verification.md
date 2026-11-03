# Approved mock implementation evidence

Product implementation and automated checks are complete. Visual acceptance and strict performance equivalence remain unverified.

## Scope

The authenticated content workspace and managed BlockNote editor now use the approved source layout. The editor has a file menu, two action headers, category selection, wrapping tags and desktop/mobile reader preview. Existing public pages retain their layout. Only authorized owner sessions render the workspace; existing server authentication, connection checks, Origin and CSRF checks protect content operations.

`PostStatus` contains only Draft and Published with exhaustive labels. Recovery values normalize legacy review, missing and unknown statuses to Draft. Tags pass through canonical patch validation. Unique local draft keys and canonical identity preserve updates after first publication. Local draft saves issue no publication requests; explicit publishing retains the original API, revisions and paired editor/Markdown validation.

## Automated checks

- Server/status: 86 passed. `server-tests.log`.
- Workspace: 5 passed. `tests/content-workspace.test.mjs`, last run owned by workspace agent.
- Managed editor: 23 passed. `editor-tests.log`.
- Blog/browse/reader/content integration: 31 passed. `integration-tests.log`.
- Production build: passed, Vite 57.95 seconds. `build.log`. Existing large-chunk warning remains.
- `git diff --check`: passed.
- Independent source review: initial findings were fixed; final scoped review found no remaining actionable finding. No independent test execution duplicated the owners' checks.

An initial regression test failed because the previous editor had no local draft button. During integration, selectors were updated to the approved category button and real slash-menu image upload. Existing recovery assertions remain. A malformed-tag fixture initially failed block validation before reaching tag validation; it was corrected to valid inline content. The first build found an un-narrowed parsed-document union; the import now discriminates on documentMode before reading metadata. Failed evidence is preserved in the adjacent logs.

## Performance

All measurements use JSDOM, 100 paragraphs and 20 real text edits. They measure React/editor work and storage, not hardware input latency or FPS. Existing editor loading, revision guards, validated attachment URLs, source request reuse and synchronous recovery writes remain.

An initial visible preview increased total edit work from 308 ms to 580 ms. The reader body now coalesces changes over 200 ms, with timer cleanup; memoized preview content avoids Markdown parsing on metadata-only changes. The final three paired samples used stable source hashes and bounded isolated processes.

Final median total: baseline 308.60 ms; current 322.60 ms (+4.53%). Per-edit median: 15.03 ms to 16.55 ms. Median mount: 95.64 ms to 130.46 ms. Residual preview feature overhead remains; strict performance equivalence is not established. All samples retained one source request, 20 recovery writes, 100 blocks and every edit. Final preview content matched recovery in all three runs. See `final-summary.json`, `final-bindings.sha256` and paired logs. All benchmark child processes exited and temporary source modules were removed.

## Unverified acceptance

Chrome discovery initially found the connected extension, but task-tab creation timed out. A fresh inventory then contained only MCP Apps and the in-app browser, with no Chrome connection. No Playwright fallback or native window capture was used. Same-viewport mock/product screenshots, responsive visual parity, actual keyboard/mouse behavior and real-device performance remain pending. Source review of editor CSS matched the approved file after root-class rename, with status badge styles copied from the mock; that is not a screenshot comparison.

No live GitHub publication, remote push, deployment or commit was performed. Preexisting server/github.mjs, tests/github-auth.test.mjs, vite.config.ts and native changes belong to other work and were preserved. The external approved mock was read only.

Next action: validate the approved screen and editing responsiveness when the connected Chrome surface is available.
