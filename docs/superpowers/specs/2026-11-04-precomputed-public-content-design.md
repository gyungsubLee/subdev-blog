# Precomputed public content

Status: approved by the user; local implementation and verification recorded in the linked plan.
Owner: current chat. User request: move validation and public-data generation to save/push time; read only generated results.

## Outcome and preserved behavior

Remove repository-tree traversal, Markdown parsing, global validation and Markdown link rewriting from public reads. Preserve the current index/post API, ordering, 1,400-character summary contract, search text, public field allowlist, attachment behavior, authentication boundaries, save conflict protection and lost-response recovery. No UI changes, new service, new dependency, deployment or remote publication is part of this local implementation.

Existing unrelated working-tree changes must remain intact. In particular, the managed save implementation is already modified by other work; changes must integrate with its current bytes.

## Evidence

The live measurement in `docs/research/2026-11-04-content-read-live/result.json` used 3,033 posts. An empty handler cache took 5.172 seconds on its first observation; validation took 2.007 seconds. Subsequent empty-handler-cache observations took 2.383/2.663 seconds, with validation taking 1.780/1.700 seconds. A captured-response replay without network still took 1.929 seconds. These are local-handler observations, not deployment or browser timings.

## Storage decision

Use the existing content GitHub repository for generated public files, with a reserved immutable generated ref for each source commit: `refs/heads/public-data/<source SHA>`.

Each ref points to a generated commit containing:

- `manifest.json`: schema/generator version, source commit, generated file inventory and publication identity.
- `index.json`: exactly the existing public index response.
- `posts/<UUID>.json`: exactly the existing public post response.

Generated output contains public fields only. Never copy editor JSON, opaque source metadata, credentials or the server catalog into this output. Source commits remain unchanged. Generated refs must never be force-updated or used as source branches.

Separate output avoids a self-reference: the source commit SHA is known before output URLs, revisions and the index response are generated. It also avoids app deployment for each content save.

Alternatives considered: committing output alongside source would require a different source identity or late URL substitution; using a new object-storage service would add infrastructure and credentials. Neither is necessary for this change.

## Generation

Share one generator between managed save, a local CLI and the content-repository push workflow. Reuse existing content validation and public projection functions. The generator receives an immutable source SHA and validates actual source data before writing any publication ref.

Read source files with bounded concurrency, file/aggregate-size limits and finite timeouts. Run global validation and project the complete public index and full post responses. Generate the summaries using the existing summary/search semantics; compare generated output against the current reader on the same source before activation.

Publish all files in one generated Git tree/commit, then create its source-specific ref last. A failed or partial generation must not expose a ready artifact. On a retry, reuse an existing matching publication; reject an incompatible or mismatched publication rather than overwriting it.

Start with one correct full-generation path, without speculative incremental machinery. This moves substantial work to writes: a full run may need to read all Markdown documents. Measure this on the real corpus before choosing request deadlines or enabling the new save path. If it cannot finish within the existing save-host limits, stop activation and revise the write execution design; do not silently add a background service, remove validation or report an unready save as complete.

## Managed saves

Keep existing candidate creation, request identity, provenance checks, authorization, revision checks, non-force head updates and conflict recovery.

Generate and publish the candidate's public output before moving the canonical source head. If generation fails, leave the canonical head unchanged and preserve the retryable candidate. Only report successful publication after both output readiness and canonical acceptance have been established.

Recovery and superseded-save paths must check the artifact for the content commit they return. Existing accepted candidates created before rollout need an explicit migration/bootstrap path, not a read-time generation fallback.

Do not restore the legacy application-build/deployment workflow for normal web saves.

## Direct pushes

Add a narrowly scoped content-repository workflow for source-branch pushes and manual bootstrap. It must ignore generated refs and use trusted generator code from an explicitly pinned app revision. Do not execute arbitrary scripts taken from the content revision. Grant only the permissions required to read source and write generated Git objects/refs.

A direct push can move the source head before generation completes. During that interval, reads for that head return a bounded existing-style API error (503). They do not silently serve an older commit as latest and do not rebuild content in the request. Invalid pushes remain unavailable until corrected or rolled back.

Remote installation, workflow execution and first production bootstrap remain unperformed until the corresponding remote action is authorized. Local code/configuration and a concrete activation procedure are deliverables here.

## Public reads

Keep the configured canonical content repository fixed. Fetch the canonical branch SHA, retaining the current bounded freshness window and save-after refresh behavior. Fetch only the corresponding generated manifest/index or selected post. Do not request repository metadata, commit trees, source Markdown or all other posts.

Keep lightweight request and artifact-envelope checks: schema version, matching source commit, UUID, selected record identity, allowed public fields, response size, transport failures and finite deadlines. These are trust-boundary checks, not global content revalidation. Do not recalculate source blob hashes or rewrite Markdown on reads.

Historical post requests require a ready publication for the exact source SHA. Only artifacts created by the trusted publication path are eligible; arbitrary caller-provided raw repository files cannot become responses. Retain public-history eligibility protection where needed without loading the source tree.

Preserve no-store responses, gzip negotiation, compressed response limit, bounded process memory, request coalescing and cache separation. No browser or CDN cache policy change is included.

## Activation and failure behavior

1. Validate/generate artifacts for the current canonical source commit.
2. Confirm index and representative full-post output parity, public-field filtering, attachments and source identity.
3. Install the direct-push generation workflow and verify it on an isolated fixture/repository before production activation.
4. Activate the reader and write path together only after bootstrap and write-time limits are verified.

Missing output: 503. Unknown post in a ready manifest: 404. Malformed/mismatched/oversized output: explicit bounded error. No fallback to the old global read pipeline or stale built-in content.

## Verification and completion

- Generator checks cover links, inherited categories, deleted/renamed posts, attachments, reserved editor files and hidden metadata.
- Output-parity checks compare normalized selected primitive values/digests against the current implementation on identical sources; preserve intentional existing contracts.
- Reader checks assert no tree, source Markdown or global validation calls, and test missing/corrupt publications, gzip, size caps, historical reads and cache isolation.
- Managed-save checks cover artifact failure before head update, conflicts, duplicate requests, lost responses and publication readiness on recovery.
- Workflow/CLI checks cover exact immutable source selection, generated-ref exclusion and bounded failure cleanup.
- Measure empty-cache/warm reads using the same corpus and environment as the investigation; measure generation/save duration and request counts separately. Do not claim preserved write performance without evidence.
- One execution owner runs each overlapping check. Do not rerun another active owner's suite. Product UI is unchanged; no visual redesign or new UI is authorized.

## Current limits and next step

The implementation and evidence are tracked in [the plan](../plans/2026-11-04-precomputed-public-content.md). Remote activation remains separate from local implementation; follow [the activation procedure](../../research/2026-11-04-precomputed-public-content/activation.md).

The project-context check reported `missing/oversized entry point: .project-context/INDEX.md`. Existing context was not rewritten. The configured STE-KO skill symlink points to a missing target; English documentation is used.
