import { loadComponent } from "./support/load-component.mjs";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createHash } from "node:crypto";
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
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
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

const { default: React, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { default: Editor } = await loadComponent("src/features/content-management/ManagedPostEditor.tsx");
const id = "12345678-1234-8234-9234-123456789012";
const session = { state: "ready", csrfToken: "csrf", connection: { repository: "owner/content", branch: "main", contentCommit: "b".repeat(40) } };
const post = { id, title: "Saved", markdown: "Original", category: "notes", categoryId: "notes" };
const hash = (text) => createHash("sha256").update(text).digest("hex");
const reply = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const source = (extra = {}) => ({
  document: { metadata: { id, title: "Saved", category_id: "notes" }, markdown: "Original" },
  categories: [{ id: "notes", name: "기록" }], assets: [], revision: "a".repeat(64), editorRevision: null,
  contentCommit: "b".repeat(40), ...extra,
});

async function waitFor(predicate, message) {
  const end = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > end) assert.fail(message);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}
async function mounted(props, sourceValue, run) {
  const previous = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    if (url.startsWith("/api/content?")) return reply(sourceValue);
    if (url === "/api/assets") return reply({ sha: "c".repeat(40), size: 5 });
    assert.equal(url, "/api/content");
    requests.push(JSON.parse(init.body));
    return reply({ requestId: "request", state: "published", contentCommit: "c".repeat(40) });
  };
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Editor, { session, onClose() {}, ...props })));
    await waitFor(() => document.querySelector('[aria-label="글 제목"]') !== null || document.querySelector('[role="alert"]') !== null, "Editor did not finish loading");
    await run({ root, requests });
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previous;
    localStorage.clear();
  }
}
async function save(requests) {
  const button = document.querySelector('button[type="submit"]');
  assert.ok(button !== null, "GitHub save action must exist");
  await act(async () => button.click());
  await waitFor(() => requests.length > 0, "GitHub save request did not arrive");
}

test(
  "approved editor keeps draft save local and renders the two-state writing controls",
  { timeout: 10000 },
  async () => {
    await mounted(
      { post: null },
      source({ revision: null }),
      async ({ requests }) => {
        const button = [...document.querySelectorAll("button")].find(
          (item) => item.textContent === "초안 저장",
        );
        assert.ok(button !== undefined, "draft action must exist");
        const editable = document.querySelector('.bn-editor[contenteditable="true"]');
        const view = editable.editor.view;
        await act(async () => view.dispatch(view.state.tr.insertText("Unsaved content")));
        assert.equal(button.dataset.saveState, "unsaved");
        assert.equal(document.querySelector('#editor-status').dataset.saveState, "unsaved");
        await act(async () => button.click());
        assert.equal(button.dataset.saveState, "saved");
        assert.equal(document.querySelector('#editor-status').dataset.saveState, "saved");
        await act(async () => view.dispatch(view.state.tr.insertText(" More content")));
        assert.equal(button.dataset.saveState, "unsaved");
        await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", {
          key: "s", ctrlKey: true, bubbles: true, cancelable: true,
        })));
        assert.equal(button.dataset.saveState, "saved");
        assert.equal(requests.length, 0, "draft save cannot publish");
        assert.ok(
          document.querySelector("summary")?.textContent === "저장·내보내기",
        );
        assert.ok(document.querySelector('[aria-label="태그 입력"]') !== null);
        assert.ok(
          document.querySelector('[aria-label="독자 화면 미리보기"]') !== null,
        );
        assert.ok(!document.body.textContent.includes("게시 준비"));
        assert.ok(!document.body.textContent.includes("WRITE A LITTLE"));
      },
    );
  },
);

