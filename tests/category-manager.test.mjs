import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const dom = new JSDOM('<div id="root"></div>', {
  url: "https://blog.example//categories",
  pretendToBeVisual: true,
});
for (const name of ["window", "document", "navigator", "HTMLElement"]) {
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.matchMedia = () => ({ matches: false });
dom.window.scrollBy = () => {};
dom.window.HTMLElement.prototype.setPointerCapture = function () {};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: CategoriesPage } = await loadComponent(
  "src/pages/categories/CategoriesPage.tsx",
);
const { useCategoryCatalog } = await loadComponent(
  "src/features/post-category/useCategoryCatalog.ts",
);
const LEGACY = "second-brain:categories:v1";
const KEY = "second-brain:categories:v2";
const posts = [
  {
    id: "spring-post",
    category: "Spring ( Java )",
    title: "스프링 원문",
    parentId: "original-parent",
  },
];
const groups = [
  {
    id: "backend",
    name: "백엔드",
    categories: [{ id: "spring", source: "Spring ( Java )", name: "스프링" }],
  },
  { id: "tools", name: "도구", categories: [] },
];
let current;
function Harness({ visible = true, items = posts, categories = [] }) {
  current = useCategoryCatalog(items, categories);
  return visible
    ? React.createElement(CategoriesPage, { posts: items, catalog: current })
    : React.createElement("p", null, "다른 화면");
}
async function mount() {
  dom.window.localStorage.clear();
  dom.window.localStorage.setItem(
    LEGACY,
    JSON.stringify({ version: 1, groups }),
  );
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(Harness)));
  return root;
}
const row = (name) =>
  [...document.querySelectorAll(".category-row")].find((item) =>
    item.querySelector(".row-name").textContent.startsWith(name),
  );
const button = (text) =>
  [...document.querySelectorAll("button")].find(
    (item) => item.textContent.trim() === text,
  );
async function click(element) {
  assert.ok(element);
  await act(async () => element.click());
}
async function input(value) {
  const field = document.getElementById("inline-name");
  assert.ok(field);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set.call(field, value);
    field.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    document
      .querySelector("#inline-form")
      .dispatchEvent(
        new dom.window.Event("submit", { bubbles: true, cancelable: true }),
      ),
  );
}
async function key(name, key) {
  await act(async () =>
    row(name)
      .querySelector(".grip")
      .dispatchEvent(
        new dom.window.KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
        }),
      ),
  );
}
async function add(name) {
  await click(document.getElementById("add-bottom"));
  await input(name);
  await submit();
}

