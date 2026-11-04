import assert from "node:assert/strict";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "../support/load-component.mjs";
const dom = new JSDOM('<div id="root"></div>', {
  url: "http://localhost/#/records",
  pretendToBeVisual: true,
});
for (const name of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
])
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.matchMedia = () => ({ matches: false });
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: RecordsPage } = await loadComponent(
  "app/web/src/pages/records/RecordsPage.tsx",
);
const { useCategoryCatalog } = await loadComponent(
  "app/web/src/features/post-category/useCategoryCatalog.ts",
);
const { useRecordsCatalog } = await loadComponent(
  "app/web/src/features/post-category/useRecordsCatalog.ts",
);
const { useRecordsBrowser } = await loadComponent(
  "app/web/src/features/post-category/useRecordsBrowser.ts",
);
const nodes = [
  { id: "a", name: "Alpha", parentId: null, sources: [] },
  { id: "child", name: "Child", parentId: "a", sources: ["source"] },
  { id: "b", name: "Beta", parentId: null, sources: [] },
];
let current, written;
function Harness() {
  current = useRecordsCatalog(useCategoryCatalog([]));
  const browser = useRecordsBrowser([], current.groups, false);
  return React.createElement(RecordsPage, {
    posts: [],
    catalog: current,
    browser,
    onWrite: (id) => {
      written = id;
    },
  });
}
async function mount() {
  window.localStorage.clear();
  window.localStorage.setItem(
    "second-brain:categories:v2",
    JSON.stringify({ version: 2, nodes }),
  );
  written = undefined;
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(Harness)));
  return root;
}
const button = (label, scope = document) =>
  [...scope.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label") === label || b.textContent.trim() === label,
  );
