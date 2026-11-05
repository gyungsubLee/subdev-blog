# Public-data E2E verification

The project now has a repeatable HTTP E2E target and a disposable server for connected-Chrome verification. Local workflow checks passed; this is not a completed production/GitHub E2E run.

## Measured result

The tested source was content commit `9f99941c6b650c70f363208cd97c7191ef785a46`, containing 3,032 posts. Both implementations used the same built frontend, source objects, browser and asset adapter. Each navigation sample started with an empty handler cache. Navigation readiness means visible content committed followed by two animation frames; image completion is recorded separately.

| Metric | Before | After | Samples |
| --- | ---: | ---: | --- |
| First home ready, median | 2,523 ms | 798 ms | 3 each |
| Home images complete, median | 2,539 ms | 817 ms | 3 each |
| Index HTTP handler, median | 2,259 ms | 289 ms | 3 each |
| Selected post ready | 130 ms | 72 ms | 1 each |

Home readiness improved 68.36% in this local environment. It includes browser JS/DOM/paint and actual local HTTP transfer. External GitHub and OAuth are replaced by a disposable protocol fixture. The final test-only adapter maps raw asset URLs to exact local Git blob bytes on both implementations; its mapping/compression overhead is included equally. No production latency claim follows from these numbers.

The initial browser run also exercised BlockNote publication against the full corpus: create 14.756 s, title-only update 14.441 s, delete 15.123 s. These are individual local HTTP observations, including full generation and fixture Git writes. They exclude real GitHub network/upload costs. Earlier live generation needed about 117 s before upload, so writes have become more expensive; this has not been hidden as a read improvement.

Final normalized public index bytes matched. Browser image events reported positive natural dimensions and zero completed-image failures. The final run had no observed page errors or unhandled rejections. Representative image delivery is also checked byte-for-byte by HTTP tests.

## Exercised flows

- Anonymous home and post, three before/after cold navigations, post-body rendering and image decoding.
- Test-owner authentication through the real session/auth handler, and logout removing management controls. External OAuth UI is not exercised.
- Real BlockNote UI creation, publication, public list/body refresh, metadata-only update preserving body, delete confirmation and in-flight disabling.
- Search: virtual-memory query returned five records. More expanded 12 to 24 records. React category filtering showed 152 records and persisted after a post roundtrip.
- HTTP authentication rejection and CSRF rejection; create/update/delete; exact-request retry; failure preserving a candidate/head; category save; direct source advance returning 503 until the same publication CLI used by the push workflow completed.
- Exact asset bytes, image MIME and exclusion of reserved editor source files.

The browser test post was removed through the actual delete UI. The count returned from 3,033 to 3,032 and local drafts to zero. The test owner logged out. No source post, source ref, workflow, credential, setting or deployment was written to remote GitHub.

## Commands and evidence

```sh
npm run build
npm run check:e2e
```

HTTP E2E: **3 passed, 0 failed**. Generator support regression: **8 passed**. Build passed with the existing large-chunk warning.

For an interactive Chrome run after building:

```sh
node --max-old-space-size=1024 tests/e2e/serve-public.mjs
```

The server prints exact ephemeral URLs and writes test controls under ignored `.tmp/public-data-e2e/`. It auto-closes after 15 minutes and saves its browser report on termination. Use the connected Chrome accessibility, screenshot and input APIs; no Playwright. The script executes the original reader snapshot from the prior investigation solely for before/after comparison.

Full regression command: `npm run check` — **522/524 passed**. The remaining failures are:

1. `tests/web/managed-block-editor.test.mjs:182`: assigned category expected `기록`, got `분류 없음`.
2. `tests/web/managed-block-editor.test.mjs:786`: cancelling the picker expected the original `notes` category.

Read-only review traced both to the concurrent editor load block near `ManagedPostEditor.tsx:358`: when `post:null`, it overwrites fetched `metadata.category_id` with `post?.categoryId`, which is undefined. This runs before publication or transport. That separate product change is preserved; these failures are not reported as passing or fixed.

The previous records-roundtrip failure was a test assumption: the category tree remounts collapsed while its filter persists. Chrome and source inspection confirmed this. The test now expands the parent before both original selected-leaf assertions. Search, selection, route and visible-count assertions remain intact. See red/green logs.

Raw data and bindings: [verification.json](verification.json), [final browser report](browser-report-v2.json), [initial CRUD browser report](browser-report-v1.json), [HTTP E2E log](http-e2e.log), [full regression log](full-check.log). The first browser report used no image adapter; its broken image was a fixture limitation, corrected in the final report. Do not use it as image-success evidence.

## Remaining real-runtime gate

The normal application at `http://127.0.0.1:5173/api/public?kind=index` currently returns **503** with `Public content is not ready for this commit`. The final direct observation is in [normal-runtime-health.json](normal-runtime-health.json). This is an actual activation failure, separate from successful fixture results.

The approved implementation scope excluded remote publication/deployment. Real GitHub E2E requires publishing the generated files for canonical HEAD, installing/pinning the content push workflow, and then testing the normal application. See [activation procedure](../2026-11-04-precomputed-public-content/activation.md). No browser fallback, stale result, relaxed validation or changed performance threshold was introduced to hide this missing bootstrap.
