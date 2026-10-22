import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM('<div id="root"></div>', {
  url: "https://blog.example/#/records",
  pretendToBeVisual: true,
});
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
function Harness({ visible = true, items = posts, categoryGroups = groups }) {
  const browser = useRecordsBrowser(items, categoryGroups, visible);
  latest = browser;
  return visible ? React.createElement(RecordsPage, {
    posts: items,
    catalog: { groups: categoryGroups, error: "", save() { return true; } },
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

test("category aliases still select source documents and views preserve filters and visible count", async () => {
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(button("사이드바 보기").getAttribute("aria-pressed"), "true");
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
    for (const name of ["탭 보기", "섹션 보기", "사이드바 보기"]) {
      await click(button(name));
      assert.equal(button(name).getAttribute("aria-pressed"), "true");
      assert.equal(document.querySelector('input[type="search"]').value, "공통");
      assert.deepEqual(cardIds(), expected);
      assert.match(document.querySelector(".result-count").textContent, /24개의 기록/);
    }
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

test("group selection and section pagination include every matching record once", async () => {
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await click(button("탭 보기"));
    await click(button("백엔드"));
    assert.equal(latest.groupId, "backend");
    assert.equal(latest.filteredPosts.length, 27);
    await click(button("전체"));
    await click(button("섹션 보기"));
    assert.equal(cardIds().length, 12);
    await click(button("더 보기"));
    await click(button("더 보기"));
    assert.equal(cardIds().length, 28);
    assert.equal(new Set(cardIds()).size, 28);
    assert.ok(cardIds().includes("#/post/record-27"), "unclassified drafts remain reachable");
    await click(button("새 초안"));
    assert.deepEqual(cardIds(), ["#/post/record-27"]);
    assert.match(document.querySelector(".result-count").textContent, /1개의 기록/);
    const details = document.querySelector(".records-section");
    assert.ok(details.querySelector("summary"), "groups use native expandable sections");
  } finally {
    await act(async () => root.unmount());
  }
});

test("removed selections fall back to all records and an empty catalog offers writing", async () => {
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
