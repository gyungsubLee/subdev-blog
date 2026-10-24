# Category Sidebar Consistency Implementation Plan

> **For agentic workers:** Use executing-plans for the focused implementation and an independent reviewer before completion. Track steps below.

**Goal:** Show each managed category once, preserve its hierarchy, and remove synthetic per-category “전체” controls.

**Architecture:** Keep the existing category projection and filtering contract. Omit a source-bearing root from child navigation because its parent row already represents it. Make root names selectable while retaining native disclosure controls.

**Tech Stack:** React, TypeScript, CSS, Node test runner, jsdom.

**Spec:** User request and attached category-manager/sidebar screenshots in this chat.

## Global Constraints

- Preserve category storage, source ownership, and saved parent relationships.
- Reuse existing filtering and relative-depth indentation; add no dependencies.
- Keep the global all-records control. Preserve concurrent work that removes alternate views.
- Leave changes available for review in the current workspace; no commit or publication is requested.

## Review Focus

- Source-bearing roots must remain selectable without duplicate child entries.
- Children from depth1 through depth5 must retain increasing indentation.
- Leaf roots must not expose an empty disclosure control.
- Root selection and disclosure must work independently in Chrome.
- Selecting a parent must include its own records and all descendant records once.

### Task 1: Align category navigation with the managed hierarchy

**Files:**
- Modify: `src/pages/records/RecordsPage.tsx`
- Modify: `src/pages/records/RecordsPage.css`
- Test: `tests/records-page.test.mjs`

**Interfaces:** Consume `CategoryGroup`, `categoryMatches()`, `selectGroup()`, and `selectCategory()` unchanged. Produce selectable root rows and child navigation without synthetic entries.

- [x] Add a regression using the real category projection, a source-bearing root, five child depths, and a leaf root.
- [x] Run the regression with `node --test --test-name-pattern='managed hierarchy' tests/records-page.test.mjs`; confirm failure on synthetic controls and success after correction.
- [x] Exclude each root ID from its child buttons, remove synthetic sidebar controls, and make root labels selectable.
- [x] Reuse the existing child indentation; style root buttons and native disclosures without empty leaf disclosures.
- [ ] Final `npm run check`, `npm run check:content`, and `npm run build`: owned by the merge coordinator chat `01a16baf-a8c2-7880-b33e-12eb78742419`; do not duplicate that run.
- [x] Inspect completed sidebar-owner verification: six records tests pass; the previous entire suite reports 296/301 with five separate management failures. A later build succeeds. See `.tmp/category-sidebar-verification.md` for exact evidence and limits.
- [x] Verify root selection, disclosure, keyboard expansion, and leaf-root selection in Chrome against the actual app; verify five-level indentation and deepest-child selection using the actual component with controlled sample data.
- [x] Review the focused diff independently: no actionable findings.
