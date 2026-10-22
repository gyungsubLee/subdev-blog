import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM('<div id="root"></div>', { url: "https://blog.example/#/categories" });
for (const name of ["window", "document", "navigator", "HTMLElement"]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name], configurable: true,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: CategoriesPage } = await loadComponent("src/pages/categories/CategoriesPage.tsx");
const { useCategoryCatalog } = await loadComponent("src/features/post-category/useCategoryCatalog.ts");
const KEY = "second-brain:categories:v1";
const posts = [{
  id: "spring-post", category: "Spring ( Java )", title: "스프링 원문", parentId: "original-parent",
  createdAt: "2026-10-23", updatedAt: "2026-10-23", markdown: "", path: "spring.md", url: "https://notion.example/spring", excerpt: "",
}];
let current;
function Harness() {
  current = useCategoryCatalog(posts);
  return React.createElement(CategoriesPage, { posts, catalog: current });
}
const button = (text) => [...document.querySelectorAll("button")].find((element) => element.textContent.trim() === text);
async function click(element) { assert.ok(element); await act(async () => element.click()); }
async function input(label, value) {
  const element = document.getElementById(document.querySelector(`label[data-field="${label}"]`).htmlFor);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window[element.tagName === "SELECT" ? "HTMLSelectElement" : "HTMLInputElement"].prototype, "value").set.call(element, value);
    element.dispatchEvent(new dom.window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
async function mount() {
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(Harness)));
  return root;
}
async function submit() {
  await act(async () => document.querySelector("form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })));
}

const dragGroups = [
  { id: "group:backend", name: "백엔드", categories: [
    { id: "spring", source: "Spring ( Java )", name: "Spring ( Java )" },
    { id: "nest", source: "Nest.js", name: "Nest.js" },
    { id: "go", source: "Golang", name: "Golang" },
  ] },
  { id: "group:frontend", name: "프론트엔드", categories: [
    { id: "react", source: "리액트", name: "리액트" },
    { id: "next", source: "Next.js", name: "Next.js" },
  ] },
  { id: "group:learning-tools", name: "학습·도구", categories: [] },
];
function seedDragGroups() {
  dom.window.localStorage.setItem(KEY, JSON.stringify({ version: 1, groups: dragGroups }));
}
const categoryRow = (source) => [...document.querySelectorAll("[data-category-source]")]
  .find((row) => row.dataset.categorySource === source);
const groupRow = (name) => [...document.querySelectorAll(".category-manager-group")]
  .find((row) => row.querySelector(".category-row-select > span:last-child").textContent === name);
const dropHint = () => document.querySelector('[role="status"]').textContent;
const groupSources = (name) => current.groups.find((group) => group.name === name).categories.map((item) => item.source);
async function drag(element, type, { clientY = 110, relatedTarget = null } = {}) {
  assert.ok(element);
  // jsdom has no layout or DataTransfer; keep the real React handlers and catalog.
  element.getBoundingClientRect = () => new dom.window.DOMRect(0, 100, 200, 40);
  const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientY, relatedTarget });
  Object.defineProperty(event, "dataTransfer", { value: { setData() {} } });
  await act(async () => { element.dispatchEvent(event); });
  return event;
}

for (const scenario of [
  { source: "Spring ( Java )", target: "Golang", position: "after", clientY: 130, expected: ["Nest.js", "Golang", "Spring ( Java )"] },
  { source: "Spring ( Java )", target: "Golang", position: "before", clientY: 110, expected: ["Nest.js", "Spring ( Java )", "Golang"] },
  { source: "Golang", target: "Spring ( Java )", position: "before", clientY: 110, expected: ["Golang", "Spring ( Java )", "Nest.js"] },
]) {
  test(`category ${scenario.position} preview matches the saved order for ${scenario.source}`, async () => {
    seedDragGroups();
    const root = await mount();
    try {
      const source = categoryRow(scenario.source);
      const target = categoryRow(scenario.target);
      await drag(source, "dragstart");
      await drag(target, "dragover", scenario);
      assert.equal(target.dataset.dropPosition, scenario.position);
      assert.equal(source.dataset.dragging, "true");
      assert.ok(dropHint().includes(`백엔드 · ${scenario.target} ${scenario.position === "before" ? "앞" : "뒤"}`));
      await drag(target, "drop", scenario);
      assert.deepEqual(groupSources("백엔드"), scenario.expected);
      assert.equal(document.querySelector("[data-drop-position]"), null);
      assert.equal(document.querySelector('[data-dragging="true"]'), null);
    } finally { await act(async () => root.unmount()); }
  });
}

