import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM('<div id="root"></div>', {
  url: "https://blog.example/#/records",
  pretendToBeVisual: true,
});
test.after(() => dom.window.close());
for (const name of ["window", "document", "navigator", "HTMLElement"]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: RecordsPage } = await loadComponent("src/pages/records/RecordsPage.tsx");
const { useRecordsBrowser } = await loadComponent("src/features/post-category/useRecordsBrowser.ts");
const { categoryNodesToGroups } = await loadComponent("src/features/post-category/hierarchy.ts");
const groups = [
  { id: "backend", name: "백엔드", categories: [
    { id: "java", source: "Spring ( Java )", name: "스프링" },
    { id: "go", source: "Golang", name: "Go" },
  ] },
  { id: "other", name: "미분류", categories: [
    { id: "draft", source: "새 초안", name: "새 초안" },
  ] },
];
const posts = Array.from({ length: 28 }, (_, index) => ({
  id: "record-" + index,
  title: "공통 기록 " + index,
  parentId: null,
  category: index < 24 ? "Spring ( Java )" : index < 27 ? "Golang" : "새 초안",
  markdown: index === 20 ? "본문검색" : "본문",
  excerpt: "요약",
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  path: "record-" + index + ".md",
  url: "",
}));
let latest;
function Harness({ visible = true, items = posts, categoryGroups = groups, categoryNodes }) {
  const browser = useRecordsBrowser(items, categoryGroups, visible);
  latest = browser;
  return visible ? React.createElement(RecordsPage, {
    posts: items,
    catalog: {
      nodes: categoryNodes ?? categoryGroups.flatMap((group) =>
        group.categories.map((category) => ({
          ...category, sources: category.sources ?? [category.source],
        })),
      ),
      groups: categoryGroups,
      error: "",
      save() { return true; },
    },
    browser,
    onWrite() {},
  }) : React.createElement("p", null, "문서 상세");
}
const button = (name) => [...document.querySelectorAll("button")].find(
  (item) => item.getAttribute("aria-label") === name || item.textContent.replace("↓", "").trim() === name,
);
const cardIds = () => [...document.querySelectorAll(".post-card")].map(
  (item) => item.getAttribute("href"),
);
async function click(element) {
  assert.ok(element, "the control is available");
  await act(async () => element.click());
}
async function search(value) {
  const input = document.querySelector('input[type="search"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")
      .set.call(input, value);
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

test("sidebar browsing preserves category filters and visible count", { timeout: 10_000 }, async () => {
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.ok(document.querySelector('[aria-label="사이드바 보기"]'));
    assert.ok(!button("탭 보기"), "tab view is no longer offered");
    assert.ok(!button("섹션 보기"), "section view is no longer offered");
    assert.ok(document.querySelector('aside[aria-label="카테고리"]'));
    assert.equal(cardIds().length, 12);
    assert.equal(document.querySelector('a[href="#/categories"]').textContent.trim(), "카테고리 관리");
    await click(button("스프링"));
    assert.equal(latest.categoryId, "java");
    assert.equal(latest.filteredPosts.length, 24);
    assert.equal(document.querySelector(".post-meta span").textContent, "스프링");
    assert.equal(posts[0].category, "Spring ( Java )", "source data is unchanged");
    await search("공통");
    await click(button("더 보기"));
    const expected = cardIds();
    assert.equal(expected.length, 24);
    assert.equal(document.querySelector('input[type="search"]').value, "공통");
    assert.match(document.querySelector(".result-count").textContent, /24개의 기록/);
    await act(async () => root.render(React.createElement(Harness, { visible: false })));
    await act(async () => root.render(React.createElement(Harness)));
    assert.deepEqual(cardIds(), expected, "holding the hook preserves state across detail visits");
    assert.equal(document.querySelector('input[type="search"]').value, "공통");
    await search("본문검색");
    assert.deepEqual(cardIds(), ["#/post/record-20"]);
    await search("없는검색어");
    assert.ok(document.querySelector(".empty-results"));
    await click(button("전체 글 보기"));
    assert.equal(latest.groupId, null);
    assert.equal(latest.categoryId, null);
    assert.equal(document.querySelector('input[type="search"]').value, "");
    assert.equal(cardIds().length, 12);
  } finally {
    await act(async () => root.unmount());
  }
});

test("sidebar group selection and pagination include every matching record once", { timeout: 10_000 }, async () => {
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await click(button("백엔드"));
    assert.equal(latest.groupId, "backend");
    assert.equal(latest.filteredPosts.length, 27);
    await click(document.querySelector('.records-sidebar > button'));
    assert.equal(cardIds().length, 12);
    await click(button("더 보기"));
    await click(button("더 보기"));
    assert.equal(cardIds().length, 28);
    assert.equal(new Set(cardIds()).size, 28);
    assert.ok(cardIds().includes("#/post/record-27"), "unclassified drafts remain reachable");
    await click(button("새 초안"));
    assert.deepEqual(cardIds(), ["#/post/record-27"]);
    assert.match(document.querySelector(".result-count").textContent, /1개의 기록/);
    const details = document.querySelector(".records-sidebar details");
    assert.ok(details.querySelector("summary"), "groups use native expandable sections");
  } finally {
    await act(async () => root.unmount());
  }
});

