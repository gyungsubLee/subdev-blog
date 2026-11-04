# Pages CMS and Keystatic source comparison

Research date: 2026-11-03. Scope: source research and transplantability only. No product code, dependencies, UI, save semantics, or performance controls changed. No upstream installs/scripts or target tests/builds were executed; parent owns verification.

## Result

Keep the existing architecture. Both references confirm patterns the target already implements: repository authorization, field/document validation, multi-file writes, optimistic conflicts, preservation of opaque metadata, and content-addressed reuse. No proven missing feature justifies importing either CMS. The useful next step is a small **schema parity investigation**, with implementation conditional on reproduced drift. A shared CMS field registry is not justified.

## Reproducible source inventory

| Reference | Requested and verified canonical repository | Shallow clone | Exact HEAD | License |
| --- | --- | --- | --- | --- |
| Pages CMS | `https://github.com/hunvreus/pagescms.git` | `/private/tmp/subdev-reference-20261103/pagescms` | `6f4e860a35d934406580287e7042e5e111e207a1` | MIT, copyright 2025 Ronan Berder |
| Keystatic | `https://github.com/Thinkmill/keystatic.git` | `/private/tmp/subdev-reference-20261103/keystatic` | `b8ec9650622c11e1d38e73fca3b64c17ec278d18` | MIT, copyright Thinkmill Labs Pty Ltd |

`git remote -v` retains those origins. Read-only GitHub repository API requests returned the same `full_name` and `html_url`, with default branch `main`; no repository identity redirect was observed. These are the HEADs retrieved at research time, not a promise about later upstream HEADs. Initial sandbox clone attempts both failed with `Could not resolve host: github.com`; the authorized escalated attempts completed successfully. Each clone used `subprocess.run(..., timeout=100)`; API requests used a 20-second timeout. Clone directories are outside the project.

