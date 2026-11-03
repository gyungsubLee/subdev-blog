# Category read investigation

This document records the pre-change baseline. For the completed optimization and current verification, read [implementation.md](implementation.md). The original probe asserts pre-change behavior and is retained as historical evidence.

Status: request-path investigation complete; no application changes or production latency measurement.
Owner: category read investigation chat. Acceptance: trace the management read path and explain avoidable work without changing UI or existing dirty files.

## Confirmed

Run `node docs/research/2026-11-04-category-read/probe.mjs` from the repository root.
The probe runs the real management handlers against deterministic GitHub responses, asserting read-only methods, successful responses, category count and revision, call counts, and maximum concurrency. `probe.json` records results and source hashes.

- Local canonical categories: 48 entries, 7,693 bytes.
- Session check: 12 sequential GitHub requests (identity plus 11 installation/repository/structure checks).
- Each category read: the same 12 requests, followed by branch ref, commit, recursive repository tree, and category blob: 16 sequential requests total.
- A repeated category read still makes 16 requests; no reuse exists in this path.
- The initial authenticated session check precedes mounting ManagedCategories, so an initial page load can involve 28 management GitHub requests, plus the independent public index load. It is not a single uninterrupted 28-call trace in the probe.
- The recursive tree is requested before dispatching on `kind`. Local content HEAD has 10,291 tree entries (`git -C content ls-tree -r HEAD | wc -l`); the live response size was not measured.
- ManagedCategories waits for the full response before displaying the tree. Its supplied public categories are not used as an initial management source.
- App also gates BlogView on usePosts loading the public index, so a cold public-index load can add another prerequisite.

## Cause and correction direction

The confirmed amplification is full publishing-readiness validation on each read, followed by a full recursive repository lookup for a single category file. Sequential external round trips accumulate independently of category JSON size. Both categories.json and the content branch head are looked up during readiness checks and again during the content read.

A focused correction would retain owner/session authorization, separate read requirements from publishing readiness, retrieve categories.json directly at a fixed content commit, and preserve revision/conflict checks. Any reuse must remain bounded and scoped to the relevant identity/configuration/commit. Do not bypass authentication or weaken write validation.

## Limits

Chrome connected successfully at http://127.0.0.1:5173/#/categories and displayed the login-required screen. No sign-in or credentials were changed. Authenticated live timing and production deployment parity are unverified. The probe proves request structure, not observed latency or the percentage attributable to each upstream response.

Existing dirty files were inspected and preserved. Only this research folder and the project index entry were added. No fix, build, deployment, or commit was requested or performed.
