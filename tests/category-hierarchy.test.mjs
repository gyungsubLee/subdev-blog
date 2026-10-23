import assert from "node:assert/strict";
import test from "node:test";
import { loadComponent } from "./support/load-component.mjs";
const tree = await loadComponent("src/features/post-category/hierarchy.ts");
const legacy = [
  {
    id: "backend",
    name: "백엔드",
    categories: [
      { id: "java", name: "Java", source: "Java 원문" },
      { id: "spring", name: "스프링", source: "Spring 원문" },
    ],
  },
  { id: "tools", name: "도구", categories: [] },
];
const nodes = [
  { id: "backend", name: "백엔드", parentId: null, sources: [] },
  { id: "java", name: "Java", parentId: "backend", sources: ["Java 원문"] },
  { id: "spring", name: "스프링", parentId: "java", sources: ["Spring 원문"] },
  { id: "tools", name: "도구", parentId: null, sources: [] },
];
test("migrate legacy aliases and preserve sources and order", () => {
  assert.deepEqual(tree.migrateCategoryGroups(legacy), [
    nodes[0],
    nodes[1],
    { ...nodes[2], parentId: "backend" },
    nodes[3],
  ]);
});
test("moving a parent keeps the complete branch and rejects cycles", () => {
  const moved = tree.moveCategoryNode(nodes, "java", "tools");
  assert.equal(moved.find((n) => n.id === "java").parentId, "tools");
  assert.equal(moved.find((n) => n.id === "spring").parentId, "java");
  assert.throws(() => tree.moveCategoryNode(nodes, "backend", "spring"));
  assert.equal(nodes[1].parentId, "backend");
  assert.deepEqual(
    tree
      .moveCategoryNode(nodes, "tools", null, "backend")
      .filter((n) => n.parentId === null)
      .map((n) => n.id),
    ["tools", "backend"],
  );
});
test("delete lifts children and retains source ownership across reconciliation", () => {
  const removed = tree.removeCategoryNode(nodes, "java");
  assert.equal(removed.find((n) => n.id === "spring").parentId, "backend");
  const unclassified = removed.find((n) => n.id === "group:unclassified");
  assert.deepEqual(unclassified.sources, ["Java 원문"]);
  assert.deepEqual(
    tree.reconcileCategoryNodes(removed, [
      { category: "Java 원문" },
      { category: "Spring 원문" },
    ]),
    removed,
  );
  assert.equal(tree.validateCategoryNodes(removed), true);
});
test("untrusted storage rejects cycles, orphans, duplicate IDs, names and sources", () => {
  assert.equal(tree.validateCategoryNodes(nodes), true);
  for (const invalid of [
    nodes.map((n) => (n.id === "backend" ? { ...n, parentId: "spring" } : n)),
    nodes.map((n) => (n.id === "java" ? { ...n, parentId: "absent" } : n)),
    [...nodes, { ...nodes[0] }],
    [...nodes, { id: "another", name: "java", parentId: null, sources: [] }],
    [
      ...nodes,
      {
        id: "another",
        name: "다른 분류",
        parentId: null,
        sources: ["Spring 원문"],
      },
    ],
  ])
    assert.equal(tree.validateCategoryNodes(invalid), false);
});
test("records adapter includes descendant sources and promoted root documents", () => {
  const groups = tree.categoryNodesToGroups(nodes);
  const java = groups[0].categories.find((n) => n.id === "java");
  assert.equal(tree.categoryMatches(java, "Spring 원문"), true);
  const promoted = tree.categoryNodesToGroups(
    tree.moveCategoryNode(nodes, "java", null),
  );
  assert.equal(
    promoted
      .find((n) => n.id === "java")
      .categories.some((n) => tree.categoryMatches(n, "Java 원문")),
    true,
  );
  assert.equal(
    promoted
      .find((n) => n.id === "java")
      .categories.some((n) => tree.categoryMatches(n, "Spring 원문")),
    true,
  );
});
test("drag projection can promote a deep node and nest a root without cycling", () => {
  assert.deepEqual(
    tree.projectCategoryDrop(nodes, "spring", "tools", "after", 0),
    { parentId: null, beforeId: null, position: "after", depth: 0 },
  );
  assert.deepEqual(
    tree.projectCategoryDrop(nodes, "tools", "java", "before", 2),
    { parentId: "java", beforeId: null, position: "inside", depth: 2 },
  );
  assert.equal(
    tree.projectCategoryDrop(nodes, "backend", "spring", "after", 0),
    null,
  );
});
test("legacy name collisions migrate without losing IDs, aliases or assignments", () => {
  const groups = [
    {
      id: "g",
      name: "Java",
      categories: [
        { id: "j", source: "Java raw", name: "Java" },
        { id: "s", source: "Spring raw", name: "Java (2)" },
      ],
    },
  ];
  const migrated = tree.migrateCategoryGroups(groups);
  assert.equal(tree.validateCategoryNodes(migrated), true);
  assert.deepEqual(
    migrated.map((n) => n.id),
    ["g", "j", "s"],
  );
  assert.deepEqual(
    migrated.flatMap((n) => n.sources),
    ["Java raw", "Spring raw"],
  );
  assert.equal(migrated[0].name, "Java");
  assert.equal(migrated[2].name, "Java (2)");
});