test("removed selections fall back to all records and an empty catalog offers writing", { timeout: 10_000 }, async () => {
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await click(button("스프링"));
    await act(async () => root.render(React.createElement(Harness, {
      categoryGroups: [groups[1]],
    })));
    assert.equal(latest.filteredPosts.length, 28);
    await act(async () => root.render(React.createElement(Harness, {
      items: [], categoryGroups: [],
    })));
    assert.ok(button("글 쓰기"));
    assert.equal(cardIds().length, 0);
  } finally {
    await act(async () => root.unmount());
  }
});

test("record cards use canonical ID labels while source filters include new and moved posts", { timeout: 10_000 }, async () => {
  const root = createRoot(document.getElementById("root"));
  const categoryGroups = [{ id: "root", name: "Root", categories: [
    { id: "canonical", source: "Old A", sources: ["Old A", "Old B", "canonical"], name: "Canonical label" },
  ] }];
  const items = [
    { ...posts[0], id: "legacy-a", category: "Old A", categoryId: "canonical" },
    { ...posts[0], id: "legacy-b", category: "Old B", categoryId: "canonical" },
    { ...posts[0], id: "new", category: "canonical", categoryId: "canonical" },
    { ...posts[0], id: "moved", category: "canonical", categoryId: "canonical" },
  ];
  try {
    await act(async () => root.render(React.createElement(Harness, { items, categoryGroups })));
    await click(button("Canonical label"));
    assert.equal(latest.filteredPosts.length, 4);
    assert.equal(cardIds().length, 4);
    assert.ok([...document.querySelectorAll(".post-meta span:first-child")].every((node) => node.textContent === "Canonical label"));
    assert.deepEqual(items.map((post) => post.category), ["Old A", "Old B", "canonical", "canonical"]);
  } finally {
    await act(async () => root.unmount());
  }
});

test("sidebar preserves managed hierarchy without duplicate roots or synthetic whole-category controls", { timeout: 10_000 }, async () => {
  const categoryNodes = [
    { id: "unclassified", name: "미분류", parentId: null, sources: ["root-source"] },
    { id: "depth1", name: "depth1", parentId: "unclassified", sources: ["depth1-source"] },
    { id: "depth2", name: "depth2", parentId: "depth1", sources: ["depth2-source"] },
    { id: "depth3", name: "depth3", parentId: "depth2", sources: [] },
    { id: "depth4", name: "depth4", parentId: "depth3", sources: [] },
    { id: "depth5", name: "depth5", parentId: "depth4", sources: ["depth5-source"] },
    { id: "guide", name: "안내", parentId: null, sources: ["guide-source"] },
  ];
  const categoryGroups = categoryNodesToGroups(categoryNodes);
  const items = [
    { ...posts[0], id: "at-root", category: "root-source" },
    { ...posts[0], id: "at-depth1", category: "depth1-source" },
    { ...posts[0], id: "at-depth2", category: "depth2-source" },
    { ...posts[0], id: "at-depth5", category: "depth5-source" },
    { ...posts[0], id: "guide", category: "guide-source" },
  ];
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness, {
      items, categoryGroups, categoryNodes,
    })));
    const sidebar = document.querySelector(".records-sidebar");
    const navigationNames = [...sidebar.querySelectorAll("button")]
      .filter((control) => control !== sidebar.querySelector(":scope > button"))
      .map((control) => control.getAttribute("aria-label") ?? control.textContent.trim());
    assert.deepEqual(navigationNames, [
      "미분류", "depth1", "depth2", "depth3", "depth4", "depth5", "안내",
    ], "each managed category has one control and no synthetic whole-category row");

    const children = button("depth1").closest(".records-tree-children");
    assert.ok(children, "depth1 belongs to the root's child list");
    assert.ok(
      children.closest("details").querySelector("summary button") === button("미분류"),
      "the root button belongs to its branch",
    );
    assert.deepEqual(
      ["depth1", "depth2", "depth3", "depth4", "depth5"].map((name) => button(name).style.paddingLeft),
      ["12px", "28px", "44px", "60px", "76px"],
    );
    assert.ok(button("안내").closest("details") === null, "a leaf root has no disclosure");

    await click(button("미분류"));
    assert.equal(latest.groupId, "unclassified");
    assert.equal(latest.categoryId, null, "the root selects its complete branch");
    assert.deepEqual(cardIds(), [
      "#/post/at-root", "#/post/at-depth1", "#/post/at-depth2", "#/post/at-depth5",
    ]);
    await click(button("depth2"));
    assert.deepEqual(cardIds(), ["#/post/at-depth2", "#/post/at-depth5"]);
    await click(button("안내"));
    assert.equal(latest.groupId, "guide");
    assert.equal(latest.categoryId, null);
    assert.deepEqual(cardIds(), ["#/post/guide"]);
  } finally {
    await act(async () => root.unmount());
  }
});
