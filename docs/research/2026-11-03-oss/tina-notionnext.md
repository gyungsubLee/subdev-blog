# TinaCMS and NotionNext source research

Research date: 2026-11-03. Scope: serialization/schema/media boundaries, public reads and cache guarantees, and Notion archival versus live delivery. This is a source-based transplant proposal, not implementation or a runtime benchmark. Product files, UI, dependencies, and performance protections were not changed. This worker ran no upstream scripts, dependency installs, tests, or builds. Parent owns execution of overlapping checks and supplied the bounded probe evidence identified below.

## Reproducible sources

| Repository | Origin | Exact inspected HEAD | Clone | Root license |
| --- | --- | --- | --- | --- |
| TinaCMS | https://github.com/tinacms/tinacms | `d38621b06002ef53e9cd1344793a7657894e6a37` | `/private/tmp/subdev-reference-20261103/tinacms` | [Apache-2.0](https://github.com/tinacms/tinacms/blob/d38621b06002ef53e9cd1344793a7657894e6a37/LICENSE#L1) |
| NotionNext | https://github.com/notionnext-org/NotionNext | `a2aa934b41c51ea95b74cbb67430e38392be01cd` | `/private/tmp/subdev-reference-20261103/notionnext` | [MIT, copyright 2021-present tangly1024](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/LICENSE#L1) |

Both are shallow clones. Sandbox DNS initially failed; an escalated, user-authorized read-only clone succeeded. Each git command used a finite Python subprocess timeout. HEAD and origin were read locally after clone completion. Root license identification is source evidence, not a claim that every embedded asset or dependency has that license. Prefer independently written adaptations of patterns; preserve applicable notices if source or fixtures are copied.

## Current target contracts to preserve

The target is already a Git-backed publishing system, rather than a live Notion viewer. `README.md:40` describes the old archive; `README.md:69` describes paired Markdown/editor JSON; `README.md:123` describes public content reads. The block storage specification is `docs/superpowers/specs/2026-10-25-block-editor-storage-design.md`.

- `src/shared/editor-document.mjs:131` validates schema version 1, document UUID, exact-body SHA-256 pairing, supported block structures, bounded JSON depth/node count, and unsafe keys; it returns the original value. Unknown JSON properties survive (`tests/editor-document.test.mjs:63`). This is intentional forward-property preservation, not proof that every unknown property has editor semantics.
- `src/shared/document.mjs:302` serializes YAML using the installed `yaml` package; `:353` merges allowed patch fields onto canonical metadata and rejects stale revisions. YAML key order or whitespace is not the preservation contract. Legacy Markdown body bytes are preserved until explicit conversion (`tests/managed-block-editor.test.mjs:174`).
- `src/features/post-editor/document-markdown.ts:111` is the existing BlockNote serialization boundary. It keeps ordinary Markdown and uses constrained HTML for blocks/settings Markdown cannot express. `ManagedPostEditor.tsx:513` resolves previews without rewriting stored sibling URLs.
- `server/public-content.mjs:13` defines a 30-second head TTL; `:74` partitions bounded caches by fetcher, branch, and hashed token. `:100` coalesces head requests; `:164` coalesces snapshot reads. `:120` verifies fetched Git blob bytes and bounds each file; `:217` bounds raw-read concurrency at eight. Catalog blob hashes avoid rereading unchanged Markdown (`:203`); details are fetched only when selected (`:315`). Limits include 32 MiB blob text, three snapshots/128 MiB, aggregate source bytes, finite raw fetch deadlines, and bounded gzip responses. Keep commit ancestry verification, commit-pinned asset URLs, visible upstream failures, and editor-source exclusion.
- `scripts/export-notion.mjs:707` guards the legacy writer before side effects. `scripts/content.mjs:650` deliberately blocks it in canonical/submodule checkouts. The archive retains raw records, provenance, media, failures, and prior Markdown versions; reconnecting ingestion to canonical content is explicitly deferred by the README.

## Six transplant decisions

### 1. Adapt a compatibility corpus across the actual serialization boundary