for (const scenario of [
  { position: "before", clientY: 110, expected: ["리액트", "Spring ( Java )", "Next.js"] },
  { position: "after", clientY: 130, expected: ["리액트", "Next.js", "Spring ( Java )"] },
]) {
  test(`cross-parent ${scenario.position} preview preserves IDs and original sources`, async () => {
    seedDragGroups();
    const root = await mount();
    try {
      await click(groupRow("프론트엔드").querySelector("button"));
      const target = categoryRow("Next.js");
      await drag(categoryRow("Spring ( Java )"), "dragstart");
      await drag(target, "dragover", scenario);
      assert.equal(target.dataset.dropPosition, scenario.position);
      assert.ok(dropHint().includes("프론트엔드 · Next.js"));
      await drag(target, "drop", scenario);
      assert.deepEqual(groupSources("프론트엔드"), scenario.expected);
      assert.deepEqual(groupSources("백엔드"), ["Nest.js", "Golang"]);
      assert.equal(document.getElementById("category-parent").value, "group:frontend");
      assert.deepEqual(current.groups.flatMap((group) => group.categories).sort((a, b) => a.id.localeCompare(b.id)),
        dragGroups.flatMap((group) => group.categories).sort((a, b) => a.id.localeCompare(b.id)));
      assert.equal(posts[0].parentId, "original-parent");
    } finally { await act(async () => root.unmount()); }
  });
}

for (const expanded of [false, true]) {
  test(`group header previews append after the ${expanded ? "expanded children" : "collapsed header"}`, async () => {
    seedDragGroups();
    const root = await mount();
    try {
      const target = groupRow("프론트엔드");
      if (expanded) await click(target.querySelector("button"));
      await drag(categoryRow("Spring ( Java )"), "dragstart");
      await drag(target, "dragover");
      assert.equal(target.dataset.dropTarget, "true");
      assert.equal(target.parentElement.dataset.dropPosition, "append");
      assert.equal(target.parentElement.lastElementChild.tagName, expanded ? "UL" : "DIV");
      assert.equal(dropHint(), "프론트엔드 맨 끝으로 이동");
      await drag(target, "drop");
      assert.deepEqual(groupSources("프론트엔드"), ["리액트", "Next.js", "Spring ( Java )"]);
      assert.equal(document.querySelector("[data-drop-position]"), null);
      assert.equal(document.querySelector('[data-drop-target="true"]'), null);
    } finally { await act(async () => root.unmount()); }
  });
}

for (const scenario of [
  { source: "학습·도구", target: "백엔드", position: "before", clientY: 110, expected: ["학습·도구", "백엔드", "프론트엔드"] },
  { source: "백엔드", target: "프론트엔드", position: "after", clientY: 130, expected: ["프론트엔드", "백엔드", "학습·도구"] },
]) {
  test(`group ${scenario.position} preview marks the whole group boundary`, async () => {
    seedDragGroups();
    const root = await mount();
    try {
      const target = groupRow(scenario.target);
      if (target.querySelector("button").getAttribute("aria-expanded") === "false") await click(target.querySelector("button"));
      await drag(groupRow(scenario.source), "dragstart");
      await drag(target, "dragover", scenario);
      assert.equal(target.parentElement.dataset.dropPosition, scenario.position);
      assert.equal(target.dataset.dropPosition, undefined);
      assert.equal(target.parentElement.lastElementChild.tagName, "UL");
      assert.ok(dropHint().includes(`${scenario.target} ${scenario.position === "before" ? "앞" : "뒤"}`));
      await drag(target, "drop", scenario);
      assert.deepEqual(current.groups.map((group) => group.name), scenario.expected);
    } finally { await act(async () => root.unmount()); }
  });
}

test("drag feedback follows the target and clears on leave, self, background and cancellation", async () => {
  seedDragGroups();
  const root = await mount();
  try {
    const source = categoryRow("Spring ( Java )");
    const first = categoryRow("Nest.js");
    const second = categoryRow("Golang");
    await drag(source, "dragstart");
    await drag(first, "dragover");
    assert.equal(first.dataset.dropPosition, "before");
    await drag(first, "dragleave", { relatedTarget: first.querySelector("button") });
    assert.equal(first.dataset.dropPosition, "before");
    await drag(second, "dragover", { clientY: 130 });
    assert.equal(first.dataset.dropPosition, undefined);
    assert.equal(second.dataset.dropPosition, "after");
    await drag(second, "dragleave", { relatedTarget: document.body });
    assert.equal(document.querySelector("[data-drop-position]"), null);
    assert.equal(dropHint(), "");
    await drag(first, "dragover");
    await drag(source, "dragover");
    assert.equal(document.querySelector("[data-drop-position]"), null);
    await drag(first, "dragover");
    await drag(document.querySelector(".category-tree-tools"), "dragover");
    assert.equal(document.querySelector("[data-drop-position]"), null);
    await drag(first, "dragover");
    await drag(source, "dragend");
    assert.equal(document.querySelector("[data-drop-position]"), null);
    assert.equal(document.querySelector('[data-dragging="true"]'), null);
    assert.equal(dropHint(), "");
    const external = await drag(first, "dragover");
    assert.equal(external.defaultPrevented, false);
    assert.equal(document.querySelector("[data-drop-position]"), null);
    assert.equal(dropHint(), "");
  } finally { await act(async () => root.unmount()); }
});

