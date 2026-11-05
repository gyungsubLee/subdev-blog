import test from "node:test";
import assert from "node:assert/strict";
import {
  readDrafts,
  removePostDrafts,
  saveDraft,
  DRAFT_KEY,
} from "../../app/web/src/shared/drafts.mjs";

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

test("batch source deletion clears only matching canonical recovery aliases and legacy drafts", () => {
  const values=new Map([
    ["second-brain:canonical-draft:draft-first",JSON.stringify({sourceDocument:{document:{metadata:{id:"first"}}}})],
    ["second-brain:canonical-draft:second",JSON.stringify({sourceDocument:{document:{metadata:{id:"second"}}}})],
    ["second-brain:canonical-draft:unrelated","{broken"],
    [DRAFT_KEY,JSON.stringify([{...draft,id:"draft-first"},{...draft,id:"draft-keep"}])],
  ]);
  const store={
    get length(){return values.size;},
    key(index){return [...values.keys()][index]??null;},
    getItem(key){return values.get(key)??null;},
    setItem(key,value){values.set(key,value);},
    removeItem(key){values.delete(key);},
  };
  removePostDrafts(store,["first","second"]);
  assert.equal(values.has("second-brain:canonical-draft:draft-first"),false);
  assert.equal(values.has("second-brain:canonical-draft:second"),false);
  assert.equal(values.get("second-brain:canonical-draft:unrelated"),"{broken");
  assert.deepEqual(readDrafts(store).map(item=>item.id),["draft-keep"]);
});
