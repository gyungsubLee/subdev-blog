# POST-IMAGE-VERIFY-01 verification attempt

Status: incomplete. Live HTTP checks passed; browser rendering is unverified. Conditional deletion was not performed.

## Source and execution

- Date: 2026-11-04.
- Root: `/Users/igyeongseob/Develop/10_harness/subdev-blog`.
- HEAD: `e48347948b322a80bcef5a8ecaff090f8022e8d8`.
- Served candidate: `.tmp/structure-commit/snapshot/dist/web`, using the snapshot's existing Vite preview/API configuration.
- Command: `npm run preview -- --port 5186 --strictPort`, run in the snapshot directory. Task-owned server was stopped after checks.
- Only HTTP GET requests were issued. No publish, save, delete, authentication or content mutation requests were issued.
- Existing unrelated dirty files were left untouched. No build or full test suite was repeated.
- Local content HEAD: `9f99941c6b650c70f363208cd97c7191ef785a46`; `git -C content status --short` was empty before verification.

## Live HTTP evidence

Requests used `curl --max-time 60 --compressed -sS` for JSON and finite 45-second deadlines for raw images. These were live GitHub-backed responses, without fixtures or mock responses.

| Request | Result |
| --- | --- |
| `http://127.0.0.1:5186/` | HTTP 200; HTML shell only, not rendering evidence |
| `http://127.0.0.1:5186/api/public?kind=index` | HTTP 200; 3,033 posts; content commit `723231cd3cedd4702d2d77ced9190e63387e852d` |
| `http://127.0.0.1:5186/api/public?kind=post&id=1c3eda9b-0fe1-81e6-aba5-f1bd19c1ca22&commit=723231cd3cedd4702d2d77ced9190e63387e852d` | HTTP 200; full Markdown for `5. 연속된 자연수의 합(수학)` |
| `http://127.0.0.1:5186/api/public?kind=post&id=22beda9b-0fe1-8090-8ddd-d81c73a5ba0b&commit=723231cd3cedd4702d2d77ced9190e63387e852d` | HTTP 200; full Markdown for `AOP 패턴 & Interceptors` |

The first post's image URL:

`https://raw.githubusercontent.com/gyungsubLee/subdev-blog-content/723231cd3cedd4702d2d77ced9190e63387e852d/posts/1c3eda9b-0fe1-81e6-aba5-f1bd19c1ca22/cc8c940fd60e5c4b.webp`

Result: HTTP 200, `image/webp`, 21,342 bytes. RIFF/WEBP signature passed. Response bytes matched the corresponding original in `content/posts` exactly. SHA-256: `f7449c87c2d6cae9960b82e18764c51594ba0f8641eb3d22bcd571e8c4567255`.

The second post's first image URL:

`https://raw.githubusercontent.com/gyungsubLee/subdev-blog-content/723231cd3cedd4702d2d77ced9190e63387e852d/posts/22beda9b-0fe1-8090-8ddd-d81c73a5ba0b/01de73d0ad028f36.webp`

Result: HTTP 200, `image/webp`, 25,364 bytes.

Both sampled Markdown responses used raw image URLs pinned to the index's content commit. The detail response does not expose a separate `contentCommit` field; the request's commit and returned image URLs were compared. The remote public head differs from the local submodule HEAD; neither source was changed to reconcile the difference.

## Browser blocker and unverified scope

Chrome discovery through `cua.getState()` returned an empty browser inventory and `Browsers: Error: native pipe closed before response`. The app inventory separately showed Google Chrome running.

A dedicated Chrome task tab was then requested through `cua.createBrowserTab("chrome", "http://127.0.0.1:5186", {sessionName:"🖼 글 이미지 검증"})`. It failed with `native pipe closed before response`; no tab ID or URL binding was returned. This confirms a tab connection failure independently of native screenshot support. No unrelated browser windows were operated on. No Playwright fallback was used.

Actual page/image display, screenshot evidence, browser network requests, HTML-image rendering and absence of runtime `/notion/assets` dependencies remain unverified. HTTP success is insufficient to authorize deletion under the handoff's conditions.

## Cleanup outcome

Deleted directories: 0. Deleted files: 0. Deleted bytes: 0.

All six allowed recovery directories and optional `dist/content/assets` remain present. Counts and byte totals are recorded in [retained-copy inventory](post-image-retained-copies.json). The existing-server dependency of `dist/content/assets` remains unverified, and that directory must also be retained.

Resume condition: restore the Chrome tab connection, restart this dedicated snapshot preview, bind the exact task tab and verify real post/image display. Only after that succeeds may the handoff's allowed recovery copies be deleted and original content checked again.

Other environment limits: project-context readiness check failed because the existing `.project-context/INDEX.md` exceeds its size limit; it was not pruned. The mandated `/Users/igyeongseob/.agents/skills/ste-ko/SKILL.md` was absent. No application source, UI, performance path or content original was changed by this attempt.
