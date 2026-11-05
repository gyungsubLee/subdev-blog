# Theme Color Settings Implementation Plan

> **For agentic workers:** Execute inline. The user requested the settings feature, approved the existing DS, and chose support for both palette and accent changes. Preserve concurrent work; no automatic commit or deployment.

**Goal:** Add one shared settings trigger with a left gear icon, a native modal, palette selection and independent accent selection persisted in this browser.
**Architecture:** Reuse a SettingsButton component in SiteHeader and ManagedEditorToolbar. Read and validate one localStorage preference at startup, apply whitelisted CSS tokens to the document root, and update them only on explicit setting changes. Mount the dialog only while open. No provider, tree-wide subscription, backend call, dependency or editor reload.
**Tech Stack:** React, TypeScript, existing CSS tokens, native dialog/select/radio inputs, localStorage.
**Spec:** User request in this chat: shared settings button and modal, color settings only; user chose both accent-only and entire palette changes. Existing approved Mono Press / Swiss Ink geometry remains.

## Global Constraints

- Preserve all existing buttons, navigation, editor/export/category actions and content formatting.
- Keep current default palette, fonts, shapes and layout; only add the requested button and responsive modal.
- Include10 previously reviewed color palettes and6 accents with readable light/dark variants. Selecting palette does not erase a separate accent choice; choose palette default to clear the override.
- Apply changes immediately and persist locally. Closing/Escape retains the current selection. Reset restores the approved Swiss palette and its red accent.
- Validate stored enum values; ignore malformed/unknown stored data. Storage denial must not prevent in-session use; indicate when persistence fails.
- Native dialog handles modal focus; close before unmount and restore trigger focus. Use one unique dialog ID per trigger.
- No network or continuous document work for settings. Preserve editor memoization, lazy loading, coalescing and existing performance protections.

## Review Focus

- Stored unknown IDs and blocked localStorage never apply arbitrary CSS or prevent startup.
- Palette and accent remain independently selected across reopening/reloading and entering the editor.
- Dark palettes use legible foregrounds on primary buttons, authored colors stay untouched.
- Small screens show all existing header actions and an internally scrolling modal.
- Settings changes must not trigger a content request or remount the editor.

### Task1: Preferences and native modal

**Files:** app/web/src/features/theme-settings/theme.ts, SettingsButton.tsx, theme-settings.css; tests/web/theme-settings.test.mjs.
**Interfaces:** initializeTheme() restores persisted tokens. SettingsButton owns its native dialog and only local UI state. Theme tokens use the existing CSS role names; shape/font tokens never change.
- [x] Add focused tests for defaults, validation, both color modes, persistence failure, reset, native-dialog close/reopen and no content requests.
- [x] Observe expected failures before implementation.
- [x] Implement whitelisted preferences, CSS token application and the reusable trigger/modal.
- [x] Run focused tests with a finite external deadline and guaranteed DOM/root cleanup.

### Task2: Integration and verification

**Files:** app/web/src/main.tsx, components/layout/SiteHeader.tsx, components/layout/layout.css, features/content-management/ManagedEditorChrome.tsx, managed-writing.css, features/post-editor/editor.css, features/post-category/CategoryManager.css, CategorySelectionDialog.css.
**Interfaces:** Same SettingsButton imported into both headers; startup initialization before React render. Primary-button foreground uses --on-accent for readable full-palette switching.
- [x] Connect shared trigger and initial preference application; adapt action wrapping only where the additional button requires it.
- [x] Run TypeScript and targeted settings/header/editor checks. Do not duplicate any concurrent whole-suite run.
- [x] Compile a dedicated Vite output and inspect Chrome desktop/mobile: icon-left trigger, modal focus, palette and accent, close/reopen/reload, and retained existing controls.
- [x] Review scoped diff and record evidence/limitations; preserve unrelated changes.

## Verification and rulings (2026-11-04 KST)

- Task owner: this chat. Scope: settings feature and its two shared header integrations; scoped source hashes in `.tmp/theme-settings/final-hashes.json`.
- Settings checks:4/4 passed in `settings-final.log`, including all70 palette/accent combinations, contrast>=4.5:1, independent persistence, invalid storage, native dialog close/reopen/reset and quota-denied persistence. Relevant diagnostics contain primitives only; roots unmounted and JSDOM windows closed in finally.
- TypeScript: exit0 (`types-final.log`). Dedicated Vite build: exit0,24.79s (`build-final.log`), existing chunk-size warning retained. CSS parsing and scoped whitespace audit passed; no formatter/lint command is configured.
- Broader targeted run:45 checks,43 passed and2 failed (`targeted.log`). Both failures are category child-row tests that assume nested rows exist while the picker initially collapses them. Restoring the pre-settings header sources in an isolated copied app reproduces both failures (`baseline-failures.log`). No test was skipped, weakened or changed to hide them. The failures are outside this feature's scope.
- Independent review found stale controls after a quota-denied write when old saved preferences remain. Reproduced in `quota-red.log`, fixed by separating active in-memory state from startup storage restoration, and covered in final passing settings test. Persistence failure remains visible on reopen until a write succeeds.
- Chrome: gear-left shared trigger in normal and editor headers; native dialog focus and Escape return; accent-only change; entire palette change preserving separate accent; reload restoration; reset;390x844 editor dialog and home header. Screenshots: `.tmp/theme-settings/*.png`.
- Browser CDP temporarily timed out after editor entry; a reload recovered the task tab. Subsequent editor inspection succeeded. This was a browser-control observation; no product hang cause was established.
- Existing article title/body remained intact during editor color changes. No publish/save/delete action was invoked. On exit, workspace showed drafts0 and published3033. Verification settings restored to Swiss/default red and viewport override reset.
- Performance check: color changes produced0 content requests and1 parent render across modal updates in the focused React check. No provider, global subscription, interval, new dependency or editor remount was introduced. Hardware frame times/startup timing were not measured.
- Dark code-surface ruling: installed Shiki uses github-light; preserve readable light syntax surfaces in dark palettes instead of changing the highlighter or loading another theme. Authored text colors and notebook typography remain.
- Full suite is not claimed passing. No commit, deployment or native rebuild performed.

## Approved follow-up: icon-only trigger

User requested removing the visible settings text and placing the shared site trigger after logout. Updated the shared trigger to keep aria-label/title `설정`, retain the SVG, and use a44px square hit target. Editor uses the same icon-only component at its existing location. Modal, color preferences and all other actions are unchanged. Settings checks5/5 passed (including header order and accessible icon-only control), TypeScript passed, and Chrome confirmed opening/Escape focus return. Evidence: `.tmp/theme-settings/icon-only-green.log`, `icon-only-types.log`, `icon-header.png`. No new runtime logic or performance-sensitive path.