test("approved list edits are staged until save and migrate v1 without overwriting it", async () => {
  const root = await mount();
  try {
    const original = dom.window.localStorage.getItem(LEGACY);
    await add("새 분류");
    assert.ok(row("새 분류"));
    assert.equal(current.dirty, true);
    assert.equal(dom.window.localStorage.getItem(KEY), null);
    assert.equal(
      current.nodes.some((n) => n.name === "새 분류"),
      false,
    );
    await click(row("새 분류").querySelector('[data-action="edit"]'));
    await input("  이름   변경  ");
    await submit();
    assert.ok(row("이름 변경"));
    await click(button("변경사항 저장"));
    assert.equal(current.dirty, false);
    assert.ok(
      JSON.parse(dom.window.localStorage.getItem(KEY)).nodes.some(
        (n) => n.name === "이름 변경",
      ),
    );
    assert.equal(dom.window.localStorage.getItem(LEGACY), original);
    assert.equal(posts[0].parentId, "original-parent");
    assert.equal(
      document.querySelector(
        '.category-editor, #category-parent, [data-action="manage"], [data-action="move"]',
      ),
      null,
    );
    assert.equal(document.querySelector(".all-row button"), null);
  } finally {
    await act(async () => root.unmount());
  }
});
test("keyboard branch moves preserve sources and undo across category page round trips", async () => {
  const root = await mount();
  try {
    await add("새 분류");
    await key("새 분류", "ArrowDown");
    await key("새 분류", "ArrowRight");
    const added = current.draftNodes.find((n) => n.name === "새 분류");
    assert.equal(added.parentId, "backend");
    await key("백엔드", "ArrowDown");
    await key("백엔드", "ArrowRight");
    assert.equal(
      current.draftNodes.find((n) => n.id === "backend").parentId,
      "tools",
    );
    assert.equal(
      current.draftNodes.find((n) => n.id === added.id).parentId,
      "backend",
    );
    await act(async () =>
      root.render(React.createElement(Harness, { visible: false })),
    );
    await act(async () => root.render(React.createElement(Harness)));
    assert.equal(current.dirty, true);
    assert.ok(current.draftNodes.some((n) => n.id === added.id));
    await click(button("실행 취소"));
    assert.equal(
      current.draftNodes.find((n) => n.id === "backend").parentId,
      null,
    );
    assert.deepEqual(
      current.draftNodes.find((n) => n.id === "spring").sources,
      ["Spring ( Java )"],
    );
  } finally {
    await act(async () => root.unmount());
  }
});
test("delete confirms, lifts children and retains source ownership without changing posts", async () => {
  const root = await mount();
  try {
    await click(button("전체 펼치기"));
    await click(row("스프링").querySelector('[data-action="add"]'));
    await input("하위");
    await submit();
    await click(row("스프링").querySelector('[data-action="delete"]'));
    assert.equal(document.getElementById("delete-dialog").open, true);
    await click(document.getElementById("confirm-delete"));
    assert.equal(
      current.draftNodes.some((n) => n.id === "spring"),
      false,
    );
    assert.equal(
      current.draftNodes.find((n) => n.name === "하위").parentId,
      "backend",
    );
    assert.deepEqual(
      current.draftNodes.find((n) => n.id === "group:unclassified").sources,
      ["Spring ( Java )"],
    );
    await click(button("변경사항 저장"));
    assert.equal(current.error, "");
    assert.equal(posts[0].category, "Spring ( Java )");
    await click(button("실행 취소"));
    assert.ok(current.draftNodes.some((n) => n.id === "spring"));
    await click(button("변경사항 저장"));
    assert.equal(current.error, "");
    assert.deepEqual(
      JSON.parse(dom.window.localStorage.getItem(KEY)).nodes.find(
        (n) => n.id === "spring",
      ).sources,
      ["Spring ( Java )"],
    );
  } finally {
    await act(async () => root.unmount());
  }
});
test("failed storage save keeps draft, undo history and original settings", async () => {
  const root = await mount();
  const original = dom.window.Storage.prototype.setItem;
  try {
    await add("저장 검사");
    dom.window.Storage.prototype.setItem = () => {
      throw new Error("full");
    };
    await click(button("변경사항 저장"));
    assert.ok(current.error.includes("저장하지 못했습니다"));
    assert.ok(row("저장 검사"));
    assert.equal(current.canUndo, true);
    assert.equal(current.dirty, true);
    assert.equal(dom.window.localStorage.getItem(KEY), null);
    await click(button("실행 취소"));
    assert.equal(
      current.draftNodes.some((n) => n.name === "저장 검사"),
      false,
    );
  } finally {
    dom.window.Storage.prototype.setItem = original;
    await act(async () => root.unmount());
  }
});
test("blank, duplicate and long names never alter a draft", async () => {
  const root = await mount();
  try {
    await click(document.getElementById("add-bottom"));
    for (const name of [" ", "백엔드", "가".repeat(101)]) {
      await input(name);
      await submit();
      assert.equal(current.dirty, false);
      assert.match(
        document.querySelector('[role="alert"]').textContent,
        /이름|분류/,
      );
    }
    await click(button("취소"));
    assert.equal(document.querySelector("#inline-form"), null);
  } finally {
    await act(async () => root.unmount());
  }
});
test("corrupt v2 settings are preserved and source reassignment is rejected", async () => {
  const root = await mount();
  try {
    let success;
    await act(async () => {
      success = current.saveNodes(
        current.nodes.map((n) =>
          n.id === "spring" ? { ...n, sources: ["changed"] } : n,
        ),
      );
    });
    assert.equal(success, false);
    assert.match(current.error, /원문/);
  } finally {
    await act(async () => root.unmount());
  }
  dom.window.localStorage.setItem(KEY, "{broken");
  const next = createRoot(document.getElementById("root"));
  try {
    await act(async () => next.render(React.createElement(Harness)));
    assert.match(current.error, /읽지 못했습니다/);
    assert.equal(current.saveNodes(current.nodes), false);
    assert.equal(dom.window.localStorage.getItem(KEY), "{broken");
  } finally {
    await act(async () => next.unmount());
  }
});
test("pointer drag promotes a source category and clears the insertion marker on drop", async () => {
  const root = await mount();
  try {
    await click(button("전체 펼치기"));
    document.querySelector(".tree-frame").getBoundingClientRect = () =>
      new dom.window.DOMRect(0, 80, 300, 250);
    document.querySelector(".all-row").getBoundingClientRect = () =>
      new dom.window.DOMRect(0, 80, 300, 40);
    for (const [name, top] of [
      ["백엔드", 140],
      ["스프링", 180],
      ["도구", 220],
    ])
      row(name).getBoundingClientRect = () =>
        new dom.window.DOMRect(0, top, 300, 40);
    await act(async () =>
      row("스프링")
        .querySelector(".grip")
        .dispatchEvent(
          new dom.window.MouseEvent("pointerdown", {
            bubbles: true,
            clientX: 80,
            clientY: 200,
            button: 0,
          }),
        ),
    );
    await act(async () =>
      document.dispatchEvent(
        new dom.window.MouseEvent("pointermove", {
          bubbles: true,
          clientX: 44,
          clientY: 250,
        }),
      ),
    );
    assert.equal(document.getElementById("drop-line").hidden, false);
    assert.match(
      document.getElementById("drop-hint").textContent,
      /1단계.*최상위/,
    );
    await act(async () =>
      document.dispatchEvent(
        new dom.window.MouseEvent("pointerup", {
          bubbles: true,
          clientX: 44,
          clientY: 250,
        }),
      ),
    );
    assert.equal(
      current.draftNodes.find((n) => n.id === "spring").parentId,
      null,
    );
    assert.equal(
      current.nodes.find((n) => n.id === "spring").parentId,
      "backend",
    );
    assert.equal(document.getElementById("drop-line").hidden, true);
    assert.equal(document.querySelector(".drag-source"), null);
  } finally {
    await act(async () => root.unmount());
  }
});
test("a saved deletion can be undone and saved even when undo empties history", async () => {
  const root = await mount();
  try {
    await click(button("전체 펼치기"));
    await click(row("스프링").querySelector('[data-action="delete"]'));
    await click(document.getElementById("confirm-delete"));
    await click(button("변경사항 저장"));
    assert.equal(current.error, "");
    await click(button("실행 취소"));
    assert.equal(current.canUndo, false);
    await click(button("변경사항 저장"));
    assert.equal(current.error, "");
    assert.deepEqual(
      JSON.parse(dom.window.localStorage.getItem(KEY)).nodes.find(
        (n) => n.id === "spring",
      ).sources,
      ["Spring ( Java )"],
    );
  } finally {
    await act(async () => root.unmount());
  }
});