test("category action precedes preview and shows the assigned name or empty label", { timeout: 10000 }, async () => {
  for (const [categoryId, label] of [[null, "분류 없음"], ["notes", "기록"]]) {
    await mounted({ post: null }, source({
      revision: null,
      document: { metadata: { id, title: "New", category_id: categoryId }, markdown: "" },
    }), async ({ requests }) => {
      const category = document.querySelector('[aria-label="글 분류"]');
      const preview = document.querySelector('.mock-preview-toggle');
      assert.ok(category !== null);
      assert.equal(category.textContent.replace("⌄", "").trim(), label);
      assert.ok(category.classList.contains("header-action"), "reuse the shared button");
      assert.ok(category.parentElement.nextElementSibling === preview, "category must sit immediately left of preview");
      await act(async () => category.click());
      assert.ok(document.querySelector('dialog') !== null, "keep the category picker");
      assert.equal(requests.length, 0, "opening the picker cannot publish");
    });
  }
});

test("new GitHub posts use the notebook editor and save one paired Markdown/block snapshot", { timeout: 10000 }, async () => {
  await mounted({ post: null }, source({ revision: null, document: { metadata: { id, title: "New" }, markdown: "" } }), async ({ requests }) => {
    assert.ok(document.querySelector('.editor-page.notebook-writing .editor-title') !== null, "Restore the existing writing layout");
    const editable = document.querySelector('.bn-editor[contenteditable="true"]');
    assert.ok(editable !== null, "New posts must use the real BlockNote editor");
    assert.ok(document.querySelector('textarea[aria-label="본문 Markdown"]') === null, "New posts start with block editing");
    const view = editable.editor.view;
    await act(async () => view.dispatch(view.state.tr.insertText("Paired content")));
    await save(requests);
    const operation = requests[0].operation;
    assert.equal(operation.type, "post.create");
    assert.equal(operation.document.metadata.id, id);
    assert.match(operation.document.markdown, /Paired content/);
    assert.equal(operation.editor.documentId, id);
    assert.equal(operation.editor.markdownHash, hash(operation.document.markdown));
    assert.equal(operation.editor.blocks[0].content[0].text, "Paired content");
    assert.equal(operation.baseEditorRevision, null);
  });
});

test("GitHub editor JSON restores toggle children and code settings without browser drafts", { timeout: 10000 }, async () => {
  const markdown = "Saved body";
  const blocks = [
    { id: "toggle", type: "toggleListItem", content: [{ type: "text", text: "Toggle", styles: {} }], children: [{ id: "inside", type: "paragraph", content: [{ type: "text", text: "Inside", styles: {} }], children: [] }] },
    { id: "code", type: "codeBlock", props: { language: "javascript", caption: "Saved caption", wrap: true }, content: [{ type: "text", text: "const n = 1;", styles: {} }], children: [] },
  ];
  await mounted({ post }, source({ document: { metadata: { id, title: "Saved" }, markdown }, editor: { schemaVersion: 1, documentId: id, markdownHash: hash(markdown), blocks }, editorRevision: "d".repeat(64) }), async ({ requests }) => {
    assert.ok(document.querySelector('.bn-editor') !== null, "JSON-backed posts use block editing");
    assert.equal(document.querySelector('.notion-code-caption')?.value, "Saved caption");
    assert.equal(document.querySelector('.notion-code')?.dataset.wrap, "true");
    await save(requests);
    assert.equal(requests[0].operation.baseEditorRevision, "d".repeat(64));
    const toggle = requests[0].operation.editor.blocks.find((block) => block.type === "toggleListItem");
    assert.equal(toggle.children[0].content[0].text, "Inside");
    assert.equal(requests[0].operation.markdown, markdown, "Untouched JSON must preserve its paired Markdown");
  });
});

test("legacy Markdown stays byte-for-byte unchanged until block conversion is chosen", { timeout: 10000 }, async () => {
  const markdown = "\n# Original\n\n<details><summary>Raw</summary>body</details>\n";
  await mounted({ post }, source({ document: { metadata: { id, title: "Saved" }, markdown } }), async ({ requests }) => {
    assert.equal(document.querySelector('textarea')?.value, markdown);
    await save(requests);
    assert.equal(requests[0].operation.markdown, markdown);
    assert.equal(requests[0].operation.editor, undefined);
  });
});

