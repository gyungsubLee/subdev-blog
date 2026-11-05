# Mono Press / Swiss Ink DS Implementation Plan

> **For agentic workers:** Use executing-plans in this session. The user approved the visual mock and explicitly requested implementation. Preserve concurrent structure migration and product changes. No automatic commit.

**Goal:** Apply the approved theme throughout the existing website and editor without changing layout, copy, data or behavior.
**Architecture:** Update existing shared CSS tokens and their component consumers. Replace local cream palettes with the same white/black/red roles; retain authored rich-text colors and highlighting. No theme runtime, dependencies or new rendering layers.
**Tech Stack:** React, TypeScript, Vite, CSS.
**Spec:** Approved mock: /Users/igyeongseob/.codex/visualizations/2026/11/04/01a1a433-3850-7e50-a2bc-0cbd59714c48/ds-themes/mono-swiss/preview.html?theme=9. User approval in this chat.

## Global Constraints

- White #ffffff, ink/strong lines #161616, muted #626262, accent #b82927, soft surface #f1f1ee.
- Sans headings at weight800; square corners; 2px major outlines and 4px 4px black hard shadows on cards/panels.
- Keep current dimensions, media queries, text, icons, content assets, navigation and all management behavior.
- Preserve lazy editor loading, lazy images, memoization, preview coalescing, syntax loader and cleanup.
- Existing whole-suite verification belongs to the structure migration chat. This task owns only theme checks, CSS compilation and browser theme review; do not duplicate the suite.
- Modify app/web/src styles only, plus this plan, a focused theme check and evidence. Do not restore moved files or interfere with migration.

## Review Focus

- Reader and editor use the same neutral surfaces; authored color attributes remain unchanged.
- Dialogs, selected tree rows and focus states stay visibly distinct and keyboard operable.
- Mobile layouts keep existing wrapping and scrolling, including long titles.
- Large lists receive no new filters, blur, animations, selectors that enumerate runtime nodes or JavaScript.
- Home, records, categories, workspace, article and editor all consume the common palette.

### Task1: Shared theme and consumers

**Files:** app/web/src/styles/*.css, app/web/src/components/**/*.css, app/web/src/pages/**/*.css, app/web/src/features/**/*.css.
**Interfaces:** Existing --paper, --ink, --muted, --accent, --line, --display remain; add surface/shape/shadow roles consumed in CSS only.
- [x] Save current CSS and non-CSS source hashes as a local ownership/performance baseline.
- [x] Update shared tokens and all component surface, shape and heading consumers in place.
- [x] Keep authored color tables and handwritten notebook typography as content formatting.
- [x] Audit changes against baseline for layout and runtime preservation.

### Task2: Verification and delivery

**Files:** .tmp/ds-mono-swiss/check.mjs, .tmp/ds-mono-swiss/*.
**Interfaces:** Theme check validates resolved token use and protected content styles, with bounded primitive diagnostics.
- [x] Run focused theme checks with finite external command deadline.
- [x] Compile CSS through Vite in a dedicated output folder; do not empty another chat's dist.
- [x] Compare approved mock and implementation in connected Chrome at the same viewport; inspect home, records, reader, editor and management fixture when available.
- [x] Check desktop/mobile, keyboard focus and lazy feature styles; record unverified limitations explicitly.
- [x] Review task-owned changes and record evidence; no commit or deployment.

## Verification (2026-11-04 KST)

- Owner: this chat; inline implementation and one read-only independent review.
- `node .tmp/ds-mono-swiss/check.mjs`: passed. CSS parsed, layout/motion declarations unchanged, authored rich-text color table unchanged. Palette contrast5.39–18.10:1 across checked text/surface combinations.
- Dedicated `vite build --outDir .tmp/ds-mono-swiss/build`: exit0,13.17s. Existing chunk-size warning remains. No TypeScript changes or repeated whole-suite run.
- Chrome: actual authenticated home, records, article, content workspace, category manager, category picker/Escape focus return, new editor and slash menu inspected. Home/reference both1280x900; mobile home390x844 and long-card scroll inspected. Screenshot evidence: `.tmp/ds-mono-swiss/*.png`.
- Independent review found a portaled BlockNote root omission. Changed the bridge to `.bn-root[data-color-scheme]`; checked installed source and actual slash menu.
- Added no runtime JavaScript or dependencies. Same CSS input set: gzip12534→12132 bytes. Device frame-time equivalence was not measured; do not claim measured performance preservation.
- Concurrent non-CSS changes/removals in audit.json belong to other work; preserved. No product copy/layout/data changes by this task.
- No CSS formatter or lint command is configured; PostCSS parsing and whitespace audit passed.
- Editor inspection generated one empty local test draft, titled `제목 없음`. User explicitly confirmed cleanup. Deleted that single local test draft through the native confirmation dialog; Chrome shows drafts0 and published3033. No existing article was changed or deleted.
- Project context helper reports the existing INDEX is oversized. Identity is valid; did not rewrite the existing index or initialize another context.
- No commit, push, native rebuild or deployment. Local review server: http://127.0.0.1:5280/.
