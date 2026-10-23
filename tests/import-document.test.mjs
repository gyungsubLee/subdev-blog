import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalFilename,
  markdownDocument,
  mergeDocumentPatch,
  parseBlockBackup,
  parseMarkdownDocument,
  serializeDocumentPatch,
  serializeMarkdownDocument,
} from "../src/shared/document.mjs";

test("exported Markdown restores title, category, IDs and body without a duplicate H1", () => {
  const draft = {
    id: "draft-05f7ecaa-ed14-4adb-a610-d0524197987a",
    title: "제목: 왕복",
    category: "개발",
    createdAt: "2026-10-22",
    updatedAt: "2026-10-22",
    markdown: "## 실제 본문\n\n코드 \x60값\x60",
  };
  const imported = parseMarkdownDocument(markdownDocument(draft));
  assert.equal(imported.title, draft.title);
  assert.equal(imported.category, draft.category);
  assert.equal(imported.id, draft.id.slice(6));
  assert.equal(imported.markdown.trim(), draft.markdown);
});

test("an unrelated first heading remains in the body", () => {
  const imported = parseMarkdownDocument(
    '---\ntitle: "문서"\ncategory: "개발"\n---\n\n# 본문 제목\n\n내용',
  );
  assert.match(imported.markdown, /# 본문 제목/);
  assert.equal(imported.title, "문서");
});

test("plain Markdown imports its first heading as the document title", () => {
  const imported = parseMarkdownDocument("# 새 글\n\n내용");
  assert.equal(imported.title, "새 글");
  assert.equal(imported.markdown.trim(), "내용");
});

test("invalid backup metadata fails before the document can be replaced", () => {
  assert.throws(
    () =>
      parseBlockBackup(
        JSON.stringify({
          title: "제목",
          category: 123,
          blocks: [{ type: "paragraph" }],
        }),
      ),
    /문자열/,
  );
  assert.throws(
    () =>
      parseMarkdownDocument('---\ntitle: "제목"\ncategory: 123\n---\n\n본문'),
    /문자열/,
  );
  assert.deepEqual(
    parseBlockBackup('{"title":"제목","blocks":[{"type":"paragraph"}]}')
      .category,
    "기록",
  );
});

test("horizontal rules do not discard the enclosed body", () => {
  const markdown = "---\nKeep this paragraph.\n---\n\nMore content.";
  assert.equal(parseMarkdownDocument(markdown).markdown, markdown);
});

const documentId = "1dceda9b-0fe1-80d4-80ac-ee6d24a0638c";
const otherId = "1d4eda9b-0fe1-80a2-95f7-e975482b1dcd";
const revision = "a".repeat(64);
const canonical = {
  metadata: {
    schema_version: 1,
    id: documentId,
    title: "제목: 원문",
    parent_id: null,
    order: 0,
    kind: "article",
    summary: "첫 줄\n둘째 줄\n",
    tags: ["css", "한국어"],
    aliases: ["다른 제목"],
    related_ids: [otherId],
    source_ids: [],
    review_status: "unreviewed",
    created: "2025-04-21T02:48:47.208Z",
    updated: "2025-04-21T06:22:27.987Z",
    extension: { nested: [null, true, 3.5, { value: "보존" }] },
  },
  markdown: '\r\n# 제목: 원문\r\n\r\n---\r\n\r\n```js\r\nconst x = "---";\r\n```\r\n',
};

function fullHeader(fields = "", body = "\n# 본문\n") {
  return `---\nschema_version: 1\nid: ${documentId}\ntitle: 제목\nparent_id: null\ncreated: 2025-04-21T02:48:47.208Z\nupdated: 2025-04-21T06:22:27.987Z\n${fields}---\n${body}`;
}

test("canonical metadata survives a Markdown round trip", () => {
  const parsed = parseMarkdownDocument(
    serializeMarkdownDocument(canonical),
  );
  assert.equal(parsed.documentMode, "full");
  assert.deepEqual(parsed.metadata, canonical.metadata);
  assert.equal(parsed.markdown, canonical.markdown);
  assert.equal(parsed.sourceId, documentId);
});

test("full documents default optional metadata while preserving their first H1", () => {
  const parsed = parseMarkdownDocument(fullHeader());
  assert.equal(parsed.documentMode, "full");
  assert.equal(parsed.markdown, "\n# 본문\n");
  assert.deepEqual(parsed.metadata.tags, []);
  assert.equal(parsed.metadata.summary, "");
  assert.equal(parsed.metadata.kind, "article");
  assert.equal(parsed.metadata.order, 0);
  assert.equal(parsed.metadata.review_status, "unreviewed");
});

test("valid unknown-only YAML mappings are metadata and leave body bytes intact", () => {
  const parsed = parseMarkdownDocument(
    "---\ncustom:\n  nested: [true, null, 2]\n---\n\r\n내용\r\n",
  );
  assert.deepEqual(parsed.metadata, { custom: { nested: [true, null, 2] } });
  assert.equal(parsed.markdown, "\r\n내용\r\n");
  assert.equal(parsed.documentMode, "legacy");
});

test("invalid metadata fails before callers replace existing text", () => {
  for (const header of [
    "title: 첫째\ntitle: 둘째\n",
    "schema_version: 2\n",
    "schema_version: '1'\n",
    "schema_version: 1\nid: ../../escape\n",
    "custom: &anchor [one]\ncopy: *anchor\n",
    "custom: !!str tagged\n",
    "? [one, two]\n: value\n",
    "custom:\n  __proto__: unsafe\n",
    "custom:\n  constructor: unsafe\n",
    "custom:\n  prototype: unsafe\n",
    "custom: .inf\n",
    "custom: .nan\n",
    "title: [unterminated\n",
  ]) {
    let currentBody = "previous editor text";
    assert.throws(() => {
      currentBody = parseMarkdownDocument(`---\n${header}---\nnew body`).markdown;
    }, undefined, header);
    assert.equal(currentBody, "previous editor text");
  }
  assert.throws(() => parseMarkdownDocument("---\ntitle: broken\nnew body"));
});

test("known canonical fields reject invalid values and missing required fields", () => {
  for (const fields of [
    "order: -1\n", "kind: unknown\n", "summary: []\n", "tags: [1]\n",
    "related_ids: [invalid]\n", "source_ids: [invalid]\n", "category_id: 12\n",
    "source_url: javascript:alert(1)\n", "review_status: accepted\n",
    "cover: 12\n", "icon: {}\n", "legacy_path: []\n",
  ]) {
    assert.throws(() => parseMarkdownDocument(fullHeader(fields)), undefined, fields);
  }
  assert.throws(() => parseMarkdownDocument(`---\nschema_version: 1\nid: ${documentId}\n---\nbody`));
  assert.throws(() => parseMarkdownDocument(fullHeader().replace("parent_id: null", "parent_id: missing")));
  assert.throws(() => parseMarkdownDocument(fullHeader().replace("2025-04-21T02:48:47.208Z", "not-a-date")));
});

test("non-mapping frontmatter remains ordinary Markdown", () => {
  for (const text of [
    "---\n- list\n- item\n---\nbody",
    "---\nordinary prose\n---\nbody",
    "---\n\n---\nbody",
  ]) {
    assert.equal(parseMarkdownDocument(text).markdown, text);
  }
});

test("legacy source_id wins over a draft alias while schema 1 rejects conflicting IDs", () => {
  const parsed = parseMarkdownDocument(`---\nid: ${documentId}\nsource_id: ${otherId}\ntitle: old\n---\n# old\n\nbody`);
  assert.equal(parsed.documentMode, "legacy");
  assert.equal(parsed.id, otherId);
  assert.equal(parsed.sourceId, otherId);
  assert.equal(parsed.markdown.trim(), "body");
  assert.throws(() => parseMarkdownDocument(fullHeader(`source_id: ${otherId}\n`)));
  assert.equal(parseMarkdownDocument(fullHeader(`source_id: ${documentId}\n`)).id, documentId);
});

test("legacy ID fallback ignores an invalid source alias and normalizes valid UUIDs", () => {
  const parsed = parseMarkdownDocument(`---\nid: ${documentId.toUpperCase()}\nsource_id: old-invalid-alias\ntitle: old\n---\nbody`);
  assert.equal(parsed.id, documentId);
  assert.equal(parsed.sourceId, documentId);
});

test("full edit exports carry base_revision outside canonical metadata", () => {
  const text = serializeMarkdownDocument(canonical, { baseRevision: revision });
  const parsed = parseMarkdownDocument(text);
  assert.equal(parsed.baseRevision, revision);
  assert.deepEqual(parsed.metadata, canonical.metadata);
  assert.equal(parsed.markdown, canonical.markdown);
  assert.doesNotMatch(serializeMarkdownDocument(parsed), /base_revision|document_mode/);
  assert.throws(() => parseMarkdownDocument(fullHeader("base_revision: invalid\n")));
});

test("patch round trips require only editable fields and add no full metadata defaults", () => {
  const patch = {
    id: documentId,
    changes: { title: "수정" },
    baseRevision: revision,
    markdown: "# 보존\n",
  };
  const parsed = parseMarkdownDocument(serializeDocumentPatch(patch));
  assert.equal(parsed.documentMode, "patch");
  assert.deepEqual(parsed.patch, patch);
  assert.throws(() => parseMarkdownDocument(`---\nschema_version: 1\ndocument_mode: patch\nid: ${documentId}\ntitle: 수정\n---\nbody`));
  assert.throws(() => parseMarkdownDocument(fullHeader("document_mode: other\n")));
});

test("patch merge checks revision and identity then preserves hidden and unedited fields", () => {
  const patch = {
    id: documentId,
    changes: {
      title: "수정",
      category_id: "source:CSS",
      extension: "malicious",
      parent_id: otherId,
    },
    baseRevision: revision,
    markdown: "새 본문\n",
  };
  const merged = mergeDocumentPatch(canonical, patch, revision);
  assert.equal(merged.metadata.title, "수정");
  assert.equal(merged.metadata.category_id, "source:CSS");
  assert.equal(merged.markdown, "새 본문\n");
  assert.equal(merged.metadata.parent_id, null);
  assert.deepEqual(merged.metadata.extension, canonical.metadata.extension);
  assert.equal(merged.metadata.review_status, "needs_review");
  assert.ok(Date.parse(merged.metadata.updated) >= Date.parse(canonical.metadata.updated));
  assert.deepEqual(canonical.metadata.tags, ["css", "한국어"]);
  assert.equal(canonical.metadata.title, "제목: 원문");
  assert.throws(() => mergeDocumentPatch(canonical, patch, "b".repeat(64)));
  assert.throws(() => mergeDocumentPatch(canonical, { ...patch, id: otherId }, revision));
  const unchanged = mergeDocumentPatch(canonical, {
    ...patch,
    markdown: canonical.markdown,
    changes: { title: "제목 변경" },
  }, revision);
  assert.equal(unchanged.metadata.review_status, "unreviewed");
});

test("canonical filenames are portable NFC names bounded by UTF-8 bytes", () => {
  for (const [title, filename] of [
    ["같은 제목", "같은 제목.md"], ["CI/CD", "CI_CD.md"],
    ['a\\b:c*?"<>|\u0001', "a_b_c_______.md"], ["CON", "_CON.md"],
    ["con.txt", "_con.txt.md"], ["LPT9", "_LPT9.md"], ["NUL. ", "_NUL.md"],
    ["... ", "제목 없음.md"], ["", "제목 없음.md"], ["한글", "한글.md"],
  ]) {
    assert.equal(canonicalFilename(title), filename, title);
  }
  assert.equal(canonicalFilename("a".repeat(197)), "a".repeat(197) + ".md");
  assert.equal(canonicalFilename("a".repeat(198)), "a".repeat(197) + ".md");
  assert.equal(canonicalFilename("가".repeat(66)), "가".repeat(65) + ".md");
  assert.equal(canonicalFilename("😀".repeat(50)), "😀".repeat(49) + ".md");
});

test("a no-op patch preserves the existing modification date", () => {
  const merged = mergeDocumentPatch(canonical, {
    id: documentId,
    baseRevision: revision,
    changes: { title: canonical.metadata.title },
    markdown: canonical.markdown,
  }, revision);
  assert.deepEqual(merged, canonical);
});

test("serialization rejects non-JSON extension values and protected nested keys", () => {
  for (const extension of [
    undefined, Infinity, 1n, new Date(),
    { nested: JSON.parse('{"constructor": "unsafe"}') },
  ]) {
    assert.throws(() => serializeMarkdownDocument({
      ...canonical,
      metadata: { ...canonical.metadata, extension },
    }));
  }
});

test("canonical IDs and references normalize hex case while accepting corpus UUID versions", () => {
  const metadata = {
    ...canonical.metadata,
    id: documentId.toUpperCase(),
    parent_id: otherId.toUpperCase(),
    related_ids: [otherId.toUpperCase()],
    source_ids: ["05F7ECAA-ED14-4ADB-A610-D0524197987A"],
  };
  const parsed = parseMarkdownDocument(serializeMarkdownDocument({ ...canonical, metadata }));
  assert.equal(parsed.metadata.id, documentId);
  assert.equal(parsed.metadata.parent_id, otherId);
  assert.deepEqual(parsed.metadata.related_ids, [otherId]);
  assert.deepEqual(parsed.metadata.source_ids, ["05f7ecaa-ed14-4adb-a610-d0524197987a"]);
});

test("legacy invalid ID aliases do not become canonical document identities", () => {
  const parsed = parseMarkdownDocument('---\nid: old-draft-alias\nsource_id: old-invalid-alias\ntitle: old\n---\nbody');
  assert.equal(parsed.documentMode, "legacy");
  assert.equal(parsed.id, undefined);
  assert.equal(parsed.sourceId, undefined);
  assert.equal(parsed.metadata.id, "old-draft-alias");
});

test("shared extension objects serialize as JSON values without YAML aliases", () => {
  const shared = { value: "same" };
  const document = {
    ...canonical,
    metadata: { ...canonical.metadata, extension: { left: shared, right: shared } },
  };
  const parsed = parseMarkdownDocument(serializeMarkdownDocument(document));
  assert.deepEqual(parsed.metadata.extension, {
    left: { value: "same" },
    right: { value: "same" },
  });
});

test("patch headers validate supplied known metadata before discarding non-editable fields", () => {
  assert.throws(() => parseMarkdownDocument(`---\nschema_version: 1\ndocument_mode: patch\nid: ${documentId}\nbase_revision: ${revision}\nparent_id: invalid\n---\nbody`));
});