test("malformed block recovery data stays intact and cannot silently become a new document", { timeout: 10000 }, async () => {
  const key = "second-brain:canonical-draft:new";
  const original = source({ revision: null });
  const bytes = JSON.stringify({ revision: null, title: "Recovery", markdown: "Keep", category: "notes", assets: [], requestId: "retry", operation: "save", sourceDocument: original, blocks: [{ type: "unknown" }], markdownHash: hash("Keep") });
  localStorage.setItem(key, bytes);
  await mounted({ post: null }, original, async () => {
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /초안/);
    assert.equal(localStorage.getItem(key), bytes);
    assert.ok(document.querySelector('.bn-editor') === null, "Malformed recovery blocks must not be replaced by an empty editor");
    assert.ok(document.querySelector('button[type="submit"]') === null, "A broken recovery document must not be saved over the original");
  });
});

test("legacy conversion requires explicit confirmation and then saves both formats", { timeout: 10000 }, async () => {
  const previousConfirm = window.confirm;
  try {
    await mounted({ post }, source(), async ({ requests }) => {
      const convert = [...document.querySelectorAll("button")].find((button) => button.textContent === "노션형 블록 편집으로 전환");
      assert.ok(convert !== undefined, "Legacy Markdown offers an explicit block conversion");
      window.confirm = () => false;
      await act(async () => convert.click());
      assert.ok(document.querySelector('.bn-editor') === null, "Declining keeps the source editor");
      window.confirm = () => true;
      await act(async () => convert.click());
      assert.ok(document.querySelector('.bn-editor') !== null, "Confirming opens the existing BlockNote UI");
      await save(requests);
      assert.equal(requests[0].operation.editor.blocks[0].content[0].text, "Original");
      assert.equal(requests[0].operation.editor.markdownHash, hash(requests[0].operation.markdown));
    });
  } finally {
    window.confirm = previousConfirm;
  }
});

test(
  "image uploads preview locally while the saved block and Markdown use a stable relative path",
  { timeout: 10000 },
  async () => {
    await mounted(
      { post: null },
      source({ revision: null }),
      async ({ requests }) => {
        const editable = document.querySelector(
          '.bn-editor[contenteditable="true"]',
        );
        const view = editable.editor.view;
        await act(async () => {
          view.focus();
          const { from, to } = view.state.selection;
          const handled = view.someProp("handleTextInput", (handler) =>
            handler(view, from, to, "/", () => view.state.tr.insertText("/")),
          );
          if (!handled) view.dispatch(view.state.tr.insertText("/", from, to));
        });
        await waitFor(
          () =>
            [...document.querySelectorAll('[role="option"]')].some((item) =>
              item.textContent.includes("이미지"),
            ),
          "slash menu must offer images",
        );
        const imageOption = [
          ...document.querySelectorAll('[role="option"]'),
        ].find((item) => item.textContent.includes("이미지"));
        await act(async () => imageOption.click());
        const field = document.querySelector(
          '.bn-file-panel input[type="file"], .bn-panel input[type="file"]',
        );
        assert.ok(
          field !== null,
          "Image upload is available through the slash menu",
        );
        Object.defineProperty(field, "files", {
          configurable: true,
          value: [
            new dom.window.File(["image"], "photo).png", { type: "image/png" }),
          ],
        });
        await act(async () =>
          field.dispatchEvent(
            new dom.window.Event("change", { bubbles: true }),
          ),
        );
        await waitFor(
          () => document.querySelector(".bn-editor img") !== null,
          "Image preview did not render",
        );
        const image = document.querySelector(".bn-editor img");
        await waitFor(
          () => image.getAttribute("src")?.startsWith("data:image/png"),
          "Uploaded image did not resolve its local preview",
        );
        await save(requests);
        const operation = requests[0].operation;
        const block = operation.editor.blocks.find(
          (item) => item.type === "image",
        );
        assert.equal(block.props.url, "./photo%29.png");
        assert.match(operation.document.markdown, /\.\/photo%29\.png/);
        assert.doesNotMatch(
          JSON.stringify(operation.editor),
          /data:image|blob:/,
        );
        assert.equal(operation.assets[0].name, "photo).png");
      },
    );
  },
);

