import { loadComponent } from "./support/load-component.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

// JSDOM covers React/editor integration, not browser layout or hardware input.
// Layout-only observer and rectangle shims keep floating UI from measuring a real screen.
const dom = new JSDOM(
  '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content"></head><body><div id="root"></div></body></html>',
  {
    url: "https://second-brain.test/",
    pretendToBeVisual: true,
  },
);
for (const name of [
  "window",
  "document",
  "navigator",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLDivElement",
  "HTMLParagraphElement",
  "HTMLInputElement",
  "HTMLAnchorElement",
  "MutationObserver",
  "DOMParser",
  "DOMRect",
  "Range",
  "KeyboardEvent",
  "InputEvent",
  "MouseEvent",
  "Event",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "FileReader",
]) {
  Object.defineProperty(globalThis, name, {
    value: dom.window[name],
    configurable: true,
  });
}
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window,
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
  dom.window,
);
dom.window.matchMedia = () => ({
  matches: false,
  media: "",
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return true;
  },
});
globalThis.ResizeObserver = dom.window.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IntersectionObserver = dom.window.IntersectionObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
dom.window.scrollTo = () => {};
dom.window.scrollBy = () => {};
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.Element.prototype.getBoundingClientRect = () =>
  new dom.window.DOMRect(0, 0, 100, 30);
dom.window.Range.prototype.getBoundingClientRect = () =>
  new dom.window.DOMRect();
dom.window.Range.prototype.getClientRects = () => [];
dom.window.document.elementFromPoint = () => dom.window.document.body;

const errors = [];
const originalConsoleError = console.error;
console.error = (...args) => {
  errors.push(new Error(args.map(String).join(" ")));
  originalConsoleError(...args);
};
dom.window.addEventListener("error", (event) => {
  errors.push(event.error || new Error(event.message));
  event.preventDefault();
});

const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Editor } = await loadComponent("src/pages/write/WritePage.tsx");

