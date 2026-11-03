# Approved mock implementation plan

> Execution: root implements editor integration; independent agents own workspace and server/status changes. No commits, push, or deployment.

**Goal:** Implement the approved content workspace and real BlockNote editor, gated by existing owner authorization.
**Architecture:** Keep the existing owner-authenticated GitHub API and browser recovery storage. Draft saves stay local; only explicit publishing writes canonical content. Preserve lazy editor loading, existing attachment validation, revision checks and editor/Markdown pairing.
**Tech Stack:** React, TypeScript, BlockNote, Node test runner, existing GitHub API.
**Spec:** Current approved sources in `/Users/igyeongseob/.codex/visualizations/2026/11/03/01a1a0d9-d8d1-7bd3-a23c-8f1c2407d28f/second-brain-mock/v2/` and `.project-context/handoffs/approved-mock-implementation-20261104.json`.

## Constraints and review focus

- Preserve other owners' dirty files: server/github.mjs, tests/github-auth.test.mjs, vite.config.ts and native files.
- No review stage, media navigation, new dependencies or public-page redesign.
- Preserve malformed recovery bytes, lost-response retries, canonical revision checks and legacy Markdown bytes until conversion.
- Normalize external status values; legacy review becomes draft. Labels must be exhaustive.
- Auth failures must hide management and block server work; draft save must issue no publication request.
- Tag imports, existing published edits and multiple new local drafts must retain identity and metadata.

## Task 1 — state and server (status_auth agent)

- [x] Add enum, exhaustive labels and normalization tests.
- [x] Verify owner/read/mutation authorization and CSRF gates with targeted checks.
- [x] Preserve tags through existing patch validation and canonical publish.

## Task 2 — workspace and navigation (workspace agent)

- [x] Port approved list layout, filtering, statuses and authenticated navigation.
- [x] Merge canonical recovery drafts and legacy drafts without mutating public posts.
- [x] Use unique local draft identities and one managed editor route; test gates and list behavior.

## Task 3 — editor (root)

- [x] Add focused tests for local-only draft save, two headers, tags, category selection and preview.
- [x] Port approved toolbar, category dialog, tags and deferred reader preview styles.
- [x] Retain real BlockNote slash menu, source validation, imports/exports and keyboard save.
- [x] Keep legacy Markdown recovery path and canonical publication behavior.

## Task 4 — integration and evidence (root plus independent reviewer)

- [x] Run relevant frontend checks, TypeScript and production build; avoid overlapping delegated runs.
- [ ] Compare current mock and product using connected Chrome at the same viewport and state.
- [x] Review focused diff for scope, authorization, recovery behavior and performance; record unverified limits.

## Status

Started 2026-11-04. project-context check passed. Same checkout explicitly requested; preexisting changes preserved.

Implementation and automated evidence: [verification report](../../research/2026-11-04-approved-mock/verification.md). 145 tests passed and production build passed. Chrome visual acceptance remains pending; final JSDOM editing work increased 4.53%, so strict performance equivalence is not claimed.

## Follow-up — workspace header, pagination and category filter

User request supersedes the mock-specific workspace header and guidance. Reuse the common SiteHeader and SiteFooter; remove mock introduction, duplicate public link and publication preflight. Show at most 15 rows per page with previous/next controls. Combine status/search/category filters; category selection includes descendants via the existing hierarchy helper and resets pagination. Recovery, authorization and editor behavior remain unchanged.

Completed: 7 workspace tests passed, TypeScript passed, Vite build passed (67 seconds). The failing-before test observed 47 rendered rows; the new implementation renders 15 maximum, including filter/page edge cases. Category names and filtered rows are memoized, and pagination adds no data requests. Chrome inventory contains no Chrome connection, so visual comparison remains unverified. Evidence: `docs/research/2026-11-04-workspace-pagination/`.

Concurrent work: page exploration removal and logout-button changes share SiteHeader/BlogView; their edits were preserved. An expanded test run caught two failures while those tests were being edited. The owning chat `01a1a232-a582-73d3-9e37-e3d2ac539ea2` subsequently reported 23 related checks and TypeScript passing; this chat did not repeat that owner's run.

## Follow-up — reuse category modal

The user superseded five new mock options with reuse of the existing category modal. Completed shared CategorySelectionDialog for editor and workspace,360px→540px viewport-limited width with centered margins, category left and search right. Existing selection and tree styles remain.33 targeted tests, TypeScript, build and connected-Chrome component verification passed. Evidence: `docs/research/2026-11-04-category-dialog/verification.md`. The actual app's StrictMode lifecycle and focus return were included. Earlier whole-app acceptance limits remain distinct from this isolated component verification.

## Follow-up — category double-click

Completed in shared CategorySelectionDialog: double-click confirms the clicked category and closes the dialog in every consumer. Expanders remain separate; single-click/manual confirmation are preserved.35 related tests and TypeScript passed. Evidence: `docs/research/2026-11-04-category-dialog/double-click-tests.log`.