test(
  "source image previews resolve against the content commit without changing stored URLs",
  { timeout: 10000 },
  async () => {
    const markdown = "![Image](./saved.png)";
    const editor = {
      schemaVersion: 1,
      documentId: id,
      markdownHash: hash(markdown),
      blocks: [
        {
          id: "picture",
          type: "image",
          props: { url: "./saved.png", name: "saved.png" },
          children: [],
        },
      ],
    };
    await mounted(
      { post },
      source({
        editor,
        editorRevision: "d".repeat(64),
        document: { metadata: { id, title: "Saved" }, markdown },
      }),
      async ({ requests }) => {
        await waitFor(
          () =>
            document
              .querySelector(".bn-editor img")
              ?.getAttribute("src")
              ?.startsWith("https://raw.githubusercontent.com/owner/content/"),
          "Existing image preview did not resolve",
        );
        assert.equal(
          document.querySelector(".bn-editor img").getAttribute("src"),
          `https://raw.githubusercontent.com/owner/content/${"b".repeat(40)}/posts/${id}/saved.png`,
        );
        await save(requests);
        assert.equal(
          requests[0].operation.editor.blocks[0].props.url,
          "./saved.png",
        );
      },
    );
  },
);

test("closing editor shortcuts never submits an enclosing save form", async () => {
  const { default: EditorShortcuts } = await loadComponent("src/features/post-editor/EditorShortcuts.tsx");
  let closes = 0;
  let submissions = 0;
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement("form", {
      onSubmit(event) {
        event.preventDefault();
        submissions++;
      },
    }, React.createElement(EditorShortcuts, { onClose() { closes++; } }))));
    const close = document.querySelector('button[aria-label="단축키 닫기"]');
    assert.ok(close !== null);
    await act(async () => close.click());
    assert.equal(closes, 1, "The close action still reaches its consumer");
    assert.equal(submissions, 0, "Closing shortcut help must not submit a GitHub save form");
  } finally {
    await act(async () => root.unmount());
  }
});

test(
  "bare sibling image names resolve to the pinned source asset without rewriting the stored URL",
  { timeout: 10000 },
  async () => {
    const markdown = "![Image](saved%20image.png)";
    const editor = {
      schemaVersion: 1,
      documentId: id,
      markdownHash: hash(markdown),
      blocks: [
        {
          id: "picture",
          type: "image",
          props: { url: "saved%20image.png", name: "saved image.png" },
          children: [],
        },
      ],
    };
    await mounted(
      { post },
      source({
        editor,
        editorRevision: "d".repeat(64),
        assets: [{ name: "saved image.png", sha: "a".repeat(40), size: 5 }],
        document: { metadata: { id, title: "Saved" }, markdown },
      }),
      async ({ requests }) => {
        await waitFor(
          () => document.querySelector(".bn-editor img") !== null,
          "Bare image did not mount",
        );
        assert.equal(
          document.querySelector(".bn-editor img").getAttribute("src"),
          `https://raw.githubusercontent.com/owner/content/${"b".repeat(40)}/posts/${id}/saved%20image.png`,
        );
        await save(requests);
        assert.equal(
          requests[0].operation.editor.blocks[0].props.url,
          "saved%20image.png",
        );
      },
    );
  },
);

