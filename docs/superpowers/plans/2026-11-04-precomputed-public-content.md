# Precomputed Public Content Implementation Plan

> **For agentic workers:** Use executing-plans inline. Track the steps below; no unrelated edits, auto-commit, push or deployment.

**Goal:** Generate verified public files at save/push time and serve only these files on reads.
**Architecture:** Immutable `public-data/<source SHA>` refs in the existing content repository contain a public manifest, index and full posts. Managed saves prepare the ref before canonical promotion. Direct source pushes run the same generator through trusted pinned application code.
**Tech Stack:** Existing Node ESM, GitHub Git API, node:test; no new dependency.
**Spec:** ../specs/2026-11-04-precomputed-public-content-design.md (approved by the user's latest implementation request).

## Global Constraints

Preserve API and UI, source bytes, public-field boundary, authentication, conflicts, retry identity, gzip/no-store, memory and transport limits. No read-time fallback or stale latest response. Existing dirty edits are not task-owned. Work inline on the existing feature branch; do not create another checkout or commit shared changes. Remote publication is excluded by the approved spec.

## Review Focus

Missing publication must not advance a save or produce stale reads. Lost publication/head responses must be recoverable. Invalid links and editor source must fail generation. Historical requests must remain in canonical history. Generation cost must be reported separately from read savings.

### Task 1: Public generator and immutable publisher

Files: app/server/src/public-publication.mjs; tests/server/public-publication.test.mjs; tests/support/public-repository.mjs.
Interfaces: generatePublicFiles({commit, repository, github, fetcher}) -> Map<path, Buffer>; ensurePublicPublication({commit, repository, github, fetcher}) -> artifact SHA. `github` is scoped to the repository and uses the existing GitHub client.
- [x] Write failing generator/publisher tests (projection, unsafe content, immutable/retryable ref, failure before publication).
- [x] Implement bounded source loading, existing validation/projection and atomic ref publication.
- [x] Verify generator tests and exact public-output parity.

### Task 2: Generated-file reader

Files: app/server/src/public-content.mjs; tests/server/public-content.test.mjs.
Interfaces: existing handlePublicRequest API unchanged. Reader uses source head + generated ref + manifest/index/one post; no source tree/Markdown operations.
- [x] Adapt existing behavioral checks to prepared-publication fixtures, retaining generation rejection checks at their new boundary.
- [x] Implement bounded envelope checks, cache/coalescing, historical checks and compression preservation.
- [x] Run reader/generator checks, including missing/malformed output, cache budgets and head refresh.

### Task 3: Save and push wiring

Files: app/server/src/content.mjs; app/content/scripts/publish-public-content.mjs; content/.github/workflows/public-content.yml; tests/server/github-content.test.mjs; tests/server/public-publication.test.mjs.
Interfaces: publisher is required before source head promotion and before confirming recovered/superseded/unchanged saves. CLI selects an immutable commit and reuses the same publisher.
- [x] Add failing save readiness/failure/recovery checks.
- [x] Wire publisher at shared acceptance/promotion boundary; preserve existing validation and conflict checks.
- [x] Add finite-deadline CLI and source-push/manual workflow using an explicitly configured trusted app SHA. Keep the workflow only in the content repository without publishing it; remove the duplicate app-repository template.
- [x] Verify affected save/publication/CLI tests.

### Task 4: Verification and measurement

Files: docs/research/2026-11-04-precomputed-public-content/*; docs/research/2026-11-04-precomputed-public-content/activation.md (runtime documentation).
- [x] Run one bounded full check, inspect failures and source ownership; no duplicate overlapping run.
- [x] Generate against the real pinned corpus and compare index + representative bodies with the original reader, recording generation duration/requests and source hashes.
- [x] Compare old/new read processing on identical captured network inputs. Run live GitHub head checks; explicitly distinguish local generated-artifact transport from real remote artifact reads, since this task cannot publish remote artifacts.
- [x] Review exact task diff, request one read-only independent review, fix substantiated findings, rerun affected checks only.
- [x] Report implemented scope, tests, measurements and remote activation limits without claiming deployment performance.

## Execution ledger

- User selected implementation in this chat and requested after-change measurement. No additional scope approval requested.
- Existing branch is a feature branch; preserve its concurrent edits. Dependencies already installed; no reinstall needed.
- Source/context policy: INDEX is oversized and the STE-KO symlink target is missing (recorded in spec). Do not rewrite unrelated context. English documentation used.
- Baseline: .tmp/precomputed-public/{public-content-before,content-before}.mjs records exact pre-edit bytes. The live rerun-01 evidence is the read baseline; new source changes require new verification.

- Task 1: complete. Generator/publisher red-green checks include unsafe links, public fields, immutable retry, incomplete publication and full/summary projection.
- Task 2: complete. Existing 25 reader behaviors retained/adapted to generated artifacts, including gzip, historical reads and retention limits. Missing output is explicitly 503.
- Task 3: complete. Managed publication/recovery/unchanged paths require ready output. Direct-push workflow installed locally in the content repository; duplicate app-repository template removed at user request. No remote writes were made.
- Review ruling: generated inventory must be verified on reuse/status; verify complete Git tree against manifest rather than downloading every generated body again.
- Review ruling: every canonical push triggers generation, including README-only commits. The full commit SHA is the publication identity.
- Review ruling: preserve the old catalog-matching pretruncate behavior and changed-source full-transform behavior. Server and CLI pass the trusted baseline catalog; workflow prepares it from the pinned application source.
- Integration ruling: existing 30-second write aborts are incompatible with measured117-second generation. Shared content-save requests now allow300seconds; three write-specific overrides were removed. Explicit cancellation and30-second read deadlines remain.
- Task 4: full check521tests:520pass/1fail. `tests/web/records-flow.test.mjs:92` fails on a missing selected-category button. Reproduced in an isolated copy with this task's client transport edits removed; unrelated records implementation retained. No suite rerun.
- Live measurement: before code9.163seconds on this observation; full generation116.914seconds,3036GETs,23,881,466inputbytes. No GitHub writes/upload included. Subsequent live requests failed403; rate-limit endpoint confirmed anonymous core remaining0/60. Failed rows are not successful performance samples.
- Final comparison uses the exact same live source commit already present as local Git objects. All index and three representative full-post responses match byte digests. See final measurement JSON for current-source timings and hashes.
- Independent review: three initial findings and a write-timeout issue fixed with regressions; final read-only verdict has no remaining actionable findings. No independent checks were duplicated.
- Formatting: installed TypeScript language-service formatter applied only to task-owned new/replaced files. Existing mixed files kept focused hunks.
- Remote activation, real generated-file network transfer, remote save/upload duration, browser rendering and production startup remain unmeasured. See activation.md; no deployment performance claim.

- Final current-source controlled cold medians: 2203.4ms -> 137.3ms. See verification.json and final-measurement.json. All17observations HTTP200; exact index and3body digests match. Final targeted97/97 plus post-cleanup generator8/8 passed. Workflow YAML and whitespace checks passed. Local scope complete; remote activation remains explicitly unperformed.

## E2E follow-up (user requested a full rerun)

Owner: current chat. Scope: add a repeatable real-HTTP E2E target and measure the actual built UI through connected Chrome. Preserve all production behavior and unrelated edits. The external GitHub/OAuth boundary remains substituted in the disposable local test environment; production remote activation is still excluded.

- Added `npm run check:e2e`: actual HTTP handler/authentication/publication pipeline, source CRUD, public refresh, identical-request recovery, category save, missing output503 and direct-push CLI generation. No Playwright or browser automation library.
- Added production-build test server, canonical Git-object fixture and automatic browser performance instrumentation. Browser actions use only the connected Chrome AX/screenshot/input APIs. Canonical dataset is current submodule HEAD9f99941c6b650c70f363208cd97c7191ef785a46 with3,032posts; this differs from the earlier3,033post network investigation.
- Current normal app at127.0.0.1:5173 visibly reports `GitHub request failed`. The test servers do not hide or repair this activation gap through a product read-time fallback.
- HTTP E2E initially could not listen because sandbox returnedEPERM; the process exited, then one run with local-port access passed. This was an environment failure, not a passing product check.
- Chrome observed anonymous home/post rendering, owner-only controls after a test session, new BlockNote post creation, successful publication, public index/body refresh, metadata-only update preserving body, and delete confirmation/in-flight protection. Final measurements and cleanup recorded separately.
- Two Chrome clicks failed before dispatch; fresh AX proved no action occurred. Direct navigation to the exact API-observed test post recovered UI inspection. Subsequent editor/delete interactions worked. Connector delays are not counted as application latency.

E2E follow-up result: [report](../../research/2026-11-04-public-data-e2e/README.md). Added `check:e2e`, disposable real-HTTP server, Chrome timing observer and exact Git-blob asset proxy. Final HTTP3/3, support8/8 and build pass. Full regression522/524; two editor category expectations conflict with a concurrent product load change before any publication call, preserved and documented. Records roundtrip test now expands its remounted collapsed parent before original assertions; red/green1/1 and Chrome confirmation recorded. Final3-sample UI medians2523ms->798.3ms; images2539.2ms->817ms; normalized index bytes match. Initial full-corpus UI create/update/delete all succeeded (14.76/14.44/15.12seconds locally). Fixture images and page errors verified separately. Normal runtime still503 because remote publication is absent; do not mark production E2E complete. Remote actions remain outside the prior approved scope.

## Remote activation (explicitly authorized follow-up)

User now authorizes remote bootstrap, push-workflow connection and real GitHub E2E/measurement. This supersedes the earlier remote exclusion only for these operations. App main and unrelated dirty edits are preserved. Pin a minimal generator commit on a dedicated app branch; content main changes only the workflow. Use its actual push-triggered run to publish output. Real UI checks may create/update/delete one named disposable test post; never edit original user posts. Track remote before/after SHAs, workflow run/attempt and measurements in `docs/research/2026-11-04-public-data-remote/operation.json`. A commit/push does not itself establish workflow success or readiness.


## Authorized remote activation completed —2026-11-04

- Published only trusted generator dependencies on `codex/public-content-generator-20261104`; pinned final SHA `22905f58a7c18af51aac6c7d1ca0d6dfa70f16bf`.
- Installed content push workflow and successfully bootstrapped3,033 posts. All three real CMS create/update/delete main pushes triggered successful workflows.
- Fixed measured GitHub oversized-tree failures using verified large-blob uploads and bounded sequential `base_tree` assembly. Red/green checks cover both serialized size and SHA-only entry count.
- Real GitHub cold-handler medians: index3.891s→2.030s; home4.379s→2.426s. Representative first body0.211s→0.492s; disclosed regression. Current create recovery71.48s, update161.17s, delete156.55s.
- Real disposable post removed. All10,294 original source file Git blob hashes unchanged;3,033 posts remain. No app deployment/native rebuild. Local HEAD/index/content checkout preserved.
- Publisher10/10, isolated generator7/7, HTTP E2E3/3, build passed. Earlier full suite522/524 still has two unrelated category editor assertions; no all-green full-suite claim.
- Evidence: `docs/research/2026-11-04-public-data-remote/README.md` and `verification.json`.
