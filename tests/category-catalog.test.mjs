import assert from "node:assert/strict";
import test from "node:test";
import { loadComponent } from "./support/load-component.mjs";

const { createCategoryGroups, reconcileCategoryGroups, validateCategoryGroups } = await loadComponent(
  "src/features/post-category/catalog.ts",
);

test("known sources use approved groups and unknown sources stay navigable", () => {
  const groups = createCategoryGroups([
    { category: "Spring ( Java )" }, { category: "Main" }, { category: "새 초안" },
  ]);
  assert.equal(groups.find((group) => group.name === "백엔드").categories[0].source, "Spring ( Java )");
  assert.deepEqual(groups.find((group) => group.name === "미분류").categories.map((item) => item.source), ["Main", "새 초안"]);
  assert.equal(new Set(groups.flatMap((group) => [group.id, ...group.categories.map((item) => item.id)])).size, 48);
});

test("rename, parent move, order and empty categories survive reconciliation", () => {
  const groups = [
    { id: "backend", name: "백엔드", categories: [] },
    { id: "tools", name: "도구", categories: [
      { id: "spring", source: "Spring ( Java )", name: "스프링" },
      { id: "empty", source: "빈 분류", name: "빈 분류" },
    ] },
  ];
  const result = reconcileCategoryGroups(groups, [{ category: "Spring ( Java )" }, { category: "Main" }]);
  assert.deepEqual(result[1], groups[1]);
  assert.equal(result.find((group) => group.name === "미분류").categories[0].source, "Main");
  assert.deepEqual(groups[0].categories, [], "reconciliation does not mutate saved state");
  assert.deepEqual(reconcileCategoryGroups(result, [{ category: "Main" }]), result);
});

for (const { source, name } of [
  { source: "새   초안", name: "새 초안" },
  { source: "가".repeat(101), name: "가".repeat(100) },
  { source: "spring ( java )", name: "spring ( java ) (2)" },
]) {
  test(`incoming source gets a valid display name without changing source: ${source.slice(0, 20)}`, () => {
    const result = createCategoryGroups([{ category: source }]);
    const incoming = result.find((group) => group.name === "미분류").categories[0];
    assert.equal(incoming.source, source);
    assert.equal(incoming.name, name);
    assert.equal(validateCategoryGroups(result), true);
    assert.deepEqual(reconcileCategoryGroups(result, [{ category: source }]), result);
  });
}

test("an incoming source does not overwrite an existing alias or block catalog saves", () => {
  const existing = [{
    id: "custom-parent", name: "도구", categories: [
      { id: "stable-spring", source: "Spring ( Java )", name: "새 초안" },
    ],
  }];
  const result = reconcileCategoryGroups(existing, [{ category: "새 초안" }]);
  assert.deepEqual(result[0], existing[0]);
  assert.equal(result[1].categories[0].source, "새 초안");
  assert.equal(result[1].categories[0].name, "새 초안 (2)");
  assert.equal(validateCategoryGroups(result), true);
});

test("blank and truncated incoming names stay unique within the 100-character limit", () => {
  const result = createCategoryGroups([
    { category: "  " }, { category: "" },
    { category: "가".repeat(101) }, { category: "가".repeat(102) },
  ]);
  const incoming = result.find((group) => group.name === "미분류").categories;
  assert.deepEqual(incoming.map((item) => item.name), [
    "이름 없는 분류", "이름 없는 분류 (2)", "가".repeat(100), "가".repeat(96) + " (2)",
  ]);
  assert.deepEqual(incoming.map((item) => item.source), ["  ", "", "가".repeat(101), "가".repeat(102)]);
  assert.equal(validateCategoryGroups(result), true);
});