for (const staggered of [false, true])
  test(
    `${staggered ? "staggered" : "simultaneous"} sibling uploads preserve every pending attachment`,
    { timeout: 10000 },
    async () => {
      await mounted(
        { post: null },
        source({ revision: null }),
        async ({ requests }) => {
          const previousFetch = globalThis.fetch;
          let uploads = 0;
          globalThis.fetch = async (url, init) => {
            if (url !== "/api/assets") return previousFetch(url, init);
            const index = uploads++;
            await new Promise((resolve) =>
              setTimeout(resolve, index === 0 ? 50 : 10),
            );
            return reply({
              sha: (index === 0 ? "a" : "b").repeat(40),
              size: 5,
            });
          };
          const editor =
            document.querySelector(".bn-editor").editor.view.state.schema.cached
              .blockNoteEditor;
          const firstFile = new dom.window.File(["first"], "first.txt", {
            type: "text/plain",
          });
          const secondFile = new dom.window.File(["later"], "second.txt", {
            type: "text/plain",
          });
          let first;
          let second;
          if (staggered) {
            await act(async () => {
              first = editor.uploadFile(firstFile).then(
                () => true,
                () => false,
              );
            });
            await act(async () => {
              second = editor.uploadFile(secondFile).then(
                () => true,
                () => false,
              );
            });
          } else {
            await act(async () => {
              first = editor.uploadFile(firstFile).then(
                () => true,
                () => false,
              );
              second = editor.uploadFile(secondFile).then(
                () => true,
                () => false,
              );
            });
          }
          let outcomes;
          await act(async () => {
            outcomes = await Promise.all([first, second]);
          });
          assert.deepEqual(
            outcomes,
            [true, true],
            "A sibling upload must not be rejected while another upload runs",
          );
          await save(requests);
          assert.deepEqual(
            requests[0].operation.assets.map((asset) => asset.name).sort(),
            ["first.txt", "second.txt"],
          );
        },
      );
    },
  );

test("invalid GitHub editor JSON permits exact original exports and blocks all fallback saves", { timeout: 10000 }, async () => {
  const markdown = "\n# Keep original bytes\n";
  const raw = "{\n  \"schemaVersion\": 99,\n  invalid JSON\n}\n";
  const downloads = [];
  const createURL = URL.createObjectURL;
  const revokeURL = URL.revokeObjectURL;
  const nativeClick = dom.window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob) => { downloads.push(blob); return "blob:test/export"; };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  try {
    await mounted({ post }, source({ editor: null, editorRevision: "d".repeat(64), editorError: "Unsupported editor version", editorRaw: raw, document: { metadata: { id, title: "Recovery" }, markdown } }), async ({ requests }) => {
      assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /편집 원본/);
      const saveButton = document.querySelector('button[type="submit"]');
      assert.ok(saveButton === null || saveButton.matches(":disabled"), "Invalid source JSON must not be overwritten through the Markdown fallback");
      const convert = [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === "노션형 블록 편집으로 전환");
      assert.ok(convert === undefined || convert.matches(":disabled"), "Invalid source JSON must not be silently converted");
      for (const label of ["Markdown 내보내기", "원본 백업"]) {
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
        assert.ok(button !== undefined, "Recovery export is available");
        await act(async () => button.click());
      }
      assert.equal(await downloads[0].text(), markdown);
      assert.equal(await downloads[1].text(), raw);
      assert.equal(requests.length, 0);
    });
  } finally {
    URL.createObjectURL = createURL;
    URL.revokeObjectURL = revokeURL;
    dom.window.HTMLAnchorElement.prototype.click = nativeClick;
  }
});

