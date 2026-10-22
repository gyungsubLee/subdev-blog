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
