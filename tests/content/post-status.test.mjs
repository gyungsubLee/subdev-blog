import assert from "node:assert/strict";
import test from "node:test";
import { loadComponent } from "../support/load-component.mjs";

test("stored legacy and unknown statuses remain safe two-state display values", async () => {
  const { PostStatus, normalizePostStatus, postStatusLabel } = await loadComponent("app/web/src/shared/post-status.ts");
  for (const value of [undefined, null, "review", "pending", "unknown", {}, 1, "draft"]) {
    assert.equal(normalizePostStatus(value), PostStatus.Draft);
    assert.equal(postStatusLabel(value), "초안 저장");
  }
  assert.equal(normalizePostStatus("published"), PostStatus.Published);
  assert.equal(postStatusLabel("published"), "공개됨");
});