test("a group dragged onto a category has no destination and cannot change the catalog", async () => {
  seedDragGroups();
  const root = await mount();
  try {
    const before = current.groups;
    await drag(groupRow("학습·도구"), "dragstart");
    await drag(groupRow("백엔드"), "dragover");
    assert.ok(document.querySelector("[data-drop-position]"));
    const target = categoryRow("Nest.js");
    const unsupported = await drag(target, "dragover");
    assert.equal(unsupported.defaultPrevented, false);
    assert.equal(document.querySelector("[data-drop-position]"), null);
    assert.equal(dropHint(), "");
    await drag(target, "drop");
    assert.equal(current.groups, before);
    assert.equal(document.querySelector('[data-dragging="true"]'), null);
  } finally { await act(async () => root.unmount()); }
});

test("a failed drop clears its destination while keeping the saved order and storage error", async () => {
  seedDragGroups();
  const root = await mount();
  const original = dom.window.Storage.prototype.setItem;
  try {
    const before = current.groups;
    const saved = dom.window.localStorage.getItem(KEY);
    const target = categoryRow("Golang");
    await drag(categoryRow("Spring ( Java )"), "dragstart");
    await drag(target, "dragover", { clientY: 130 });
    assert.equal(target.dataset.dropPosition, "after");
    dom.window.Storage.prototype.setItem = () => { throw new dom.window.DOMException("full", "QuotaExceededError"); };
    await drag(target, "drop", { clientY: 130 });
    assert.equal(current.groups, before);
    assert.equal(dom.window.localStorage.getItem(KEY), saved);
    assert.ok(document.querySelector('[role="alert"]').textContent.includes("저장하지 못했습니다"));
    assert.equal(document.querySelector("[data-drop-position]"), null);
    assert.equal(document.querySelector('[data-dragging="true"]'), null);
    assert.equal(dropHint(), "");
  } finally {
    dom.window.Storage.prototype.setItem = original;
    await act(async () => root.unmount());
  }
});

test("manager renames, moves and reorders by stable source, then persists new empty categories", async () => {
  dom.window.localStorage.clear();
  let root = await mount();
  try {
    await click(document.querySelector('[data-category-source="Spring ( Java )"] button'));
    await input("name", "  스프링   학습  ");
    const toolsId = current.groups.find((group) => group.name === "학습·도구").id;
    await input("parent", toolsId);
    await submit();
    assert.equal(document.querySelector('a[href="#/post/spring-post"]').textContent.trim(), "스프링 원문");
    assert.equal(posts[0].parentId, "original-parent");
    const spring = current.groups.find((group) => group.id === toolsId).categories.at(-1);
    assert.equal(spring.name, "스프링 학습");
    assert.equal(spring.source, "Spring ( Java )");
    await click(document.querySelector('[data-category-source="Spring ( Java )"] button[aria-label$="위로 이동"]'));
    assert.equal(current.groups.find((group) => group.id === toolsId).categories.at(-2).id, spring.id);
    await click(button("+ 분류 추가"));
    await input("name", "새 분류");
    await submit();
    const added = current.groups.flatMap((group) => group.categories).find((item) => item.source === "새 분류");
    assert.ok(added);
    assert.notEqual(added.id, added.name);
    await act(async () => root.unmount());
    root = await mount();
    assert.ok(current.groups.flatMap((group) => group.categories).find((item) => item.id === added.id));
    assert.equal(JSON.parse(dom.window.localStorage.getItem(KEY)).version, 1);
  } finally { await act(async () => root.unmount()); }
});

test("invalid names are rejected without changing saved settings", async () => {
  dom.window.localStorage.clear();
  const root = await mount();
  try {
    await click(button("+ 분류 추가"));
    for (const name of [" ", "x".repeat(101), "Spring ( Java )"]) {
      await input("name", name);
      await submit();
      assert.ok(document.querySelector('[role="alert"]'));
      assert.equal(dom.window.localStorage.getItem(KEY), null);
    }
  } finally { await act(async () => root.unmount()); }
});

