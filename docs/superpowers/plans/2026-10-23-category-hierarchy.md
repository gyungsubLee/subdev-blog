# Category Hierarchy Implementation Plan

> **For agentic workers:** Use `implement` to execute these tasks inline. The user approved the working mockup and explicitly requested immediate implementation.

**Goal:** Reproduce the approved revision-3 mockup on the real categories route, including inline add/rename, delete confirmation, pointer and keyboard hierarchy moves, undo, and one explicit save action.

**Architecture:** Keep the source post metadata immutable. Store a flat, validated category tree with stable IDs and parent IDs, and migrate v1 group settings without overwriting the original storage. Derive the existing records catalog from the tree so its three views remain compatible. Reuse the approved mockup's CSS and interaction rules in React.

**Tech Stack:** React 19, TypeScript, native pointer events and dialog, localStorage, existing node:test/jsdom.

**Spec:** Approved mockup `/Users/igyeongseob/.codex/visualizations/2026/10/23/01a166a1-1828-7563-a44c-e48dcb3ad810/category-mockup/v2/` (revision 3). The final user-approved screen has no sidebar, no manage/move actions, and no buttons on the all-categories row.

## Global Constraints

- Match the mockup's list spacing, colors, inline forms, hover/selected actions, bottom add button, and save bar.
- Preserve existing category names, order, stable IDs, and source post fields. Do not install dependencies.
- Persist only on explicit save; failed storage writes must preserve the draft and undo history.
- Category names are 1-100 normalized characters, case-insensitively unique; maximum 500 categories for additions.
- Parent deletion lifts direct children and transfers direct source assignments to unclassified; source posts are not deleted.
- Preserve unrelated user test edits. Current baseline includes pre-existing route expectation failures.

## Review Focus

- v1 migration preserves all original assignments and aliases, including unknown incoming post categories.
- Every source belongs to exactly one node, including after deletion and later reconciliation.
- Self/descendant drops cannot form cycles; moving a branch preserves its children.
- Empty and long category names cannot corrupt saved data or clip the controls.
- Route changes and failed saves cannot discard unsaved edits silently.

### Task 1: Tree and persistence

**Files:** `src/features/post-category/hierarchy.ts`, `catalog.ts`, `useCategoryCatalog.ts`, `tests/category-hierarchy.test.mjs`.

**Interfaces:** `CategoryNode { id, name, parentId, sources }`; tree migration, validation, descendants, move, removal, records adapter. Catalog exposes `nodes` and `saveNodes` while retaining legacy `groups`/`save` compatibility for existing consumers.

- [x] Write and run failing tests for migration, branch moves, cycle validation, delete/reconcile, and record adapter descendant matching.
- [x] Implement the tree helpers and v2 storage with immutable source metadata and v1 fallback.
- [x] Run tree and catalog tests and TypeScript checks.

### Task 2: Approved manager UI

**Files:** `src/pages/categories/CategoriesPage.tsx`, `CategoriesPage.css`, `useCategoryDrag.ts`, `tests/category-manager.test.mjs`.

- [x] Replace obsolete manager interaction tests with staged-save, inline editing, native dialog deletion, keyboard and pointer drag tests. Preserve the existing user-specified test URL.
- [x] Observe failures before implementing React markup and interactions.
- [x] Port the approved manager DOM and styling, removing only prototype-specific labels and explanations.
- [x] Keep drafts in the app-level owner so category-route round trips preserve unsaved edits. Confirm before leaving the browser with unsaved changes.
- [x] Run manager tests and TypeScript checks.

### Task 3: Records and verification

**Files:** `src/features/post-category/useRecordsBrowser.ts`, `src/pages/records/RecordsPage.tsx`, relevant new tests.

- [x] Add a failing regression for selecting a parent with deeper descendant records and for promoted source-bearing roots.
- [x] Use the adapter's source sets for names, filtering, and counts across all three record views.
- [x] Run `npm run check`, `npm run build`, and compare pre-existing failures with `/private/tmp/categories-baseline.log`.
- [x] Verify the exact real route in connected Chrome; inspect pointer dragging, inline edits, deletion, save, and screenshot parity against the approved mockup.
- [x] Review the focused diff, commit only this task's changes, and report evidence and any baseline failures.

## Execution record

- User approved immediate implementation; no further design approval is pending.
- Work in the current checkout to update the user's active local app and preserve unrelated work.

- RED/GREEN observed for tree helpers, pointer projection, manager interactions, records descendants, legacy name collisions, and saved-deletion undo.
- Independent read-only review found two P2 issues (legacy duplicate names and saving restored assignments). Both were reproduced, fixed, and re-reviewed with approval.
- Confirmed/staged drafts survive category-route round trips. Unconfirmed inline text follows the approved mockup and is not retained across route changes.
- Final targeted check: `node --test tests/category-catalog.test.mjs tests/category-hierarchy.test.mjs tests/category-manager.test.mjs tests/category-records.test.mjs` — 23/23 passed.
- `npx tsc -b` and `npm run build` passed. The build retains its existing large-chunk warning.
- `npm run check` — 126 tests, 114 passed, 12 failed. All 12 names also fail in the pre-change baseline; no new failure names. Unrelated concurrent edits increased the total test count.
- Chrome tab 1490580392 at `http://127.0.0.1:5173/#/categories`: verified root add, inline rename, pointer nesting under CS, save, reload persistence, delete dialog, undo, and removal of the temporary verification category. Original categories and post assignments were retained.
- Visual review confirms approved manager styling and controls. Existing app header/footer and real stored category data remain; the mockup's example hierarchy is not imposed on user data.
- Capture: full-page Chrome tab screenshot, JPEG 1728×1543, stable across two consecutive captures. The connector emits JPEG, so these are visual review artifacts and do not establish lossless pixel equivalence. Reference screenshot is `category-mockup/v2/simplified.png`; final artifact is `category-implementation.jpg` alongside the mockup folder.