async function importBackup(value) {
  const field = document.querySelector('.editor-file input[type="file"]');
  Object.defineProperty(field, "files", { configurable: true, value: [{ name: "recovery.json", size: JSON.stringify(value).length, text: async () => JSON.stringify(value) }] });
  await act(async () => field.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
}

test(
  "recovery import restores metadata and pending/source attachments into the fresh target identity",
  { timeout: 10000 },
  async () => {
    const oldId = "12345678-1234-8234-9234-123456789013";
    const backup = {
      revision: "e".repeat(64),
      title: "Recovered title",
      category: "notes",
      markdown: "![saved](saved.png)\n\n![pending](./pending.png)",
      requestId: "old-request",
      operation: "save",
      assets: [{ name: "pending.png", sha: "b".repeat(40), size: 5 }],
      sourceDocument: source({
        document: { metadata: { id: oldId, title: "Old" }, markdown: "Old" },
        assets: [{ name: "saved.png", sha: "a".repeat(40), size: 5 }],
      }),
      blocks: [
        {
          id: "saved-image",
          type: "image",
          props: { url: "saved.png", name: "saved.png" },
          children: [],
        },
        {
          id: "pending-image",
          type: "image",
          props: { url: "./pending.png", name: "pending.png" },
          children: [],
        },
      ],
    };
    await mounted(
      { post: null },
      source({
        revision: null,
        document: { metadata: { id, title: "Fresh" }, markdown: "" },
      }),
      async ({ requests }) => {
        await importBackup(backup);
        await waitFor(
          () => document.querySelector(".bn-editor img") !== null,
          "Imported block content did not appear",
        );
        assert.equal(
          document.querySelector('input[aria-label="글 제목"]').value,
          "Recovered title",
        );
        assert.ok(
          document
            .querySelector('button[aria-label="글 분류"]')
            ?.textContent.includes("기록"),
        );
        await save(requests);
        const request = requests[0];
        assert.equal(
          request.operation.document.metadata.id,
          id,
          "A content import must keep the fresh target UUID",
        );
        assert.equal(
          request.operation.document.metadata.title,
          "Recovered title",
        );
        assert.equal(request.operation.document.metadata.category_id, "notes");
        assert.ok(
          request.requestId !== "old-request",
          "A content import must not copy an old request identity",
        );
        assert.deepEqual(
          request.operation.assets.map((asset) => asset.name).sort(),
          ["pending.png", "saved.png"],
        );
      },
    );
  },
);

for (const invalidAsset of [
  { name: "../outside.png", sha: "a".repeat(40), size: 5 },
  { name: "%2565ditor.json", sha: "a".repeat(40), size: 5 },
  { name: "good.png", sha: "not-a-sha", size: 5 },
  { name: "good.png", sha: "a".repeat(40), size: 6 * 1024 * 1024 },
])
  test(
    `recovery import rejects unsafe attachment ${invalidAsset.name} ${invalidAsset.size}`,
    { timeout: 10000 },
    async () => {
      await mounted(
        { post: null },
        source({
          revision: null,
          document: { metadata: { id, title: "Fresh" }, markdown: "Keep" },
        }),
        async () => {
          await importBackup({
            title: "Unsafe import",
            category: "notes",
            blocks: [
              {
                id: "paragraph",
                type: "paragraph",
                content: [
                  { type: "text", text: "Should not replace", styles: {} },
                ],
                children: [],
              },
            ],
            assets: [invalidAsset],
          });
          await waitFor(
            () => document.querySelector('[role="alert"]') !== null,
            "Unsafe attachment import must report an error",
          );
          assert.match(
            document.querySelector('[role="alert"]')?.textContent ?? "",
            /첨부/,
          );
          assert.equal(
            document.querySelector('input[aria-label="글 제목"]').value,
            "Fresh",
          );
          assert.doesNotMatch(
            document.querySelector(".bn-editor").textContent,
            /Should not replace/,
          );
        },
      );
    },
  );

test("Cmd/Ctrl+S saves recovery data and prevents browser Save Page without posting to GitHub", { timeout: 10000 }, async () => {
  await mounted({ post: null }, source({ revision: null }), async ({ requests }) => {
    for (const modifier of ["metaKey", "ctrlKey"]) {
      localStorage.clear();
      const event = new dom.window.KeyboardEvent("keydown", { key: "s", [modifier]: true, bubbles: true, cancelable: true });
      await act(async () => window.dispatchEvent(event));
      assert.equal(event.defaultPrevented, true, "The editor shortcut must prevent browser Save Page");
      const recovered = JSON.parse(localStorage.getItem("second-brain:canonical-draft:new"));
      assert.ok(Array.isArray(recovered.blocks) && recovered.blocks.length > 0, "The shortcut keeps the paired block recovery data");
      assert.equal(recovered.markdown, "Original\n");
      assert.equal(requests.length, 0, "The local save shortcut must not publish");
    }
  });
});

test("a damaged remote editor cannot replace an existing unsaved local recovery document", { timeout: 10000 }, async () => {
  const markdown = "Unsaved local body\n";
  const original = source();
  const local = {
    revision: original.revision, title: "Unsaved local title", markdown, category: "notes",
    assets: [{ name: "pending.txt", sha: "a".repeat(40), size: 5 }],
    requestId: "local-request", operation: "save", sourceDocument: original,
    blocks: [{ id: "local-block", type: "paragraph", content: [{ type: "text", text: "Unsaved local body", styles: {} }], children: [] }],
  };
  const key = "second-brain:canonical-draft:" + id;
  const stored = JSON.stringify(local);
  localStorage.setItem(key, stored);
  const downloads = [];
  const createURL = URL.createObjectURL;
  const revokeURL = URL.revokeObjectURL;
  const nativeClick = dom.window.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob) => { downloads.push(blob); return "blob:test/recovery"; };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () {};
  try {
    await mounted({ post }, source({ editorError: "Remote editor is damaged", editorRaw: "{broken remote}", editor: null, editorRevision: "e".repeat(64), document: { metadata: { id, title: "Remote title" }, markdown: "Remote original" } }), async ({ requests }) => {
      await waitFor(() => document.querySelector('[role="alert"]') !== null || document.querySelector('textarea') !== null, "Remote recovery response did not settle");
      assert.equal(document.querySelector('input[aria-label="글 제목"]').value, "Unsaved local title");
      assert.match(document.querySelector('.bn-editor')?.textContent ?? "", /Unsaved local body/);
      assert.equal(localStorage.getItem(key), stored, "Remote failure must preserve the original local backup bytes");
      const saveButton = document.querySelector('button[type="submit"]');
      assert.ok(saveButton === null || saveButton.matches(":disabled"), "The damaged remote source must block saving");
      for (const label of [".md 내보내기", "원본 백업"]) {
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === label);
        assert.ok(button !== undefined);
        await act(async () => button.click());
      }
      assert.equal(await downloads[0].text(), markdown);
      const exported = JSON.parse(await downloads[1].text());
      assert.equal(exported.title, "Unsaved local title");
      assert.equal(exported.markdown, markdown);
      assert.equal(exported.blocks[0].content[0].text, "Unsaved local body");
      assert.equal(exported.assets[0].name, "pending.txt");
      assert.equal(exported.requestId, "local-request");
      assert.equal(exported.sourceDocument.contentCommit, original.contentCommit);
      assert.equal(requests.length, 0);
    });
  } finally {
    URL.createObjectURL = createURL;
    URL.revokeObjectURL = revokeURL;
    dom.window.HTMLAnchorElement.prototype.click = nativeClick;
  }
});

