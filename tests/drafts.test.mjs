import { markdownDocument } from "../src/shared/document.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  readDrafts,
  saveDraft,
  DRAFT_KEY,
} from "../src/shared/drafts.mjs";

function storage(raw = null) {
  return {
    raw,
    getItem() {
      return this.raw;
    },
    setItem(key, value) {
      assert.equal(key, DRAFT_KEY);
      this.raw = value;
    },
  };
}

const draft = {
  id: "draft-check",
  title: "제목: 테스트",
  category: "개발",
  markdown: "원문 **강조**",
  blocks: [],
  createdAt: "2026-10-22",
  updatedAt: "2026-10-22",
};

test("saving preserves other drafts and updates an existing draft once", () => {
  const store = storage();
  saveDraft(store, { ...draft, id: "draft-other" });
  saveDraft(store, draft);
  saveDraft(store, { ...draft, title: "수정" });
  assert.equal(readDrafts(store).length, 2);
  assert.equal(readDrafts(store)[0].title, "수정");
});

test("corrupt existing storage is never overwritten", () => {
  for (const original of [
    "{broken",
    '{"title":"wrong"}',
    '[{"id":"invalid"}]',
  ]) {
    const store = storage(original);
    assert.throws(() => saveDraft(store, draft));
    assert.equal(store.raw, original);
  }
});

test("storage quota error reaches the caller", () => {
  const store = storage();
  store.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  assert.throws(() => saveDraft(store, draft), /QuotaExceeded/);
});

test("Markdown export retains content and quotes frontmatter", () => {
  const output = markdownDocument(draft);
  assert.match(output, /title: "제목: 테스트"/);
  assert.match(output, /원문 \*\*강조\*\*/);
});

test("stored full drafts preserve document identity, metadata and selected sibling bytes", () => {
  const store = storage();
  const full = {
    ...draft, documentId: "11111111-1111-4111-8111-111111111111",
    documentMode: "full", editorMode: "markdown", originalMarkdown: "original\r\n",
    metadata: { schema_version: 1, id: "11111111-1111-4111-8111-111111111111", title: "Full", parent_id: null, created: "2026-10-22", updated: "2026-10-22", extension: { list: [true, null, 2] } },
    attachments: [{ name: "sibling.bin", dataUrl: "data:application/octet-stream;base64,AAEC/w==" }],
  };
  saveDraft(store, full);
  assert.deepEqual(readDrafts(store)[0], full);
  const previous = store.raw;
  for (const invalid of [
    { ...full, baseRevision: "stale" },
    { ...full, attachments: [{ name: "sibling.bin", dataUrl: "blob:temporary" }] },
    { ...full, documentId: "bad" },
  ]) {
    assert.throws(() => saveDraft(store, invalid));
    assert.equal(store.raw, previous);
  }
});

test("legacy draft display localizes known-owner images without mutating storage", async () => {
  const { draftDisplayMarkdown } = await import("../src/shared/drafts.mjs");
  const original = '![old](/notion/assets/hash.webp)\n`![example](/notion/assets/hash.webp)`';
  const saved = { ...draft, sourceId: "11111111-1111-4111-8111-111111111111", markdown: original };
  const store = storage();
  saveDraft(store, saved);
  assert.equal(draftDisplayMarkdown(saved), '![old](/content/assets/11111111-1111-4111-8111-111111111111/hash.webp)\n`![example](/notion/assets/hash.webp)`');
  assert.equal(readDrafts(store)[0].markdown, original);
  assert.equal(draftDisplayMarkdown({ ...saved, sourceId: undefined }), original);
  assert.equal(draftDisplayMarkdown({ ...saved, sourceId: undefined, documentId: "22222222-2222-4222-8222-222222222222", documentMode: "legacy" }), original);
  const selected = { ...saved, markdown: '![chosen](./image.png)', attachments: [{ name: "image.png", dataUrl: "data:image/png;base64,AAEC/w==" }] };
  assert.equal(draftDisplayMarkdown(selected), '![chosen](data:image/png;base64,AAEC/w==)');
});
