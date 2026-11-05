# Durable save and workflow publication Implementation Plan

> **For agentic workers:** Use subagent-driven-development or executing-plans task by task. Do not commit, stage or push the application checkout.

**Goal:** Finish the approved durable optimistic save flow and measure device, source and publication completion separately against real GitHub.

**Architecture:** Reuse the IndexedDB queue and five-second save/publish debounce. A successful source commit returns `saved`; the content push workflow alone generates and verifies public artifacts, then advances a fast-forward-only source ready ref. The reader selects that last verified source while exact historical body identities remain immutable.

**Tech Stack:** Existing Node/React/IndexedDB/GitHub Git Data APIs; no dependency additions.

**Spec:** `docs/superpowers/specs/2026-11-04-local-first-sync.md` plus explicit 2026-11-05 handoff `optimistic-workflow-transfer-20261105.json` (the latter authorizes disposable real GitHub writes and publication changes).

## Global Constraints

- Preserve existing dirty bytes, approved UI structure/copy/styles, security, category/link validation, conflict and request receipt recovery.
- Preserve 5s debounce, three retries at 5/15/60s, nonretrying401/403/409, queue/cleanup bounds and workers.
- No app-main merge/deploy, native rebuild, preview restart or whole-index staging/commit/push.
- Dedicated generator ref/pin changes only after concrete diff and checks. Keep original source SHAs unchanged after disposable measurements.
- Chrome connected accessibility/screenshot/input only. No Playwright. One execution owner per overlapping check.

## Review Focus

- Old workflow completes after a newer source publication: ready ref cannot roll back.
- Source saved while workflow fails: last good public content stays readable and device edits remain visible.
- Lost source PATCH response or duplicate request: same candidate/receipt, no duplicate commit.
- In-flight additional edit, refresh/offline/relogin/second tab: latest durable payload survives and no false publication success.
- Reusing immutable snapshots: mutable heads and authorization stay fresh; category/link and candidate trust checks remain.

## Task 1: Separate source save from public generation

Owner: server worker. Files: content.mjs, management-read-cache.mjs and focused server tests.
- [x] Reproduce source response still awaiting/performing public writes and inline-tree missed batching.
- [x] Return `saved` once canonical source accepted; publication GET verifies ready state without generating. Reuse verified immutable snapshots and exact small UTF-8 tree content. Preserve recovery/validation.
- [x] Run focused server regression once under finite timeout and save RED/GREEN evidence.

## Task 2: Publish and select last verified public source

Owner: publication worker. Files: public-publication.mjs, public-content.mjs, publish-public-content.mjs, workflow template and focused publisher/reader tests.
- [x] Reproduce reader503 during pending source and stale workflow overwrite risk.
- [x] Verify immutable artifact before advancing public-ready/main source ref with force:false; bootstrap legacy valid main separately. Reader uses ready source; pinned historical bodies retain contract.
- [x] Run focused reader/publisher tests; prepare exact generator/workflow remote diff without mutating remote.

## Task 3: Preserve device/source/public identities

Owner: client worker. Files: sync-core.mjs, background-sync.mjs, necessary existing status/read callers and focused web tests.
- [x] Reproduce saved receipt rejection and optimistic overlay loss against old public index.
- [x] Accept verified saved receipts; preserve confirmed-source overlay until public snapshot catches up; never relabel stale public cache with new source commit. Reuse existing status UI.
- [x] Run client core/recovery/status checks under finite deadlines. Do not clone whole store or change capacity bounds.

## Task 4: Review and actual measurements

Owner: root; independent review assigned after edits. Files: dedicated tests/e2e harness and docs/research/2026-11-05-optimistic-workflow.
- [x] Review exact scoped diff and security/recovery/race tests; type/build only if impacted.
- [x] Read current remote canonical/workflow/pin, record original source SHA inventory, bootstrap verified ready source and publish authorized generator/workflow updates.
- [x] Start a dedicated current-module server/tab using real OAuth/CSRF owner permissions. Create unique disposable post, perform three title saves, delete it; capture click→durable/UI, queue with/without debounce→source, and workflow→public with counts and bytes.
- [x] Compare all original SHA inventory and post count, workflow status/SHA; close only owned tab/server. Report separate real vs fake evidence and unverified browser large-queue memory.

## Execution rulings

Existing approved scope explicitly requests implementation and measurement without a new approval gate. Use this shared dirty checkout as directed; no worktree migration or commits. Existing oversized INDEX check fails before this task and is preserved. STE-KO symlink is stale; its real installed source is under `/Users/igyeongseob/Develop/10_harness/STE-KO`.

## Completion evidence

All four tasks finished. See `docs/research/2026-11-05-optimistic-workflow/README.md`, `analysis.json` and `verification.json`. Real source mutations5/5 and push workflows5/5 succeeded. A late old-source workflow returned superseded with0writes. Original10292fileSHAs/3032posts matched after cleanup. Device/UI/remote/public timings are separate. Full React editor latency, browser large-queue memory and whole-suite status remain explicitly unverified. No application-main deployment/merge/native rebuild or checkout staging/commit/push.
