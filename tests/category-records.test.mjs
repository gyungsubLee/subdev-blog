import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";
const dom = new JSDOM('<div id="root"></div>', {
  url: "https://blog.example/#/records",
});
for (const name of ["window", "document", "navigator", "HTMLElement"])
  Object.defineProperty(globalThis, name, {
    value: name === "window" ? dom.window : dom.window[name],
    configurable: true,
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRecordsBrowser } = await loadComponent(
  "src/features/post-category/useRecordsBrowser.ts",
);
const { categoryNodesToGroups } = await loadComponent(
  "src/features/post-category/hierarchy.ts",
);
let current;
const nodes = [
  { id: "backend", name: "백엔드", parentId: null, sources: [] },
  { id: "java", name: "Java", parentId: "backend", sources: ["Java 원문"] },
  { id: "spring", name: "스프링", parentId: "java", sources: ["Spring 원문"] },
  { id: "tools", name: "도구", parentId: null, sources: ["다른 기록"] },
];
const posts = [
  { id: "a", category: "Java 원문", title: "Java" },
  { id: "b", category: "Spring 원문", title: "Spring" },
  { id: "c", category: "다른 기록", title: "도구" },
];
function Harness({ items = nodes }) {
  current = useRecordsBrowser(posts, categoryNodesToGroups(items), false);
  return null;
}
test("record filtering includes the complete category branch and source-bearing roots", async () => {
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => current.selectCategory("java"));
    assert.deepEqual(
      current.filteredPosts.map((p) => p.id),
      ["a", "b"],
    );
    await act(async () => current.selectCategory("spring"));
    assert.deepEqual(
      current.filteredPosts.map((p) => p.id),
      ["b"],
    );
    await act(async () =>
      root.render(
        React.createElement(Harness, {
          items: nodes.map((n) =>
            n.id === "java" ? { ...n, parentId: null } : n,
          ),
        }),
      ),
    );
    await act(async () => current.selectGroup("java"));
    assert.deepEqual(
      current.filteredPosts.map((p) => p.id),
      ["a", "b"],
    );
    assert.equal(posts[1].category, "Spring 원문");
  } finally {
    await act(async () => root.unmount());
  }
});