after(() => dom.window.close());

test("tags, category cancellation and reader controls preserve local-only drafts", { timeout: 10000 }, async () => {
  await mounted({ post: null }, source({ revision: null, categories: [
    { id: "notes", name: "기록", parent_id: null },
    { id: "child", name: "하위 분류", parent_id: "notes" },
  ] }), async ({ requests }) => {
    const tagInput = document.querySelector('[aria-label="태그 입력"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(tagInput, "react, typescript");
      tagInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    assert.equal(document.querySelectorAll('.mock-tag-chip').length, 2);
    assert.ok(document.querySelector('.mock-preview-tags')?.textContent.includes("typescript"));
    const categoryButton = document.querySelector('[aria-label="글 분류"]');
    await act(async () => categoryButton.click());
    const child = () => [...document.querySelectorAll('.row-name')].find(item => item.textContent.includes("하위 분류"));
    assert.ok(child() === undefined, "children start collapsed");
    await act(async () => document.querySelector('dialog [data-id="notes"] .expander').click());
    assert.ok(child() !== undefined, "expanding the parent reveals its child");
    await act(async () => child().click());
    const cancel = [...document.querySelectorAll('dialog button')].find(item => item.textContent === "취소");
    await act(async () => cancel.click());
    assert.ok(categoryButton.textContent.includes("기록"), "cancel must retain the current category");
    await act(async () => categoryButton.click());
    assert.ok(child() === undefined, "reopening resets the collapsed tree");
    await act(async () => document.querySelector('dialog [data-id="notes"] .expander').click());
    assert.ok(child() !== undefined, "expanding the reopened parent reveals its child");
    await act(async () => child().click());
    await act(async () => document.querySelector('dialog button[type="submit"]').click());
    assert.ok(categoryButton.textContent.includes("하위 분류"));
    await act(async () => document.querySelector('[aria-label="모바일"]').click());
    assert.ok(document.querySelector('.mock-preview-mobile') !== null);
    await act(async () => document.querySelector('.mock-preview-toggle').click());
    assert.ok(document.querySelector('[aria-label="독자 화면 미리보기"]') === null);
    await act(async () => document.querySelector('.editor-save').click());
    assert.equal(requests.length, 0);
    const stored = JSON.parse(localStorage.getItem("second-brain:canonical-draft:new"));
    assert.deepEqual(stored.tags, ["react", "typescript"]);
    assert.equal(stored.category, "child");
  });
});

test("invalid imported tags preserve the current blocks and recovery bytes", { timeout: 10000 }, async () => {
  await mounted({ post: null }, source({ revision: null }), async () => {
    const before = localStorage.getItem("second-brain:canonical-draft:new");
    await importBackup({ title: "Bad", category: "notes", tags: [1], blocks: [{ type: "paragraph", content: [{ type: "text", text: "Must not replace", styles: {} }] }] });
    await waitFor(() => document.querySelector('[role="alert"]') !== null, "Invalid imported tags must report an error");
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? "", /태그/);
    assert.equal(localStorage.getItem("second-brain:canonical-draft:new"), before);
    assert.ok(!document.querySelector('.bn-editor').textContent.includes("Must not replace"));
  });
});

