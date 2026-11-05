# Incremental public generation — actual GitHub E2E

Changed and affected documents are now validated/projected at save time. Other public body blobs are reused from the verified first-parent artifact through Git base_tree. Real GitHub create/update/delete and all five automatic push workflows passed. Original10,294 source files were restored exactly;3,033 posts remain.

## Measurements

Same machine and3,033-post corpus; latest real handler, production frontend, authentic OAuth/CSRF, actual GitHub REST/raw I/O. HTTP POST duration includes successful canonical publication. These are individual observations, not medians or guaranteed service times.

| Operation | Previous whole-corpus publication | Incremental publication | Generation raw Markdown GETs now |
|---|---:|---:|---:|
| Independent create | No comparable cold create; prior71.48s was recovery |22.28s|1|
| Fresh title update |161.17s|20.73s|1|
| Delete |156.55s|28.21s|0|

Fresh update improved87.1%; delete improved82.0%. Each create/update generated1 body and reused3,033 existing body blobs; deletion generated0 bodies, reused3,033 and removed1. The immutable Git blob SHA comparison is in created.json, updated.json and deleted.json. Updated title/body rendered on the real public reader, and the deleted URL subsequently showed PAGE NOT FOUND.

The one-time state bootstrap took167.60s and downloaded3,034 Markdown files. Its separate cleanup took21.37s with0 generation raw Markdown GETs. This initialization is excluded from independent incremental timings. Baseline before this task is recorded in ../2026-11-04-public-data-remote/README.md. Different source SHAs and network/CDN cache conditions limit exact statistical comparison.

## Reuse contract

- Full source tree hashes/paths and attachment inventory determine changed inputs. Unchanged source bodies are not downloaded or parsed by the generator. The existing save preflight may read the specifically edited/deleted source through the Git blob API.
- Minimal validated graph facts and resolution keys live in generation.json, an inventoried generated file. Arbitrary metadata, editor content and raw source Markdown are excluded. Category facts use an explicit whitelist.
- Cheap global graph checks preserve parent cycles, missing references, category consistency and alias collision protection. Effective category changes and changed/unresolved Markdown/Notion resolution keys invalidate affected documents. Attachment changes invalidate the owner.
- Unaffected summaries/body blobs keep their original pinned attachment URLs; source ancestry and unchanged attachment blob hashes preserve the same bytes. Changed/affected bodies use the current source commit.
- Index summaries are patched/sorted and index.json plus generation.json/manifest.json are saved. Uploads remain bounded; removed body paths are deleted from the prior generated tree. Ready ref publication and save-conflict/recovery behavior stay atomic.
- Existing artifacts without compatible state, changed generator catalog signature or missing first-parent publication fall back to one full generation. No mutable rewriting of old public refs.

Remaining20–28s includes32–33 observed GitHub calls and9–11 writes, previous artifact verification, index/cache transfer and canonical conflict checks. Full body processing is gone; this report does not isolate every network vs CPU component.

## Public read compatibility

The manifest/public JSON schema and UI remain unchanged. The ordinary public reader does not download generation.json. A fresh handler GET returned200 for3,033 posts and used only4 GETs: canonical ref, publication ref, manifest and index. It made0 Markdown/cache/tree reads. The existing preview's cookie-free public read also returned200. See public-read.json. Its1.12s observation is a functional transport check, not a replacement for the earlier three-sample read benchmark.

## Remote and scope

Trusted generator branch codex/public-content-generator-20261104 is pinned to9c7a699f3ec2b2e1839fd1371baf52eabd5eca30. The isolated app commit changes only app/server/src/public-publication.mjs and app/content/src/content.mjs. Existing push workflow was reused unchanged; no artificial trigger commit. All five real canonical save pushes succeeded, including [final cleanup workflow](https://github.com/gyungsubLee/subdev-blog-content/actions/runs/41833619691).

No app-main merge/deployment, native rebuild or original-preview restart. Local HEAD, staging, unrelated dirty work and local content checkout preserved. The existing preview still needs a normal restart to load updated write code. The latest-module test backend and task tabs have been stopped/closed without logging out the user's session.

## Checks and evidence

Publisher18/18, relevant domain/server/public regression166/166, isolated generator15/15, HTTP E2E3/3 and production build passed. Independent review's category extension disclosure was reproduced, fixed and rechecked; no remaining findings. The full unit suite was not rerun; previous unrelated category editor failures are not claimed resolved. Actual remote category mutations and destructive fault injection were not performed; dependency/negative cases are covered by focused local checks.

See verification.json, per-phase JSON, browser-api.json, public-read.json, workflow-runs.json, red/green logs, source hashes and screenshots. No credentials were stored in evidence.
