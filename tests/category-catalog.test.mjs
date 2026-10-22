import assert from "node:assert/strict";
import test from "node:test";
import { loadComponent } from "./support/load-component.mjs";

const { createCategoryGroups, reconcileCategoryGroups } = await loadComponent(
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
