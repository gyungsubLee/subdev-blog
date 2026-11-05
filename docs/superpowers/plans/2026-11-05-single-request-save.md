# Single GitHub mutation save Implementation Plan

> **For agentic workers:** Use subagent-driven-development. No staging, local commits, application push/deploy or workflow changes.

**Goal:** Replace the twelve sequential GitHub calls in normal prepared saves with one atomic createCommitOnBranch mutation; preserve durable queue, validation, conflict/recovery and workflow publication, then measure actual GitHub title saves3.

**Architecture:** Reuse a bounded trusted immutable source snapshot from the existing source read. Validate changes locally. Submit fileChanges with expectedHeadOid to createCommitOnBranch and consume its authoritative commit/ref response. Do not separately create a tree, commit or request ref, read heads before/after, or re-fetch known receipt data. Old durable requests and legacy candidate refs remain recoverable. Atomic saved receipts use source-only publication status. A lost response requires read-only provenance reconciliation, never blind replay or force overwrite.

**Spec:** Latest user request2026-11-05: immediately implement one-request flow, actually measure request count/time, preserve existing workflow/conflict/recovery; previous optimistic-workflow spec/handoff remain except this source-save amendment.

**Tech Stack:** Existing Node/React/IndexedDB and official GitHub GraphQL schema (already introspected CreateCommitOnBranchInput: branch,fileChanges,message,expectedHeadOid,clientMutationId).

## Global Constraints

- Shared dirty checkout and previous UI/auth/local-first/bulk changes preserved. UI/copy/styles,5s debounce,50MiB queue and existing cache memory bounds unchanged.
- Retain category/link/editor/asset validation and credential/config isolation. Client-provided unsigned source data is never authority.
- expectedHeadOid provides atomic compare-and-swap, not automatic merge.401/403/409 do not loop or overwrite. clientMutationId is correlation only.
- Same requestId+payload cannot apply twice; changed payload/requestId reuse rejected. Recovery may read GitHub and must report extra calls.
- Cold source preparation cannot be disguised as one total network request. Report preparation, normal save, recovery and public workflow separately.
- Existing generator pin/workflow/public-ready reader untouched. No app-main merge/deploy/native build, preview restart or checkout staging/commit/push.
- Chrome-connected accessibility/screenshot/input only; no Playwright. Root owns actual OAuth/CSRF/temp create/title3/delete measurement and SHA cleanup.

## Review Focus

- Response lost after successful mutation, including process restart or canonical descendant: recover exact provenance; never duplicate commit.
- Concurrent edits/tabs or unrelated remote advance: expectedHead conflict preserves durable local payload.
- Cache eviction/cold start: bounded trusted source preparation, no trust bypass or fabricated1call claim.
- New source receipt/publication query and old persisted candidate batches both recover.
- New files, title rename, category/link/assets/editor and bulk receipt remain valid; changed request fingerprint never accepted.

## Task1: Atomic source save and client contract

Owner: implementation worker; content.mjs, bounded cache/GitHub helper if needed, sync-core/background-sync and only necessary existing types/callers; tests dedicated atomic-save + related fixture/recovery tests.
- [x] Snapshot owned inputs and create failing checks for warm normal save exactly one GraphQL mutation, source receipt and no REST writes/heads.
- [x] Reuse existing bounded immutable cache with safe peek/prime/retain as necessary; do not add a duplicate repository cache. Prepare cold source explicitly and account all calls.
- [x] Implement atomic changes and authoritative response checking; exact locally validated generated source bytes supply receipt.
- [x] Reconcile lost response via exact cms-request/payload fingerprint/parent provenance in bounded read-only history; no clientMutationId idempotency assumption. Preserve old request branches for legacy requests.
- [x] Adapt new queue protocol/status while retaining existing persisted requests and publication tracking/cleanup. No UI layout/copy changes.
- [x] Run focused TDD/regression under finite deadlines, one owner for each test target; return logs and scoped patch/hashes. No full suite/build (root owns after edits).

## Task2: Independent review and measurement

Owner root; fresh read-only reviewer via code-review after Task1. Root alone owns build/type/HTTP integration and actual GitHub measurements.
- [x] Inspect scoped diff and checks. Fix reproduced Important findings with bounded targeted checks.
- [x] Reuse dedicated server/control harness adapted to current atomic contract; fresh report folder, fresh canonicalSHA inventory and current workflow pin. Preserve previous measurements.
- [x] Real OAuth/CSRF owner temp creation, title3 and deletion; record preparation and mutation calls separately, durable/UI/debounce/source/public metrics. Require exactly1GitHub call per prepared title save to claim success.
- [x] Watch exact source workflows, verify public reader and original SHA cleanup, close owned tabs/server, write report/checkpoint. Explicitly report cold/recovery extra calls and unverified full-editor/large-queue limits.

## Rulings

User already explicitly approved this design and execution. Use same dirty checkout and no new approval gate. One implementation worker owns coupled server/client changes; root measurement preparation is independent. Existing INDEX oversized check remains a known context issue; do not reset it.

### Durable idempotency ruling

A finite first-parent history scan cannot preserve the old durable request-ID guarantee. Each atomic mutation therefore also adds immutable `.cms/requests/<requestId>.json` with version/requestId/payloadHash/baseCommit. The validated base tree proves that a new ID is unused; existing receipt paths reject reuse before mutation. A lost-response recovery reads canonical receipt and path-specific first history commit, verifying exact provenance, instead of unbounded scanning or blind retries. This adds no round trip to a prepared save. The existing publisher ignores non-post root metadata, so workflow/pin remain unchanged. Preserve receipts as recovery history. Measurement cleanup compares every original file SHA and post removal, while reporting the5new task receipt files separately; do not silently claim identical total file count or delete receipts to manufacture it.

### Final implementation rulings

Fresh atomic request IDs use `atomic-<UUID>`, structurally isolated from legacy UUID requests; existing persisted legacy batches keep their original protocol. Atomic authored no-ops reserve identity through a marker-only commit but retain `unchanged` UI state. Durable `sent` dispatch intent supplies an out-of-band reconciliation header, never changing original payload/hash. Reconciliation requires exactly one parent and returns known superseded immediately if canonical advanced. Transient GraphQL errors remain retryable.

Expanded fileChanges bytes are counted before base64. Oversized supported saves use bounded SHA Git-data fallback with the same marker and fresh-head/nonforce conflict checks; report their multiple calls rather than weakening limits or claiming all saves1request. Fallback retains64KiB/file and1MiB aggregate inline bounds. Shared immutable cache insertion replaces accounting atomically and strips unused tree URLs within the existing budget. Independent reviewer approved after scoped fixes.

## Completion evidence

Actual title3sourcePOSTs each exactly1GraphQLmutation:1573.647/2058.804/1599.126ms; median1599.126ms vs6122.268ms. Existingworkflow5success. Acceptedrequestreadonlyreconciliation8reads0mutationssamecommit. Original10292fileSHAs/3032posts preserved plus5durablemarkers, allmarkerSHA proofs match. Rootserver/tabsclosed; report docs/research/2026-11-05-single-request/README.md and verification.json. No app-main deployment/merge/native build/staging/commit/push. Cold/recovery/largefallback calls, fullReact/editor and largequeue limits remain explicit.
