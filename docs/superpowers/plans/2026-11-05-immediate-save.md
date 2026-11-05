# Immediate background save Implementation Plan

**Goal:** Send saved durable changes immediately instead of waiting5seconds, preserving single-GitHub-mutation saves, duplicate prevention, conflicts and recovery; remeasure actualGitHub title3.

**Spec:** Latest user2026-11-05 explicitly removes5second save debounce. All prior single-request/workflow/validation/recovery contracts retained; retry waits5/15/60seconds remain.

**Execution:** Root inline implementation/TDD/build/real measurement, followed by fresh independent scoped code review. Shared dirty checkout and other edits preserved. No staging/commit/push/app-main deployment/native rebuild or other preview restart.

## Task1: Immediate durable dispatch

Files: sync-core.mjs, focused sync-core tests, only necessarily impacted timing tests.
- [x] RED: same-clock stage schedules immediate dispatch only after durable staging, unsent versions still coalesce; in-flight edits dispatch next withoutclockadvance; restored legacyfuture dueAt no wait.
- [x] Remove save debounce gate/initial delay. Keep transaction/lease/frozen payload/sent-intent/retryAt/blocked safeguards.
- [x] GREEN: focused core/recovery/client contracts under bounded runtime; root sole execution owner. Fresh scoped independent review.

## Task2: Actual measurement and cleanup

Reuse dedicated current-module server and production queue/control. New evidence folder; adapt timing report to nominaldebounce0 without rewriting old reports. Fresh immutable source inventory and unchanged workflow pin. Real OAuth/CSRF owner create/title3/delete; exact1GitHubcall each prepared title. Compare click→dispatch/source against prior5018ms queue/6682ms total. Verify5workflows and originalSHA preservation with5new requestmarkers, clean owned resources and report limits. Whole-editor/largequeue memory remains outside small harness evidence.
- [x] Build/type, root-owned HTTP integration if impacted.
- [x] Actual3measurements and workflow/sourcecleanup.
- [x] Report/checkpoint, scoped diff review and owned resource cleanup.

Result: docs/research/2026-11-05-immediate-save/README.md. Scoped checks pass; UI performance caveat is recorded explicitly. HTTP unchanged and not rerun.
