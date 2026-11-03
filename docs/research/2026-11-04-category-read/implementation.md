# Category read optimization

Task: CATEGORY-READ-OPTIMIZATION-01. Owner: this chat. Status: implementation and scoped verification complete, with one independently reproduced pre-existing frontend test failure.

## Authorized design and execution

The user authorized preserving authentication and saves while improving category reads and applying the earlier cache approach. This is a bounded change to the existing backend. Implementation followed the approved investigation direction, test-first checks, and an independent read-only code review. No frontend, UI, dependency, public content cache, or save operation implementation was changed. No commit or deployment was performed.

1. Reuse immutable Git objects and commit-addressed structural files, scoped by fetcher, token, and management configuration.
2. Keep identity, installation grants, repository permissions and current branch checks fresh on every request. Parallelize independent checks while preserving their validation gates.
3. For category reads, reuse the content commit just checked by readiness and load only the root Git tree. Preserve regular-file mode validation, 2 MiB size limit, exact category bytes and revision hashing. Writes and other content reads retain their recursive-tree lookup and uncached content client.
4. Verify cache reuse, isolation, eviction, in-flight deduplication, error recovery, permission revocation, commit changes and unchanged save behavior; compare before and after using identical inputs.

## Cache preservation

The existing public Markdown transform, snapshot, blob, serialized-response and gzip caches remain in place. Their tests passed in the full check.

The management cache uses the same bounded immutable-data and in-flight deduplication pattern. Mutable authorization and head data are never retained. It retains at most four configurations per fetcher, 32 entries and 8 MiB of UTF-16 JSON-accounted payload per configuration, with at most 32 retained pending reads. Oversized results are served without retention; failures are not retained. The cap accounts for payload size, not measured total JavaScript heap usage. HTTP responses remain `Cache-Control: no-store`.

The first request after a process restart still pays the immutable-read cost. A changed content commit triggers fresh root metadata lookup, while unchanged blob hashes remain reusable. There is no authorization TTL and no stale-head TTL.

## Evidence

- Test-first failure: `.tmp/category-content-red.log` records 4 repeated GitHub calls where 1 was required. `.tmp/category-cache-red.log` records duplicate immutable requests before caching.
- Targeted auth/content/cache/API checks: 76 passed (`.tmp/category-targeted-green.log`).
- Full-handler integration checks: 5 passed (`.tmp/category-integration-green.log`). Includes warm-cache denial after changed identity, repository permissions, or suspended installation; refreshed content heads; session seeding; rejection of symlink and executable category files.
- `npm run check`: version and TypeScript checks passed; 454/457 tests passed. Two tests failed because sandbox socket creation returned EPERM. Both affected runtime files then passed in the permitted environment, 3/3 tests (`.tmp/category-runtime-check.log`).
- Remaining failure: `tests/app-flow.test.mjs:257`, post-update/close flow cannot find `.article-prose`. Reproduced at the identical line using the before-change server snapshot and unchanged frontend (`.tmp/category-app-flow-baseline.log`). This test mocks API requests in the frontend and does not execute the modified backend. No unrelated frontend edits were made to pass it.
- Independent read-only review: no actionable findings; reviewer executed no overlapping tests.
- Diff whitespace check passed for modified tracked application/test files. No formatter or lint configuration exists in this repository; existing file styles were followed.

## Performance comparison

Run `node docs/research/2026-11-04-category-read/compare.mjs` with the local before-change snapshot in `.tmp/category-read-before`. The snapshot preserves the actual dirty baseline, including the earlier GitHub retry changes. Initial baseline hashes are in `probe.json`; current hashes and baseline bindings are in `verification.json`.

Same actual server handlers, 48 categories, 10,291 recursive-tree entries, Node v24.3.0, synthetic 20 ms per GitHub response, three samples per scenario. All resulting response bytes match exactly. Full results: `comparison.json`.

| Scenario | Before median | After median | Before requests | After requests |
| --- | ---: | ---: | ---: | ---: |
| Cold category read | 429.62 ms | 207.67 ms | 16 | 15 |
| Repeated category read | 373.43 ms | 92.80 ms | 16 | 7 |

This is about 52% less simulated cold-read time and 75% less simulated repeated-read time. After the initial session check, the first category read makes 10 requests; subsequent reads make 7. Root-tree lookup avoids recursively transferring the post/attachment inventory.

Authenticated live and production latency, actual memory usage, and deployment parity remain unmeasured. The connected Chrome tab was signed out during investigation. These numbers establish improvement under controlled inputs, not a production speed guarantee.

Next: user review or separately authorized deployment. The unrelated frontend test failure remains outside this request.
