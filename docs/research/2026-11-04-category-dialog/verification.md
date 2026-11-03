# Shared category selection dialog

The user replaced the five-mock request with implementation using the existing illustrated dialog. Extracted CategorySelectionDialog and its scoped styles from ManagedPostEditor. Both the editor and ContentWorkspace use it. Width is min(540px, viewport minus64px), increased from360px, with automatic centered margins. Existing tree rows, selection, indentation, folding, counts and cancel/confirm styling remain. The workspace category trigger is left and search is right. Existing15-row pagination, source validation, local recovery and publishing are retained.

## Verification

-33 tests passed:10 workspace tests and23 managed editor tests. Tests cover selection/cancel, descendant filters, unknown legacy categories, pagination and editor recovery/publishing.
-TypeScript and Vite build passed; Vite54.36s. Existing large-chunk warning remains.
-Independent source review found a count/filter mismatch for unknown legacy categories. Both now use the same source-to-category normalization, and the regression is covered.
-StrictMode regression test failed before the lifecycle fix and passed afterward. Native dialogs now close before parent unmount on explicit actions, restoring trigger focus. The effect does not close the dialog during StrictMode effect replay; native DOM removal handles top-layer cleanup.
-Chrome extension tab1490589752 opened a loopback-only fixture using the actual ContentWorkspace and actual shared dialog, with the public3032-post index and current categories. No authentication checks were disabled and no live content was written. Verified Docker selection yields64 posts and page1/5, tree folding, and Escape returns focus to the category trigger.
-Desktop1728x936 and mobile390x844 captures show centered dialogs. The mobile dialog stays inside32px side margins. Width540px is the CSS contract; screenshots are visual evidence, not exact DOM geometry measurements.
-Closed dialogs are unmounted rather than rendering hidden category trees during editor changes. Counts and source mappings are memoized; page navigation still renders at most15 rows and adds no data requests. No hardware performance-equivalence claim is made.

Screenshots: desktop-toolbar.jpg, desktop-modal.jpg, desktop-modal-collapsed.jpg and mobile-modal.jpg. These are screenshots from the connected Chrome tab API, saved without image edits. The fixture matched the real app's React StrictMode setting. Production login/editor end-to-end visual comparison was not part of this fixture. Browser viewport override was reset; the task tab and verification server were closed and fixture source files removed. No commit, push or deployment. External approved mock and concurrent header/page-explorer work were preserved.

## Follow-up — double-click confirmation

The shared dialog now confirms the double-clicked row ID directly and closes before calling onConfirm, using the same confirmSelection path as form submission. Parent, child, item count/grip and empty-option rows work; expansion buttons are excluded. Both current consumers (workspace filter and managed editor) require no caller changes. Single-click staging, cancel/Escape and manual submit remain.

35 workspace/editor tests and TypeScript passed. New regression tests failed before implementation and passed afterward, covering a different pending selection, child/parent/empty confirmation, expansion exclusion and editor recovery without publishing. The first full run exposed an existing async import assertion that checked before crypto validation completed; its assertions now use the same finite wait as the neighboring attachment-import tests, preserving the validation and recovery checks. No product import behavior changed. Logs retain both failed and passing runs. CSS, runtime serialization, timers and request paths were not changed; no performance-equivalence claim or new build/browser run is included in this follow-up.