test("a published local draft resumes with canonical identity and sends update", { timeout: 10000 }, async () => {
  const localPost = { ...post, id: "draft-local", draft: true };
  await mounted({ post: localPost }, source({ revision: null }), async ({ root, requests }) => {
    await save(requests);
    await waitFor(() => document.querySelector('#editor-status')?.textContent === "공개됨", "Published badge did not update");
    const key = "second-brain:canonical-draft:draft-local";
    assert.equal(JSON.parse(localStorage.getItem(key)).canonicalId, id);
    await act(async () => root.render(React.createElement(Editor, { key: "resume", post: { ...post, recoveryKey: "draft-local" }, session, onClose() {} })));
    await waitFor(() => document.querySelector('[aria-label="글 제목"]') !== null, "Resume did not load");
    const reopen = [...document.querySelectorAll('button')].find(item => item.textContent === "최신 원본으로 다시 시작");
    await act(async () => reopen.click());
    await waitFor(() => document.querySelector('textarea') !== null, "Canonical source did not reload");
    const count = requests.length;
    await act(async () => document.querySelector('button[type="submit"]').click());
    await waitFor(() => requests.length > count, "Update request did not arrive");
    assert.equal(requests.at(-1).operation.type, "post.update");
    assert.equal(requests.at(-1).operation.id, id);
  });
});

test("editor confirms a category double-click through the shared dialog without publishing", { timeout: 10000 }, async () => {
  await mounted({ post: null }, source({ revision: null, categories: [
    { id: 'notes', name: '기록', parent_id: null },
    { id: 'child', name: '하위 분류', parent_id: 'notes' },
  ] }), async ({ requests }) => {
    const trigger = document.querySelector('[aria-label="글 분류"]');
    await act(async () => trigger.click());
    assert.ok(document.querySelector('dialog [data-id="child"]') === null, "children start collapsed");
    await act(async () => document.querySelector('dialog [data-id="notes"] .expander').click());
    const child = document.querySelector('dialog [data-id="child"] .row-name');
    assert.ok(child !== null, "expanding the parent reveals its child");
    await act(async () => child.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
    assert.ok(document.querySelector('dialog') === null);
    assert.ok(trigger.textContent.includes('하위 분류'));
    await act(async () => document.querySelector('.editor-save').click());
    const recovery = JSON.parse(localStorage.getItem('second-brain:canonical-draft:new'));
    assert.equal(recovery.category, 'child');
    assert.equal(requests.length, 0);
  });
});