async function click(b) {
  assert.ok(Boolean(b), "button exists");
  await act(async () => b.click());
}
async function menu(target) {
  assert.ok(Boolean(target), "menu target exists");
  await act(async () =>
    target.dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 100,
        clientY: 100,
      }),
    ),
  );
}
async function name(value) {
  const field = document.querySelector('[name="categoryName"]');
  assert.ok(Boolean(field), "category field exists");
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(field, value);
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
async function key(key, shiftKey = false, target = document) {
  await act(async () =>
    target.dispatchEvent(
      new window.KeyboardEvent("keydown", {
        key,
        metaKey: true,
        shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
}
after(() => dom.window.close());
test(
  "overview adds retain dialog, scroll and disclosures; blank menu is scoped; selection closes",
  { timeout: 10000 },
  async () => {
    const root = await mount();
    try {
      await click(button("카테고리 전체 보기"));
      const dialog = document.querySelector(".overview-dialog");
      assert.ok(Boolean(dialog), "overview opens");
      dialog.scrollTop = 55;
      await menu(dialog.querySelector(".overview-dialog-body"));
      assert.equal(
        Boolean(button("태그 보기", document.querySelector('[role="menu"]'))),
        false,
      );
      await click(button("카테고리 추가"));
      await name("New root");
      await click(button("저장"));
      assert.ok(
        document.querySelector(".overview-dialog") === dialog,
        "same overview survives add",
      );
      assert.equal(dialog.open, true);
      assert.equal(dialog.scrollTop, 55);
      await menu(button("Alpha", dialog));
      await click(button("하위 카테고리 추가"));
      await name("New child");
      await click(button("저장"));
      assert.ok(Boolean(button("New child", dialog)), "new child is revealed");
      await click(button("New child", dialog));
      assert.equal(Boolean(document.querySelector(".overview-dialog")), false);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
test(
  "ordinary edits are direct; undo/redo are confirmed and native input undo stays native",
  { timeout: 10000 },
  async () => {
    const root = await mount();
    try {
      await menu(button("Alpha"));
      await click(button("카테고리 이름 변경"));
      await name("Renamed");
      await key("z", false, document.querySelector('[name="categoryName"]'));
      assert.equal(
        Boolean(document.querySelector(".history-confirmation")),
        false,
      );
      await click(button("저장"));
      assert.equal(current.nodes.find((n) => n.id === "a").name, "Renamed");
      await key("z");
      assert.ok(Boolean(document.querySelector(".history-confirmation")));
      await click(button("취소"));
      assert.equal(current.nodes.find((n) => n.id === "a").name, "Renamed");
      await key("z");
      await click(button("확인"));
      assert.equal(current.nodes.find((n) => n.id === "a").name, "Alpha");
      await key("z", true);
      await click(button("확인"));
      assert.equal(current.nodes.find((n) => n.id === "a").name, "Renamed");
    } finally {
      await act(async () => root.unmount());
    }
  },
);
test(
  "global category has no menu and writer receives the category from overview",
  { timeout: 10000 },
  async () => {
    const root = await mount();
    try {
      await menu(button("모든 기록"));
      assert.equal(Boolean(document.querySelector('[role="menu"]')), false);
      await click(button("카테고리 전체 보기"));
      await menu(button("Child", document.querySelector(".overview-dialog")));
      await click(button("글 추가"));
      assert.equal(written, "child");
      assert.equal(Boolean(document.querySelector(".overview-dialog")), false);
    } finally {
      await act(async () => root.unmount());
    }
  },
);

async function pointer(type, target, x, y) {
  await act(async () =>
    target.dispatchEvent(
      new window.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: x,
        clientY: y,
      }),
    ),
  );
}
async function hold(target) {
  await pointer("pointerdown", target, 50, 20);
  await act(
    async () => new Promise((resolve) => window.setTimeout(resolve, 620)),
  );
}
test(
  "tag gaps retain projected child DOM, cache valid targets and reject gap drops",
  { timeout: 10000 },
  async () => {
    const root = await mount();
    const originalHit = document.elementFromPoint;
    try {
      const nav = document.querySelector(".records-nav-tags");
      let hit = button("Beta");
      document.elementFromPoint = () => hit;
      hit.getBoundingClientRect = () => new window.DOMRect(0, 0, 100, 40);
      await hold(button("Alpha"));
      await pointer("pointermove", document, 50, 30);
      assert.ok(
        Boolean(document.querySelector("[data-preview-source]")),
        "projected source appears",
      );
      assert.ok(
        Boolean(document.querySelector('[aria-label="2단계 카테고리"]')),
        "child level reveals",
      );
      const projected = document.querySelector("[data-preview-source]");
      for (let i = 0; i < 20; i++)
        await pointer("pointermove", document, 51, 30);
      assert.ok(
        document.querySelector("[data-preview-source]") === projected,
        "same target retains DOM",
      );
      hit = nav;
      await pointer("pointermove", document, 100, 50);
      assert.ok(
        document.querySelector("[data-preview-source]") === projected,
        "gap retains projected DOM",
      );
      await pointer("pointerup", document, 100, 50);
      assert.equal(
        current.nodes.find((n) => n.id === "a").parentId,
        null,
        "gap never commits",
      );
      await act(
        async () => new Promise((resolve) => window.setTimeout(resolve, 360)),
      );
      hit = button("Beta");
      hit.getBoundingClientRect = () => new window.DOMRect(0, 0, 100, 40);
      await hold(button("Alpha"));
      await pointer("pointermove", document, 50, 30);
      hit = nav;
      await pointer("pointermove", document, 100, 50);
      hit = document.querySelector("[data-preview-source]");
      await pointer("pointermove", document, 50, 60);
      await pointer("pointerup", document, 50, 60);
      assert.equal(
        current.nodes.find((n) => n.id === "a").parentId,
        "b",
        "valid reentry commits cached placement",
      );
      assert.equal(
        current.nodes.find((n) => n.id === "child").parentId,
        "a",
        "subtree stays intact",
      );
      assert.equal(
        document.querySelectorAll(".records-drag-ghost").length,
        0,
        "tags have no floating motion",
      );
    } finally {
      document.elementFromPoint = originalHit;
      await act(async () => root.unmount());
    }
  },
);
test(
  "outside/descendant cancels projection and Escape cleans sidebar floating feedback",
  { timeout: 10000 },
  async () => {
    const root = await mount();
    const originalHit = document.elementFromPoint;
    try {
      await click(button("사이드바 보기"));
      await click(button("Alpha"));
      let hit = button("Beta");
      document.elementFromPoint = () => hit;
      hit.getBoundingClientRect = () => new window.DOMRect(0, 0, 100, 100);
      await hold(button("Alpha"));
      await pointer("pointermove", document, 50, 40);
      assert.equal(
        document.querySelectorAll(".records-drag-ghost").length,
        1,
        "sidebar has floating feedback",
      );
      assert.ok(Boolean(document.querySelector("[data-preview-source]")));
      hit = button("Child");
      await pointer("pointermove", document, 50, 120);
      assert.equal(
        Boolean(document.querySelector("[data-preview-source]")),
        false,
        "a descendant cancels projection",
      );
      hit = button("Beta");
      await pointer("pointermove", document, 50, 40);
      hit = document.querySelector(".records-content");
      await pointer("pointermove", document, 500, 200);
      assert.equal(
        Boolean(document.querySelector("[data-preview-source]")),
        false,
        "outside cancels projection",
      );
      await act(async () =>
        document.dispatchEvent(
          new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
      );
      assert.equal(document.querySelectorAll(".records-drag-ghost").length, 0);
      assert.equal(current.nodes.find((n) => n.id === "a").parentId, null);
    } finally {
      document.elementFromPoint = originalHit;
      await act(async () => root.unmount());
    }
  },
);

test(
  "same names in different parents are valid; duplicate siblings and failed storage saves are atomic",
  { timeout: 10000 },
  async () => {
    const root = await mount();
    const original = window.Storage.prototype.setItem;
    try {
      await menu(button("Beta"));
      await click(button("하위 카테고리 추가"));
      await name("Child");
      await click(button("저장"));
      assert.equal(
        current.nodes.filter((node) => node.name === "Child").length,
        2,
      );
      await menu(button("Beta"));
      await click(button("하위 카테고리 추가"));
      await name("Child");
      await click(button("저장"));
      assert.ok(Boolean(document.querySelector('[role="alert"]')));
      assert.equal(
        current.nodes.filter((node) => node.name === "Child").length,
        2,
      );
      await click(button("취소"));
      await menu(button("Beta"));
      await click(button("카테고리 이름 변경"));
      await name("Changed");
      window.Storage.prototype.setItem = () => {
        throw Error("quota");
      };
      await click(button("저장"));
      assert.equal(current.nodes.find((node) => node.id === "b").name, "Beta");
      assert.match(current.error, /저장하지 못했습니다/);
      window.Storage.prototype.setItem = original;
      await click(button("취소"));
      await key("z");
      await click(button("확인"));
      assert.equal(
        current.nodes.filter((node) => node.name === "Child").length,
        1,
      );
    } finally {
      window.Storage.prototype.setItem = original;
      await act(async () => root.unmount());
    }
  },
);

test(
  "a released long hold stays armed for the next drag and blank clicks cancel it",
  { timeout: 10000 },
  async () => {
    const root = await mount();
    const originalHit = document.elementFromPoint;
    try {
      let hit = button("Beta");
      document.elementFromPoint = () => hit;
      hit.getBoundingClientRect = () => new window.DOMRect(0, 0, 100, 40);
      await hold(button("Alpha"));
      await pointer("pointerup", document, 50, 20);
      await pointer("pointerdown", button("Alpha"), 50, 20);
      await pointer("pointermove", document, 50, 30);
      await pointer("pointerup", document, 50, 30);
      assert.equal(current.nodes.find((node) => node.id === "a").parentId, "b");
      await click(button("사이드바 보기"));
      await hold(button("Beta"));
      await pointer("pointerup", document, 50, 20);
      assert.equal(document.querySelectorAll(".records-drag-ghost").length, 1);
      await pointer("pointerdown", document.body, 400, 500);
      assert.equal(document.querySelectorAll(".records-drag-ghost").length, 0);
    } finally {
      document.elementFromPoint = originalHit;
      await act(async () => root.unmount());
    }
  },
);