test("real React editor mounts, saves, imports, exports, and opens the slash menu", async (t) => {
  const saved = [];
  const root = createRoot(document.getElementById("root"), {
    onUncaughtError(error) {
      errors.push(error);
    },
    onRecoverableError(error) {
      errors.push(error);
    },
  });
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    console.error = originalConsoleError;
    assert.equal(errors.length, 0, errors.map(String).join("\n"));
  });
  await act(async () =>
    root.render(
      React.createElement(Editor, {
        post: null,
        onClose() {},
        onSaved(drafts) {
          saved.push(drafts);
        },
      }),
    ),
  );
  assert.equal(errors.length, 0, errors.map(String).join("\n"));
  assert.ok(
    document.querySelector('.bn-editor[contenteditable="true"]'),
    "actual BlockNote contenteditable must mount",
  );
  const title = document.querySelector('input[aria-label="글 제목"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    ).set.call(title, "편집기 통합 검사");
    title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 750)));
  assert.equal(errors.length, 0, errors.map(String).join("\n"));
  assert.ok(saved.length > 0, "title changes must reach autosave");
  assert.equal(saved.at(-1)[0].title, "편집기 통합 검사");
  assert.ok(Array.isArray(saved.at(-1)[0].blocks));
  assert.equal(saved.at(-1)[0].draft, true);

  async function importText(name, text) {
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        {
          name,
          size: Buffer.byteLength(text),
          async text() {
            return text;
          },
        },
      ],
    });
    await act(async () => {
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 750)));
  }

  await t.test(
    "Markdown import updates real blocks and autosaved title/category",
    async () => {
      await importText(
        "import.md",
        [
          "---",
          'title: "가져온 제목"',
          'category: "검증"',
          "---",
          "",
          "# 가져온 제목",
          "",
          "파일에서 가져온 본문입니다.",
          "",
          String.fromCharCode(96).repeat(3) + "javascript",
          "const imported = true;",
          String.fromCharCode(96).repeat(3),
        ].join("\n"),
      );
      assert.equal(errors.length, 0, errors.map(String).join("\n"));
      const draft = saved.at(-1)[0];
      assert.equal(draft.title, "가져온 제목");
      assert.equal(draft.category, "검증");
      assert.ok(draft.markdown.includes("파일에서 가져온 본문입니다."));
      assert.ok(draft.markdown.includes("const imported = true;"));
      assert.ok(draft.blocks.some((block) => block.type === "codeBlock"));
      assert.equal(
        document.querySelector('input[aria-label="글 제목"]').value,
        "가져온 제목",
      );
      assert.equal(document.querySelector('[role="alert"]'), null);
    },
  );

  await t.test(
    "JSON backup imports nested blocks and code settings without flattening",
    async () => {
      await importText(
        "backup.json",
        JSON.stringify({
          title: "원본 백업 검사",
          category: "백업",
          blocks: [
            {
              type: "toggleListItem",
              content: "접는 제목",
              children: [{ type: "paragraph", content: "안쪽 본문" }],
            },
            {
              type: "codeBlock",
              props: { language: "python", caption: "가져온 캡션", wrap: true },
              content: "print(42)",
            },
          ],
        }),
      );
      assert.equal(errors.length, 0, errors.map(String).join("\n"));
      const draft = saved.at(-1)[0];
      assert.equal(draft.title, "원본 백업 검사");
      assert.equal(draft.category, "백업");
      const toggle = draft.blocks.find(
        (block) => block.type === "toggleListItem",
      );
      assert.equal(toggle.children[0].content[0].text, "안쪽 본문");
      const code = draft.blocks.find((block) => block.type === "codeBlock");
      assert.equal(code.props.language, "python");
      assert.equal(code.props.caption, "가져온 캡션");
      assert.equal(code.props.wrap, true);
      assert.equal(
        document.querySelector(".notion-code-caption").value,
        "가져온 캡션",
      );
      assert.equal(document.querySelector(".notion-code").dataset.wrap, "true");
    },
  );

  await t.test(
    "MD and JSON download buttons export the current live document",
    async () => {
      const downloads = [];
      const createURL = URL.createObjectURL;
      const revokeURL = URL.revokeObjectURL;
      const nativeClick = dom.window.HTMLAnchorElement.prototype.click;
      URL.createObjectURL = (blob) => {
        downloads.push({ blob });
        return "blob:https://second-brain.test/download-" + downloads.length;
      };
      URL.revokeObjectURL = () => {};
      dom.window.HTMLAnchorElement.prototype.click = function () {
        downloads.at(-1).filename = this.download;
      };
      try {
        for (const label of [".md 내보내기", "원본 백업"]) {
          const button = [...document.querySelectorAll("button")].find(
            (button) => button.textContent === label,
          );
          await act(async () => button.click());
        }
        assert.equal(downloads.length, 2);
        const markdown = await downloads[0].blob.text();
        assert.equal(downloads[0].filename, "원본 백업 검사.md");
        assert.ok(markdown.includes('title: "원본 백업 검사"'));
        assert.ok(markdown.includes('category: "백업"'));
        assert.ok(markdown.includes("print(42)"));
        const backup = JSON.parse(await downloads[1].blob.text());
        assert.equal(downloads[1].filename, "원본 백업 검사.json");
        assert.equal(backup.title, "원본 백업 검사");
        assert.ok(
          backup.blocks.find((block) => block.type === "codeBlock").props.wrap,
        );
        assert.ok(
          backup.blocks.find((block) => block.type === "toggleListItem")
            .children.length,
        );
      } finally {
        URL.createObjectURL = createURL;
        URL.revokeObjectURL = revokeURL;
        dom.window.HTMLAnchorElement.prototype.click = nativeClick;
      }
    },
  );

  await t.test(
    "slash input opens the real React suggestion controller",
    async () => {
      await importText("empty.md", "");
      const editable = document.querySelector(
        '.bn-editor[contenteditable="true"]',
      );
      const view = editable.editor?.view;
      assert.ok(
        view,
        "ProseMirror view must be attached to the real editor DOM",
      );
      await act(async () => {
        view.focus();
        const { from, to } = view.state.selection;
        const handled = view.someProp("handleTextInput", (handler) =>
          handler(view, from, to, "/", () => view.state.tr.insertText("/")),
        );
        if (!handled) view.dispatch(view.state.tr.insertText("/", from, to));
      });
      await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
      assert.equal(errors.length, 0, errors.map(String).join("\n"));
      assert.ok(
        document.querySelector('.bn-suggestion-menu, [role="listbox"]'),
        "real suggestion menu must be rendered",
      );
      assert.ok(
        document.body.textContent.includes("제목") ||
          document.body.textContent.includes("Heading"),
      );
    },
  );
});