const canonical = [
  { id: "canonical-spring", name: "Canonical Spring", parentId: null, order: 0, sources: ["Spring ( Java )", "canonical-spring"] },
  { id: "empty-new", name: "Empty canonical", parentId: "canonical-spring", order: 1, sources: [] },
];

test("canonical categories initialize labels and personal v1/v2 settings overlay without ID-named nodes", async () => {
  for (const version of [null, 1, 2]) {
    dom.window.localStorage.clear();
    if (version === 1) dom.window.localStorage.setItem(LEGACY, JSON.stringify({ version, groups }));
    if (version === 2) dom.window.localStorage.setItem(KEY, JSON.stringify({ version, nodes: [
      { id: "personal", name: "Personal Spring", parentId: null, sources: ["Spring ( Java )"] },
    ] }));
    const before = { ...dom.window.localStorage };
    const root = createRoot(document.getElementById("root"));
    try {
      await act(async () => root.render(React.createElement(Harness, {
        items: [...posts, { id: "new-post", title: "New", category: "canonical-spring", categoryId: "canonical-spring" }],
        categories: canonical,
      })));
      assert.ok(current.nodes.some((node) => node.name === "Empty canonical"));
      const owner = current.nodes.find((node) => node.sources.includes("canonical-spring"));
      const expectedNames = { 1: "스프링", 2: "Personal Spring", null: "Canonical Spring" };
      assert.equal(owner.name, expectedNames[version]);
      assert.equal(current.nodes.some((node) => node.name === "canonical-spring"), false);
      assert.deepEqual({ ...dom.window.localStorage }, before, "render does not migrate or overwrite stored settings");
      assert.equal(current.nodes.flatMap((node) => node.sources).filter((source) => source === "canonical-spring").length, 1);
    } finally {
      await act(async () => root.unmount());
    }
  }
});

test("corrupt personal settings use canonical labels while preserving bytes and blocking save", async () => {
  dom.window.localStorage.clear();
  dom.window.localStorage.setItem(KEY, "BROKEN_BYTES");
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness, { categories: canonical })));
    assert.ok(current.nodes.some((node) => node.name === "Canonical Spring"));
    assert.equal(current.saveNodes(current.nodes), false);
    assert.equal(dom.window.localStorage.getItem(KEY), "BROKEN_BYTES");
  } finally {
    await act(async () => root.unmount());
  }
});
