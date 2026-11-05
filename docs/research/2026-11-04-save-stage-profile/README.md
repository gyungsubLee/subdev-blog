# Remaining save latency — actual GitHub stage profile

Three title-only update requests took 24.971s, 22.975s and 20.548s; median 22.975s. Each made33 GitHub requests/10 writes and regenerated1 body while reusing3,033 public body blobs. Awaited GitHub request spans dominate the remaining latency.

## Actual middle request decomposition

These rows describe the one request whose total is the median. They sum to its elapsed time apart from rounding and the HTTP wrapper; they are not independently selected per-stage medians.

| Stage | Wall | Requests | Awaited GitHub span | Other time |
|---|---:|---:|---:|---:|
| Source lookup and validation | 2.950s | 7 | 2.889s | 0.060s |
| Source commit and candidate check | 3.138s | 5 | 3.137s | 0.002s |
| Public lookup, candidate tree and previous artifact | 3.577s | 9 | 3.412s | 0.165s |
| Changed post and JSON generation | 0.477s | 1 | 0.246s | 0.231s |
| Public blob/tree/commit/ref upload | 10.259s | 5 | 10.171s | 0.088s |
| Canonical advance and final verification | 2.572s | 6 | 2.560s | 0.011s |
| Total |22.975s|33|22.415s|0.558s|

GitHub spans account for 97.6% of elapsed time. They include transmission, stream consumption and GitHub server processing; pure wire delay is not isolated. Residual time includes JS/JSON/hash/graph work, filesystem, scheduling and diagnostic overhead rather than CPU-profiler attribution. The changed-post/JSON stage's local residual was 0.231s.

## Data still transferred for one edited post

- Whole index.json about5.56MB and generation.json about2.65MB are rewritten. REST blob base64 bodies expand to7.415MB and3.534MB.
- Total outgoing request payload: 11.444MB, excluding HTTP/TLS headers. Consumed response bodies after decompression: 18.308MB; this is not compressed wire download size.
- Four recursive tree reads remain: original source, candidate source, previous public artifact, and final public artifact. Each source tree is about3.75MB decoded.
- Previous artifact verification/cache loading uses6 reads. Final readiness verification reads the just-created artifact again with4 calls. Most awaited calls lie sequentially on the critical path.

## Upload detail for the same request

| Order | Git endpoint | Request payload | Awaited span |
|---|---|---:|---:|
| 1 | POST blobs | 7.415MB | 4.263s |
| 2 | POST blobs | 3.534MB | 2.994s |
| 3 | POST trees | 0.492MB | 1.598s |
| 4 | POST commits | 0.000MB | 0.508s |
| 5 | POST refs | 0.000MB | 0.808s |

The two large blob requests are sequential and together take 7.258s. Tree/commit/ref calls add 2.913s. Source body projection is incremental; shared JSON and source-tree metadata transfer still scale with corpus size.

## Follow-up priorities — not implemented

1. Reduce whole index/cache transfer size or update granularity.
2. Evaluate bounded concurrent uploads of independent blobs, retaining dependent final tree/ref publication. Shared bandwidth and server limits mean the speedup is not proven by these observations.
3. Reuse the already obtained candidate tree and newly created artifact readiness within the request, preserving conflict/recovery conditions. This targets repeated tree retrieval and final4-read verification.

## Method and provenance

Timing markers run in temporary copies of content/publication/handler modules. The copies use the original dependencies and existing real OAuth session, CSRF, owner checks and GitHub transport. Source snapshots/hashes are retained. No production module, app deployment, generator pin or native preview was changed by this task.

A fetch adapter measures header and response stream completion, byte counts and non-overlapping stage timing without saving payloads or credentials. Unconsumed error bodies use header time. The diagnostic unit passes; original/instrumented fixture publishers produced identical artifact SHA. Scope is HTTP save time for a small title-only update, excluding editor opening, client export, network caches forced cold or Vercel cold-start.

An initial copy missed dynamic import rewriting and returned a public GET500 before any save. This was corrected and GET200 confirmed before sampling. A stale draft on reopening was refreshed with the existing latest-source control; editor GET/UI delays are outside POST timing. All five real writes returned200.

Another task changed only bulk receipt response formatting in content.mjs during measurement. Single-operation requests return before that branch. The timed copies stayed fixed across all samples; source-snapshot/, source-hashes.json and concurrent-content.diff record the exact distinction.

## Cleanup and evidence

The disposable post was deleted; all10,294 original file Git hashes match the pre-test source, leaving3,033 posts and0 drafts. The task tab and diagnostic server were closed, preserving the original preview and login session. All5 automatic push workflows passed, including [final cleanup](https://github.com/gyungsubLee/subdev-blog-content/actions/runs/41838368464).

See analysis.json, verification.json, browser-api-traces.json, phase JSON and screenshots. Prepare with `python3 tests/e2e/prepare-save-profile.py`; start the existing server using E2E_PROFILE=1 and a dedicated E2E_FOLDER. It has a30-minute deadline. Analyze with `node tests/e2e/analyze-save-profile.mjs <report.json> <analysis.json>`. Browser control used connected Chrome; no Playwright.