License source: [Pages CMS LICENSE](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/LICENSE#L1-L21), [Keystatic LICENSE](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/LICENSE#L1-L21). Any later substantial source copy must retain the applicable notice. Root licenses do not establish the licenses of all transitive dependencies or external assets; none are proposed for import here.

## Actual flows

**Pages CMS save:** `app/api/[owner]/[repo]/[branch]/files/[path]/route.ts:27` obtains a user session and repository-scoped token, normalizes a path, loads `.pages.yml` configuration, selects collection schema, validates fields with generated Zod schema, runs field write functions, optionally merges original metadata, serializes content, and calls GitHub Contents API with the supplied blob SHA. On success it updates its database-backed file cache. This normal save endpoint writes one file; it is not an atomic Markdown-plus-editor-sidecar transaction. See [route.ts:27-157](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/app/api/%5Bowner%5D/%5Brepo%5D/%5Bbranch%5D/files/%5Bpath%5D/route.ts#L27-L157) and [route.ts:212-267](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/app/api/%5Bowner%5D/%5Brepo%5D/%5Bbranch%5D/files/%5Bpath%5D/route.ts#L212-L267).

**Keystatic save:** `packages/keystatic/src/app/updating.tsx:139` serializes a schema value into files, calculates blob hashes, removes unchanged additions, computes deletions, hydrates its object cache, and commits a file-change set through GraphQL with `expectedHeadOid`. On stale head it fetches the current tree and retries only when the edited entry's tree key is unchanged. Otherwise it requests a new branch. See [updating.tsx:139-285](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/packages/keystatic/src/app/updating.tsx#L139-L285).

**Target save:** `ManagedPostEditor.tsx:349-395` captures one immutable editor/Markdown snapshot, records the exact request for recovery, and sends revision guards. `server/content.mjs:469-627` validates input and paired sidecar hashes, constructs a single Git tree/commit, records `cms/requests/<UUID>`, and advances canonical content with `force:false`. It verifies canonical inclusion after the update and supports replay/status recovery. This is already stronger for the target's paired-file and lost-response contract than replacing it with a normal Contents API call.

**Target read:** `server/public-content.mjs:74-113,164-268` keeps bounded process caches, coalesces head/snapshot work, uses Git blob identity and a build catalog to avoid unchanged-body downloads, and reads bodies on demand. `src/app/App.tsx:10-11` lazy-loads editing routes. These controls remain baseline requirements.

## Six concrete patterns and decisions

### 1. Schema definitions that connect validation, serialization, and editor fields

Source: Pages CMS `fields/registry.ts:16-60` registers schema, read/write, and UI implementations per field; save applies generated validation and write mapping. [Registry permalink](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/fields/registry.ts#L16-L60). Keystatic `src/form/serialize-props.ts:19-88` traverses a schema and delegates serialization to each field. [Serializer permalink](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/packages/keystatic/src/form/serialize-props.ts#L19-L88).

Target: `src/features/post-editor/code-block.ts:173-175` creates BlockNote defaults plus custom code/notebook blocks. `src/shared/editor-document.mjs:22-28,67-87,137-145` maintains a DOM-free persisted-format validator. There is an explicit alignment comment and a manual block type list. Existing `tests/editor-document.test.mjs:26-76` already covers custom blocks, known props, opaque props, and invalid input.

Decision: **Adapt only the parity-check idea; reject the registry architecture.** These are different contracts: editor capabilities vs persisted-source validation. Importing UI-bearing field definitions into shared server code could eagerly bundle BlockNote and break DOM independence. No actual mismatch was reproduced. First compare the installed editor schema's emitted block names/default props against the existing validator through the current editor test environment. If drift exists, a focused fixture or tiny DOM-free policy list may reduce duplication. Do not create a generalized field system or reject preserved unknown JSON props. A shared schema reduces drift only for values genuinely common to both contracts; it cannot replace structural and trust-boundary validation.

Possible affected files, only after reproduction: `tests/managed-block-editor.test.mjs`, `tests/editor-document.test.mjs`, `src/shared/editor-document.mjs`, custom block spec files. Runnable check idea: for every installed emitted block type, validate one minimal serialized default snapshot and retain the existing malformed-input assertions. No new dependency.

### 2. Serialize an entry and its sibling assets as one change set

Source: Keystatic `updating.tsx:56-106` combines metadata and selected content field, returns sibling files, and `139-225` sends additions/deletions together. `serialize-props.ts:71-85` rejects external directories absent from the field's allowed directories. [File serializer](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/packages/keystatic/src/app/updating.tsx#L56-L106), [directory check](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/packages/keystatic/src/form/serialize-props.ts#L71-L85).

Target: `server/content.mjs:540-605,612-627` already validates editor revision/hash, validates assets, removes a prior renamed Markdown path, and commits Markdown, sidecar, and attachments together. `src/shared/editor-document.mjs` already guards schema version/document ID/body hash. `ManagedPostEditor.tsx:360-370` prevents a moving snapshot during async hash/network work.

Decision: **Adopt as an existing invariant, no port required.** Keep the target `editor.json` contract; Keystatic schema serialization does not supply this exact dual-source identity/hash contract. Reject replacing the transaction with Pages CMS's single-file save. Test ideas are already largely covered by `tests/github-content.test.mjs` and `tests/managed-block-editor.test.mjs`: inspect current coverage before adding any missing case for title rename plus unchanged sidecar or asset upload plus paired source.

### 3. Optimistic concurrency with scoped stale-head retry

Source: Keystatic [updating.tsx:213-285](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/packages/keystatic/src/app/updating.tsx#L213-L285) compares an entry-scoped tree key before one retry against a new branch head. Pages CMS explicitly disables automatic 409 retries, passes the original blob SHA, and classifies repository rules in [route.ts:310-355](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/app/api/%5Bowner%5D/%5Brepo%5D/%5Bbranch%5D/files/%5Bpath%5D/route.ts#L310-L355).

Target: `server/content.mjs:197-218,477-483` intentionally requires canonical head equality and verifies acceptance after uncertain responses. Opaque UUID request branches and payload fingerprints support idempotent replay. Frontend recovery already preserves draft/request identity.

Decision: **Reject scoped auto-rebase/retry for this plan.** Accepting unrelated head changes is a contract change. Target operations validate cross-document links, categories, deletion constraints, and assets, so an edited-file-only tree comparison is insufficient. Adopting GraphQL commits would also discard the existing request-branch provenance/status mechanism unless rebuilt. Existing conflicts/replay tests should remain unchanged. A future product request could separately specify full graph revalidation on a new base; current source research does not establish that need.

### 4. Preserve unknown metadata while replacing explicitly edited arrays

Source: Pages CMS optionally fetches original content and merges validated field values, replacing incoming arrays rather than concatenating them: [route.ts:125-147](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/app/api/%5Bowner%5D/%5Brepo%5D/%5Bbranch%5D/files/%5Bpath%5D/route.ts#L125-L147). Its frontmatter parser/stringifier is centralized in [lib/serialization.ts:13-90](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/lib/serialization.ts#L13-L90).

Target: `src/shared/document.mjs:321-370` already allows only explicit title/category changes, preserves canonical original metadata, guards revision, and updates review status only for body changes. `tests/github-content.test.mjs:164` already names opaque metadata/attachment preservation.

Decision: **Adopt as already implemented; reject importing Lodash merge or generic TOML/JSON schema support.** Target's narrow patch policy is easier to audit than recursive generic merge and preserves unedited AI/extension metadata. No target change is identified. Any future array-editing feature should define replacement semantics explicitly and add one focused primitive-value round-trip test; it is outside this research plan.

### 5. Content-addressed caches with explicit lifetime and invalidation policy

Source: Keystatic persists blobs/trees by SHA, validates stored trees, and garbage-collects objects from root hashes: [object-cache.ts:23-77](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/packages/keystatic/src/app/object-cache.ts#L23-L77), [object-cache.ts:128-150](https://github.com/Thinkmill/keystatic/blob/b8ec9650622c11e1d38e73fca3b64c17ec278d18/packages/keystatic/src/app/object-cache.ts#L128-L150). Pages CMS uses incremental push updates, then scoped/full invalidation above configured thresholds: [github-webhook-push.ts:13-20](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/lib/github-webhook-push.ts#L13-L20), [github-webhook-push.ts:84-153](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/lib/github-webhook-push.ts#L84-L153).

Target: `server/public-content.mjs:74-113,120-168,208-268` already bounds configurations, snapshots and blob memory, coalesces reads, reuses blobs/catalog summaries, and bypasses stale head after own save. Existing public tests include bounded concurrency, stale-cache refresh, ancestry checks, catalog reuse, and production-size compression.

Decision: **Keep current caches; reject transplanting database/webhook/IndexedDB layers.** A durable shared cache could reduce serverless cold-start work, but this is an unmeasured operational hypothesis. No evidence here establishes a bottleneck or warrants a new service. If later measured, key by immutable commit/blob and preserve ancestry/visibility checks; cache hits must not make candidate branches public. Compare identical cold/warm inputs, GitHub request counts, response bytes, and latency before any change. Keep 30-second head policy, bounded workers, memory caps, on-demand bodies, and editor lazy loading.

### 6. Repository-scoped token resolution and coalesced refresh

Source: Pages CMS `lib/token.ts:22-59` selects an authorized user token or explicitly permitted collaborator's installation token, while `63-134` caches encrypted installation tokens and coalesces refresh by installation ID. [Token flow](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/lib/token.ts#L22-L134). Repository read context applies session/token/access/config gates: [api-repo-context.ts:22-43](https://github.com/hunvreus/pagescms/blob/6f4e860a35d934406580287e7042e5e111e207a1/lib/api-repo-context.ts#L22-L43).

Target: `server/auth.mjs:73-91` checks numeric owner identity and mutation origin/CSRF; `94-146` checks App ID, permissions, exact two-repository installation, writable repository IDs/branches, and content submodule identity. The README explicitly excludes App private key and installation-token requirements from the web save setup.

Decision: **Reject importing collaborator auth, token database, or App private-key setup.** Those serve a multi-user CMS. Current target identity and installation checks should remain stricter. Refresh coalescing is useful only if a shared refresh path is introduced for an independently established reason; no such need is demonstrated. Existing `tests/github-auth.test.mjs` owns current auth behavior. Do not replace server-only tokens with client-side reference flows.

## Minimal integrated follow-up

1. Preserve the current approved UI, BlockNote editor, Markdown/sidecar schema, authenticated save transaction, public API and caches.
2. Investigate schema parity in existing tests before production code. Treat it as a research hypothesis, not a reported defect. Reuse current BlockNote setup; compare primitive type/property values and always clean up editor/DOM resources.
3. If a failing parity case is reproduced, make the smallest local validator/spec correction. Share only genuinely identical DOM-free constants if that reduces actual duplication; no registry or new schema framework.
4. Parent chooses and executes the one relevant verification target. Do not duplicate its tests. Product UI/performance comparisons are necessary only if a later implementation changes those paths; this report has not changed them.

## Limits and blockers

The clones and canonical identities are verified. Upstream production behavior, hosted services, and third-party dependency audits were not exercised. Target was read, not run; existing test names are coverage evidence, not a new passing-test claim. No live GitHub App login/save was performed. No browser session or UI comparison was needed for this source-only assignment. There is no remaining clone blocker. No code port is warranted without a reproduced incremental gap.
