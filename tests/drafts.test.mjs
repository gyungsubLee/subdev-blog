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