TinaCMS has paired parse-tree and serialized-output fixtures: [malformed-tag test, lines 1-14](https://github.com/tinacms/tinacms/blob/d38621b06002ef53e9cd1344793a7657894e6a37/packages/%40tinacms/mdx/src/parse/tests/mdx-malformed-tag/index.test.ts#L1). Its [line-ending cases](https://github.com/tinacms/tinacms/blob/d38621b06002ef53e9cd1344793a7657894e6a37/packages/%40tinacms/mdx/src/line-endings.test.ts#L29) test CRLF/LF semantic equivalence. These establish useful test design, not compatibility between Tina's Plate/MDX and this app's BlockNote.

**Already exists:** focused editor preservation, malformed JSON, Markdown byte preservation, and managed-editor tests. **Candidate gap:** an explicit compact corpus covering repeated save/reopen plus public rendering across the complete supported block matrix. No missing behavior is established merely by absence of a corpus folder.

**Adapt:** extend existing `tests/editor-document.test.mjs` and `tests/managed-block-editor.test.mjs`, using `src/features/post-editor/document-markdown.ts` and the installed editor. Cover nested toggles/notebooks, mixed list boundaries, tables, captions/wrap, palette formatting, escaped punctuation, Korean text, and relative media. Distinguish exact JSON property retention, semantic rendered output, and exact legacy body bytes; do not demand that lossy Markdown reconstruct all BlockNote state. JSON remains the editor source.

**Bounded check:** selected primitive properties after save → persisted JSON → reload → second save; compare serialized strings only where the contract requires identity. Existing DOM test setup must unmount and close on success/failure and retain finite deadlines. Do not snapshot live editor/DOM objects. **Risk:** normalizing a snapshot can conceal meaningful properties; retain intentionally unknown props and IDs where relevant. Do not change runtime converters unless a focused failing case establishes a real defect.

### 2. Keep fail-closed source recovery; reject automatic repair as the save policy

Tina's [parser lines 201-225](https://github.com/tinacms/tinacms/blob/d38621b06002ef53e9cd1344793a7657894e6a37/packages/%40tinacms/mdx/src/parse/index.ts#L201) stores original source in an `invalid_markdown` node; its [serializer lines 49-56](https://github.com/tinacms/tinacms/blob/d38621b06002ef53e9cd1344793a7657894e6a37/packages/%40tinacms/mdx/src/stringify/index.ts#L49) returns that source. This is a useful preservation invariant.

**Already exists / adopt as evidence only:** target malformed JSON/hash/version errors block fallback saves and offer original exports (`tests/managed-block-editor.test.mjs:316`); source read and write both call `validateEditorDocument` (`server/content.mjs:145`, `:552`), and CLI content validation calls it too (`scripts/content.mjs:164`). No new recovery abstraction or format migration is justified.

**Check if this boundary changes later:** exact original JSON/Markdown export strings, no save request, and local recovery not replaced by damaged remote source. Preserve current error UI. **Risk:** importing Tina's invalid-node approach literally would introduce unsupported BlockNote types and could let corrupt paired data appear valid. Reject that literal transplant.

### 3. Adapt media read/write/read invariants, preserving the current storage model

Tina's [media roundtrip test, lines 102 onward](https://github.com/tinacms/tinacms/blob/d38621b06002ef53e9cd1344793a7657894e6a37/packages/%40tinacms/graphql/src/resolver/media-rich-text.test.ts#L102) exercises real resolver callbacks, local media staging, external URLs, serialized output, and reparsing. Its [resolver lines 91 onward](https://github.com/tinacms/tinacms/blob/d38621b06002ef53e9cd1344793a7657894e6a37/packages/%40tinacms/graphql/src/resolver/media-utils.ts#L91) distinguishes external URLs from library paths.

**Already exists:** stable relative uploads, bare sibling names, and commit-pinned previews (`tests/managed-block-editor.test.mjs:219`, `:238`, `:273`). **Adapt candidate:** extend these existing tests with encoded Unicode/spaces/parentheses, external HTTPS URLs, and two save/reopen cycles, using actual target serializer and resolver. Verify both JSON and Markdown keep stable sibling paths and preserve attachment SHA. Keep URL sanitization separate from path translation: accepting an external URL for identity is not permission to render an unsafe scheme.

**Target:** `ManagedPostEditor.tsx:445`, `:513`, `document-markdown.ts:111`, existing managed tests; no cloud-media dependency. **Bounded check:** primitive stored URL/attachment SHA assertions and pinned preview URL assertions. **Risk:** copying Tina's cloud staging/self-healing rewrites would change valid authored paths. Reject those mechanics; adopt only the contract test pattern.

### 4. Adapt per-blob in-flight coalescing: measured priority; preserve resource limits

NotionNext [getNotionAPI.js:59-79](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/lib/db/notion/getNotionAPI.js#L59) shares a promise per operation/arguments and clears it after settlement. [cache_manager.js:72 onward](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/lib/cache/cache_manager.js#L72) similarly keys in-flight work by generation and removes settled work.

**Already exists:** target head and snapshot coalescing, bounded caches, catalog deltas, eight-worker snapshot fetch, request deadlines, and explicit errors. **Measured gap:** `server/public-content.mjs:120` checks only completed `cache.blobs`; concurrent detail reads for the same not-yet-cached catalog blob each start a raw fetch. Snapshot coalescing does not cover the later detail-body fetch at `:316`. Parent executed `probe-concurrent-detail.mjs` and recorded `probe-concurrent-detail-result.json` beside this report: eight simultaneous cold requests returned eight HTTP 200 responses and caused eight raw body downloads; one subsequent warm request added zero downloads. The recorded source SHA-256 is `c49d619dee540bc9d67b31eebe648536ffc024c7d123fa97e6a1a22bec08f17c`, Node `v24.3.0`. The first attempt failed because the mock commit omitted `sha`; parent corrected that fixture only and retained `probe-concurrent-detail-attempt1.json`. This demonstrates redundant network work under the injected-fetcher scenario, not measured production latency or a data-integrity failure.

**Adapt as the first focused runtime transplant:** one per-cache map of pending blob SHA promises at `readFile`, reuse it for every caller, and remove entries on success/failure. Keep blob verification, file/aggregate byte caps, LRU-like existing eviction behavior, token/cache separation, and `AbortSignal.timeout(15000)` intact. Do not add retries, Redis, disk stores, stale responses, or process exit listeners.

**Bounded check / performance comparison:** injected fetcher plus a gate; concurrently request the same pinned detail from an already-warm catalog snapshot and assert raw fetch count is one, body strings match, and rejection permits a fresh retry. Add a different-blob case so unrelated work remains concurrent. Use the same mocked inputs before/after; record raw request counts. Existing `tests/public-content.test.mjs:200`, `:213`, `:237`, `:352` are preservation checks, not evidence they were run here. Global cold-start rate/resource limits remain outside this narrow optimization.

### 5. Defer additional Notion normalization until ingestion is explicitly reopened

NotionNext [getPostBlocks.js:356 onward](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/lib/db/notion/getPostBlocks.js#L356) clones and normalizes incoming blocks, handles nested envelopes, CRDT fields, callouts, sync blocks, and newer types. This is compatibility evidence against a moving unofficial API, not a mandate to import its complete renderer.

**Already exists:** target `scripts/export-notion.mjs:36`, `:79` unwrap nested records and omit CRDT data; the archive renderer has callout and other block cases plus offline tests (`tests/notion-markdown.test.mjs:136`). **Defer candidate differences:** newer callout rich-text/icon representations and sync block variants could need fixtures if a future actual archived record contains them. No current archive failure was established.

**Future target:** `scripts/export-notion.mjs` normalization/rendering and `tests/notion-markdown.test.mjs`. Keep original records untouched and derive normalized render inputs. Use small offline record fixtures to assert source IDs, text, children, links, and failed/unsupported-item reporting. **Risk:** destructive normalization can discard original IDs, tree references, or evidence. Do not copy live render mutation/deletion logic wholesale and do not bypass `assertLegacyContentWritable` to test on canonical content.

### 6. Reject replacing archival media and GitHub reads with live Notion/signed URLs

NotionNext [getNotionAPI.js:25-31](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/lib/db/notion/getNotionAPI.js#L25) configures live Notion access. [getPostBlocks.js:69-85](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/lib/db/notion/getPostBlocks.js#L69) fetches cached live page blocks, and [lines 90-156](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/lib/db/notion/getPostBlocks.js#L90) detects and refreshes expiring media URLs. Its [cache manager:236 onward](https://github.com/notionnext-org/NotionNext/blob/a2aa934b41c51ea95b74cbb67430e38392be01cd/lib/cache/cache_manager.js#L236) selects Redis/file/memory stores. These solve a different availability/freshness problem.

**Already exists:** target archive downloads assets with validation and SSRF safeguards (`export-notion.mjs:493`, `:539`, `:569`), records download failures and raw records (`:752-764`), and preserves prior changed Markdown through hash history plus atomic replacement (`:631-650`). Public delivery uses immutable Git commit URLs, not expiring Notion asset links.

**Reject for current transplant:** a live Notion public backend, signed-URL refresh at read time, generic multi-store cache, theme/app replacement, and an archive reimport scheduler. These would add external read dependencies, freshness policies, failure fallbacks, runtime cost, and potentially UI changes while weakening reproducibility. Keep the archival/live boundary and legacy-write guard. **Check if ingestion is later authorized:** isolated backup/output directory, failed asset manifest, no private-network fetch, original bytes preserved on download/conversion failure, and canonical/submodule write refusal. Existing runtime GitHub tests remain the delivery baseline.

## Recommended integration order

1. Add only demonstrably missing cases to the existing serialization/media test suites; keep runtime and UI unchanged.
2. Use the parent-owned duplicate-fetch probe as the before baseline. Apply one shared `readFile` coalescing fix and preserve all current limits and error behavior; the same eight-request input should then cause one raw body download.
3. Leave Notion importer rewiring, cloud media, distributed cache, and framework replacement deferred. None is necessary for the two focused candidates.

Parent supplied a reproducible redundant-fetch baseline for concurrent cold details; this worker did not repeat that check. Other items are source-grounded preservation evidence or candidate test coverage, with no additional target functional defect claimed. Production latency, cold-start behavior, and real upstream failure rates were not measured. No remaining source-access blocker.
