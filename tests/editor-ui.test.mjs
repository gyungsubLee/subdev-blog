import { loadComponent } from "./support/load-component.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { createHash } from "node:crypto";
import { parseMarkdownDocument } from "../src/shared/document.mjs";

// JSDOM covers React/editor integration, not browser layout or hardware input.
// Layout-only observer and rectangle shims keep floating UI from measuring a real screen.
const dom = new JSDOM(
  '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content"></head><body><div id="root"></div></body></html>',
  {
    url: "https://second-brain.test/",
    pretendToBeVisual: true,
    storageQuota: 40 * 1024 * 1024,
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
    const file = new dom.window.File([text], name);
    file.text = async () => text;
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [file],
    });
    await act(async () => {
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 750)));
  }

  await t.test(
    "Markdown import exposes body-only raw input and autosaves title/category",
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
      assert.equal(document.querySelector('textarea[aria-label="Markdown 본문"]').value, draft.markdown);
      assert.equal(document.querySelector('.bn-editor[contenteditable="true"]'), null);
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
        assert.equal(parseMarkdownDocument(markdown).metadata.title, "원본 백업 검사");
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

  await t.test("full Markdown preserves metadata, raw body and selected image/binary bytes through reopen and backup", async () => {
    const documentId = "11111111-1111-4111-8111-111111111111";
    const revision = "a".repeat(64);
    const body = '<a id="anchor"></a>\r\n$E=mc^2$\r\n```mermaid\r\ngraph TD; A-->B\r\n```\r\n```js\r\nconst x = "---";\r\n```\r\n![chosen](./image.png)\r\n[bytes](./bytes.bin)\r\n'.replaceAll("\\r", "\r").replaceAll("\\n", "\n");
    const text = `---\nschema_version: 1\nid: ${documentId}\ntitle: "  Original title  "\nparent_id: 22222222-2222-4222-8222-222222222222\ncategory_id: cat:dev\ncreated: 2026-10-22\nupdated: 2026-10-22\nbase_revision: ${revision}\nsummary: AI_PRIVATE_SENTINEL\nsource_ids: [22222222-2222-4222-8222-222222222222]\nextension: {nested: [true, null, 3]}\n---\n${body}`;
    await act(async () => root.render(React.createElement(Editor, {
      key: "full-import", post: null, categories: [{ id: "cat:dev", name: "Development", parentId: null, order: 0, sources: [] }],
      onClose() {}, onSaved(drafts) { saved.push(drafts); },
    })));
    const files = [
      new dom.window.File([text], "full.md", { type: "text/markdown" }),
      new dom.window.File([new Uint8Array([0, 1, 2, 255])], "image.png", { type: "image/png" }),
      new dom.window.File([new Uint8Array([4, 5, 0, 254])], "bytes.bin", { type: "application/octet-stream" }),
    ];
    files[0].text = async () => text;
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: files });
    await act(async () => {
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 750)));
    assert.equal(document.querySelector('[role="alert"]'), null);
    const raw = document.querySelector('textarea[aria-label="Markdown 본문"]');
    assert.ok(raw, "imports must use a body-only raw Markdown editor");
    assert.equal(raw.value, body.replaceAll("\r\n", "\n"));
    assert.equal(document.querySelector('input[aria-label="글 제목"]').value, "  Original title  ");
    assert.equal(document.querySelector('select[aria-label="분류"]').selectedOptions[0].textContent, "Development");
    assert.equal(document.body.innerHTML.includes("AI_PRIVATE_SENTINEL"), false);
    assert.equal(document.body.innerHTML.includes("base_revision"), false);
    assert.equal(document.querySelector('img[alt="chosen"]').getAttribute("src"), "data:image/png;base64,AAEC/w==");
    const title = document.querySelector('input[aria-label="글 제목"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(title, "Only title changed");
      title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 750)));
    const draft = saved.at(-1)[0];
    assert.equal(draft.documentId, documentId);
    assert.notEqual(draft.id, documentId);
    assert.equal(draft.markdown, body);
    assert.equal(draft.baseRevision, revision);
    assert.equal(draft.metadata.summary, "AI_PRIVATE_SENTINEL");
    assert.deepEqual(draft.metadata.extension, { nested: [true, null, 3] });
    assert.equal(draft.metadata.parent_id, "22222222-2222-4222-8222-222222222222");
    assert.deepEqual(draft.attachments, [
      { name: "image.png", dataUrl: "data:image/png;base64,AAEC/w==" },
      { name: "bytes.bin", dataUrl: "data:application/octet-stream;base64,BAUA/g==" },
    ]);
    assert.equal(JSON.stringify(draft).includes("blob:"), false);
    await act(async () => root.render(React.createElement(Editor, {
      key: "reopened-full", post: draft,
      onClose() {}, onSaved(drafts) { saved.push(drafts); },
    })));
    assert.equal(document.querySelector('textarea').value, body.replaceAll("\r\n", "\n"));
    assert.equal(document.querySelector('img[alt="chosen"]').getAttribute("src"), "data:image/png;base64,AAEC/w==");
    const downloads = [];
    const createURL = URL.createObjectURL;
    const revokeURL = URL.revokeObjectURL;
    const nativeClick = dom.window.HTMLAnchorElement.prototype.click;
    URL.createObjectURL = (blob) => { downloads.push(blob); return "blob:download"; };
    URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function () {};
    let backup;
    try {
      for (const label of [".md 내보내기", "원본 백업"]) {
        await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === label).click());
      }
      const exported = parseMarkdownDocument(await downloads[0].text());
      assert.equal(exported.markdown, body);
      assert.equal(exported.metadata.id, documentId);
      assert.equal(exported.metadata.title, "Only title changed");
      assert.equal(exported.metadata.summary, "AI_PRIVATE_SENTINEL");
      assert.equal(exported.baseRevision, revision);
      backup = await downloads[1].text();
      assert.deepEqual(JSON.parse(backup).attachments, draft.attachments);
    } finally {
      URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
      dom.window.HTMLAnchorElement.prototype.click = nativeClick;
    }
    await importText("restored.json", backup);
    assert.equal(document.querySelector('textarea').value, body.replaceAll("\r\n", "\n"));
    assert.deepEqual(saved.at(-1)[0].attachments, draft.attachments);
    const before = localStorage.getItem("second-brain:drafts:v1");
    await importText("missing.md", text.replace("./image.png", "./missing.png"));
    assert.ok(document.querySelector('[role="alert"]'));
    assert.equal(document.querySelector('textarea').value, body.replaceAll("\r\n", "\n"));
    assert.equal(localStorage.getItem("second-brain:drafts:v1"), before);
    await importText("invalid.json", JSON.stringify({ ...draft, attachments: [{ name: "image.png", dataUrl: "data:image/png;base64,!!!!" }] }));
    assert.equal(document.querySelector('textarea').value, body.replaceAll("\r\n", "\n"));
    assert.equal(localStorage.getItem("second-brain:drafts:v1"), before);
    const storagePrototype = Object.getPrototypeOf(localStorage);
    const setItem = storagePrototype.setItem;
    storagePrototype.setItem = () => { throw new Error("QuotaExceededError"); };
    const rawBody = document.querySelector('textarea');
    try {
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set.call(rawBody, "Changed body with AI summary still incomplete");
        rawBody.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
        document.querySelector('.editor-save').click();
      });
      assert.match(document.querySelector('[role="alert"]').textContent, /QuotaExceeded/);
      assert.equal(rawBody.value, "Changed body with AI summary still incomplete");
      assert.equal(localStorage.getItem("second-brain:drafts:v1"), before);
    } finally { storagePrototype.setItem = setItem; }
    await act(async () => document.querySelector('.editor-save').click());
    assert.equal(saved.at(-1)[0].metadata.review_status, "needs_review");
    assert.equal(saved.at(-1)[0].metadata.summary, "AI_PRIVATE_SENTINEL");
  });

  await t.test("full imports hash original selected bytes and preserve that revision through reopen and export", async () => {
    const text = '\uFEFF---\r\nschema_version: 1\r\nid: 44444444-4444-4444-8444-444444444444\r\ntitle:    "Byte source"   # retained input spelling\r\nparent_id: null\r\ncreated: 2026-10-22\r\nupdated: 2026-10-22\r\n---\r\n<a id="body"></a>\r\nOriginal bytes\r\n';
    const expectedRevision = createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
    await importText("original.md", text);
    assert.equal(document.querySelector('[role="alert"]'), null);
    const imported = saved.at(-1)[0];
    assert.equal(imported.baseRevision, expectedRevision);
    assert.equal(imported.markdown, '<a id="body"></a>\r\nOriginal bytes\r\n');
    await act(async () => root.render(React.createElement(Editor, {
      key: "reopened-input-hash", post: imported, onClose() {},
      onSaved(drafts) { saved.push(drafts); },
    })));
    await act(async () => document.querySelector('.editor-save').click());
    assert.equal(saved.at(-1)[0].baseRevision, expectedRevision);
    const { markdownDocument } = await import("../src/shared/document.mjs");
    const fullExport = markdownDocument(saved.at(-1)[0]);
    assert.equal(parseMarkdownDocument(fullExport).baseRevision, expectedRevision);
    assert.notEqual(createHash("sha256").update(fullExport).digest("hex"), expectedRevision);
    await importText("edited.md", fullExport);
    assert.equal(saved.at(-1)[0].baseRevision, expectedRevision);
  });

  await t.test("selected aggregate overflow preserves live data and a base64-expanded valid backup restores", async () => {
    const text = "---\nid: 55555555-5555-4555-8555-555555555555\ntitle: Selected bytes\n---\n[binary](./large.bin)";
    const input = document.querySelector('input[type="file"]');
    const documentFile = new dom.window.File([text], "bytes.md");
    documentFile.text = async () => text;
    const overflow = [
      documentFile,
      new dom.window.File([new Uint8Array(6 * 1024 * 1024)], "large.bin", { type: "application/octet-stream" }),
      new dom.window.File([new Uint8Array(5 * 1024 * 1024)], "other.bin", { type: "application/octet-stream" }),
    ];
    const before = localStorage.getItem("second-brain:drafts:v1");
    const beforeBody = document.querySelector('textarea').value;
    Object.defineProperty(input, "files", { configurable: true, value: overflow });
    await act(async () => {
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /10M|합계/);
    assert.equal(document.querySelector('textarea').value, beforeBody);
    assert.equal(localStorage.getItem("second-brain:drafts:v1"), before);
    const bytes = new Uint8Array(9 * 1024 * 1024);
    bytes[0] = 17; bytes[bytes.length - 1] = 254;
    const valid = [documentFile, new dom.window.File([bytes], "large.bin", { type: "application/octet-stream" })];
    Object.defineProperty(input, "files", { configurable: true, value: valid });
    await act(async () => {
      input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 750)));
    assert.equal(document.querySelector('[role="alert"]')?.textContent ?? "", "");
    const imported = saved.at(-1)[0];
    const createURL = URL.createObjectURL;
    const revokeURL = URL.revokeObjectURL;
    const nativeClick = dom.window.HTMLAnchorElement.prototype.click;
    let backupBlob;
    URL.createObjectURL = (blob) => { backupBlob = blob; return "blob:large-backup"; };
    URL.revokeObjectURL = () => {};
    dom.window.HTMLAnchorElement.prototype.click = function () {};
    let backup;
    try {
      await act(async () => [...document.querySelectorAll('button')].find((button) => button.textContent === "원본 백업").click());
      backup = await backupBlob.text();
    } finally {
      URL.createObjectURL = createURL;
      URL.revokeObjectURL = revokeURL;
      dom.window.HTMLAnchorElement.prototype.click = nativeClick;
    }
    assert.ok(Buffer.byteLength(backup) > 10 * 1024 * 1024);
    await importText("expanded-backup.json", backup);
    assert.equal(document.querySelector('[role="alert"]')?.textContent ?? "", "");
    const restored = saved.at(-1)[0];
    assert.equal(restored.markdown, imported.markdown);
    const decoded = Buffer.from(restored.attachments[0].dataUrl.split(",")[1], "base64");
    assert.equal(decoded.length, 9 * 1024 * 1024);
    assert.equal(decoded[0], 17);
    assert.equal(decoded.at(-1), 254);
    const previousStorage = localStorage.getItem("second-brain:drafts:v1");
    const previousBody = document.querySelector('textarea').value;
    await importText("over-budget.json", JSON.stringify({
      ...restored, markdown: "Oversized logical body",
      attachments: [restored.attachments[0], { ...restored.attachments[0], name: "second.bin" }],
    }));
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /10MiB|합계/);
    assert.equal(document.querySelector('textarea').value, previousBody);
    assert.equal(localStorage.getItem("second-brain:drafts:v1"), previousStorage);
    let readOversizedContainer = false;
    Object.defineProperty(input, "files", { configurable: true, value: [{
      name: "oversized.json", size: 160 * 1024 * 1024 + 1,
      async text() { readOversizedContainer = true; throw new Error("must reject before parsing"); },
    }] });
    await act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    assert.equal(readOversizedContainer, false);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /백업|160MiB/);
    assert.equal(document.querySelector('textarea').value, previousBody);
    assert.equal(localStorage.getItem("second-brain:drafts:v1"), previousStorage);
  });

  await t.test("new canonical IDs survive repeated saves and public edits export guarded patches", async () => {
    await act(async () => root.render(React.createElement(Editor, {
      key: "stable-new", post: null, onClose() {}, onSaved(drafts) { saved.push(drafts); },
    })));
    await act(async () => document.querySelector('.editor-save').click());
    const first = saved.at(-1)[0];
    await act(async () => document.querySelector('.editor-save').click());
    assert.equal(saved.at(-1)[0].documentId, first.documentId);
    assert.match(first.documentId, /^[a-f0-9-]{36}$/);
    assert.notEqual(first.id.slice(6), first.documentId);
    const publicPost = {
      id: "11111111-1111-4111-8111-111111111111", title: "Public", category: "Development", categoryId: "cat:dev", parentId: "22222222-2222-4222-8222-222222222222",
      createdAt: "2026-10-22", updatedAt: "2026-10-22", markdown: "<a id=\"keep\"></a>\r\nPublic body", revision: "b".repeat(64), path: "", url: "", excerpt: "",
    };
    await act(async () => root.render(React.createElement(Editor, {
      key: "public", post: publicPost, onClose() {}, onSaved(drafts) { saved.push(drafts); },
    })));
    assert.equal(document.querySelector('textarea').value, publicPost.markdown.replaceAll("\r\n", "\n"));
    await act(async () => document.querySelector('.editor-save').click());
    const draft = saved.at(-1)[0];
    assert.equal(draft.documentMode, "patch");
    assert.equal(draft.documentId, publicPost.id);
    assert.equal(draft.baseRevision, publicPost.revision);
    assert.equal(draft.metadata.parent_id, undefined);
    const { markdownDocument } = await import("../src/shared/document.mjs");
    const exported = parseMarkdownDocument(markdownDocument(draft));
    assert.equal(exported.documentMode, "patch");
    assert.equal(exported.patch.baseRevision, publicPost.revision);
    assert.equal(exported.patch.markdown, publicPost.markdown);
  });

  await t.test("imported missing and unknown categories stay opaque and canonical id-only headers keep their ID", async () => {
    const documentId = "33333333-3333-4333-8333-333333333333";
    for (const categoryLine of ["", "category_id: private:category-id\n"]) {
      await importText("category.md", `---\nschema_version: 1\nid: ${documentId}\ntitle: "  Keep spaces  "\nparent_id: null\ncreated: 2026-10-22\nupdated: 2026-10-22\n${categoryLine}---\n<a id="keep"></a>\n`);
      const draft = saved.at(-1)[0];
      assert.equal(draft.documentId, documentId);
      assert.equal(draft.title, "  Keep spaces  ");
      assert.equal(document.body.innerHTML.includes("private:category-id"), false);
      if (categoryLine) assert.equal(draft.metadata.category_id, "private:category-id");
      else assert.equal(Object.hasOwn(draft.metadata, "category_id"), false);
    }
    await importText("id-only.md", `---\nid: ${documentId}\ntitle: ID only\n---\nbody`);
    assert.equal(saved.at(-1)[0].documentId, documentId);
    const before = localStorage.getItem("second-brain:drafts:v1");
    const input = document.querySelector('input[type="file"]');
    Object.defineProperty(input, "files", { configurable: true, value: [{ name: "huge.md", size: 11 * 1024 * 1024, async text() { throw new Error("must not read oversized file"); } }] });
    await act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    assert.match(document.querySelector('[role="alert"]').textContent, /10MB/);
    assert.equal(localStorage.getItem("second-brain:drafts:v1"), before);
  });

  await t.test("legacy block drafts keep raw Markdown on title edits and localize owned image previews", async () => {
    const draft = {
      id: "draft-legacy-blocks", sourceId: "11111111-1111-4111-8111-111111111111",
      title: "Legacy", category: "개발", parentId: null, createdAt: "2026-10-22", updatedAt: "2026-10-22",
      markdown: '<a id="original"></a>\r\n![old](/notion/assets/hash.webp)\r\n',
      blocks: [{ type: "paragraph", content: "Block representation" }, { type: "image", props: { url: "/notion/assets/hash.webp", name: "legacy image" } }],
      draft: true, path: "", url: "", excerpt: "",
    };
    const { saveDraft } = await import("../src/shared/drafts.mjs");
    saveDraft(localStorage, draft);
    await act(async () => root.render(React.createElement(Editor, {
      key: "legacy-body", post: draft, onClose() {}, onSaved(drafts) { saved.push(drafts); },
    })));
    assert.ok(document.querySelector('.bn-editor[contenteditable="true"]'));
    assert.ok(document.querySelector('img[src="/content/assets/11111111-1111-4111-8111-111111111111/hash.webp"]'));
    await act(async () => {
      const title = document.querySelector('input[aria-label="글 제목"]');
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(title, "Legacy renamed");
      title.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      document.querySelector('.editor-save').click();
    });
    const savedDraft = saved.at(-1)[0];
    assert.equal(savedDraft.markdown, draft.markdown);
    assert.deepEqual(savedDraft.blocks, draft.blocks);
    const { markdownDocument } = await import("../src/shared/document.mjs");
    assert.equal(parseMarkdownDocument(markdownDocument(savedDraft)).markdown, draft.markdown);
  });

  await t.test(
    "slash menu inserts a notebook whose text and formatting survive save and reopen",
    async () => {
      await act(async () => root.render(React.createElement(Editor, {
        key: "new-notebook", post: null, onClose() {},
        onSaved(drafts) { saved.push(drafts); },
      })));
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
      const notebookItem = [...document.querySelectorAll('[role="option"]')].find(
        (item) => item.textContent.includes("아이보리 줄노트"),
      );
      assert.ok(notebookItem, "the native slash menu offers the notebook");
      await act(async () => notebookItem.click());
      assert.ok(document.querySelector('.ivory-notebook-content .bn-block-content'));
      assert.equal(document.querySelectorAll('.notebook-holes i').length, 3);

      function typeText(text) {
        for (const character of text) {
          const { from, to } = view.state.selection;
          const handled = view.someProp("handleTextInput", (handler) =>
            handler(view, from, to, character, () => view.state.tr.insertText(character)),
          );
          if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
        }
      }
      function enter() {
        view.someProp("handleKeyDown", (handler) => handler(view, new KeyboardEvent("keydown", {
          key: "Enter", keyCode: 13, bubbles: true, cancelable: true,
        })));
      }
      await act(async () => {
        const start = view.state.selection.from;
        typeText("한글 English recall, precision");
        view.dispatch(view.state.tr.addMark(start + 11, start + 17, view.state.schema.marks.code.create()));
        enter();
        typeText("## ");
        typeText("같은 노트의 제목");
        enter();
        typeText("- ");
        typeText("같은 노트의 목록");
      });
      const saveButton = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === "초안 저장",
      );
      await act(async () => saveButton.click());
      assert.equal(errors.length, 0, errors.map(String).join("\n"));
      const draft = saved.at(-1)[0];
      const notebook = draft.blocks.find((block) => block.type === "notebook");
      assert.deepEqual(notebook.children.map((block) => block.type), [
        "paragraph", "heading", "bulletListItem",
      ]);
      assert.ok(notebook.children[0].content.some(
        (part) => part.text === "recall" && part.styles.code,
      ));
      assert.ok(draft.markdown.includes("한글 English"));
      assert.ok(draft.excerpt.includes("한글 English"));

      await act(async () => root.render(React.createElement(Editor, {
        key: "reopened-notebook",
        post: draft,
        onClose() {},
        onSaved(drafts) { saved.push(drafts); },
      })));
      assert.ok(document.querySelector('.ivory-notebook-content').textContent.includes("한글 English"));
      assert.equal(document.querySelector('.ivory-notebook code').textContent, "recall");
      await act(async () => document.querySelector('.editor-save').click());
      const reopened = saved.at(-1)[0].blocks.find((block) => block.type === "notebook");
      assert.deepEqual(reopened, JSON.parse(JSON.stringify(notebook)));

    },
  );
});