test("corrupt, duplicate and unsupported storage are preserved and block saves", async () => {
  const badValues = ["{broken", JSON.stringify({ version: 2, groups: [] }), JSON.stringify({ version: 1, groups: [
    { id: "g", name: "그룹", categories: [{ id: "x", source: "a", name: "a" }, { id: "x", source: "b", name: "b" }] },
  ] }), JSON.stringify({ version: 1, groups: [
    { id: "g", name: "그룹", categories: [{ id: "a", source: "same", name: "a" }, { id: "b", source: "same", name: "b" }] },
  ] })];
  for (const value of badValues) {
    dom.window.localStorage.setItem(KEY, value);
    const root = await mount();
    try {
      assert.ok(current.error);
      let saved;
      await act(async () => { saved = current.save(current.groups); });
      assert.equal(saved, false);
      assert.equal(dom.window.localStorage.getItem(KEY), value);
    } finally { await act(async () => root.unmount()); }
  }
});

test("quota failure keeps the last catalog and displays a storage error", async () => {
  dom.window.localStorage.clear();
  const root = await mount();
  const original = dom.window.Storage.prototype.setItem;
  try {
    const before = current.groups;
    dom.window.Storage.prototype.setItem = () => { throw new dom.window.DOMException("full", "QuotaExceededError"); };
    await click(button("+ 분류 추가"));
    await input("name", "실패 분류");
    await submit();
    assert.equal(current.groups, before);
    assert.ok(current.error);
    assert.ok(document.querySelector('[role="alert"]'));
    assert.equal(dom.window.localStorage.getItem(KEY), null);
    assert.equal(document.querySelector('[role="status"]')?.textContent.includes("저장했습니다"), false);
  } finally {
    dom.window.Storage.prototype.setItem = original;
    await act(async () => root.unmount());
  }
});

test("dragging the selected category updates its parent without losing an unfinished name", async () => {
  dom.window.localStorage.clear();
  const root = await mount();
  try {
    await input("name", "편집 중인 이름");
    const source = document.querySelector('[data-category-source="Spring ( Java )"]');
    const target = [...document.querySelectorAll(".category-manager-group")].find((row) => row.textContent.includes("프론트엔드"));
    const frontendId = current.groups.find((group) => group.name === "프론트엔드").id;
    await act(async () => {
      const start = new dom.window.Event("dragstart", { bubbles: true });
      Object.defineProperty(start, "dataTransfer", { value: { setData() {} } });
      source.dispatchEvent(start);
      target.dispatchEvent(new dom.window.Event("drop", { bubbles: true, cancelable: true }));
    });
    assert.ok(current.groups.find((group) => group.id === frontendId).categories.some((item) => item.source === "Spring ( Java )"));
    assert.equal(document.getElementById("category-parent").value, frontendId);
    assert.equal(document.getElementById("category-name").value, "편집 중인 이름");
    await submit();
    assert.equal(current.groups.find((group) => group.id === frontendId).categories.at(-1).name, "편집 중인 이름");
  } finally { await act(async () => root.unmount()); }
});

test("unusual draft sources and an alias collision still allow unrelated catalog saves", async () => {
  dom.window.localStorage.clear();
  dom.window.localStorage.setItem(KEY, JSON.stringify({ version: 1, groups: [{
    id: "saved-parent", name: "백엔드", categories: [
      { id: "saved-spring", source: "Spring ( Java )", name: "새 초안" },
    ],
  }] }));
  const originalLength = posts.length;
  const sources = ["새   초안", "가".repeat(101), "spring ( java )", "새 초안"];
  posts.push(...sources.map((category, index) => ({
    ...posts[0], id: "new-draft-" + index, title: "새 초안 " + index, category,
  })));
  const root = await mount();
  try {
    let saved;
    await act(async () => { saved = current.save([...current.groups].reverse()); });
    assert.equal(saved, true);
    assert.equal(current.error, "");
    const persisted = JSON.parse(dom.window.localStorage.getItem(KEY));
    assert.equal(persisted.groups[0].name, "미분류");
    assert.deepEqual(persisted.groups[0].categories.map((item) => item.source), sources);
    assert.deepEqual(persisted.groups[1].categories, [
      { id: "saved-spring", source: "Spring ( Java )", name: "새 초안" },
    ]);
  } finally {
    await act(async () => root.unmount());
    posts.splice(originalLength);
  }
});
