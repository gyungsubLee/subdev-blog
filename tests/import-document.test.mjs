import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBlockBackup,
  parseMarkdownDocument,
} from "../src/shared/document.mjs";
import { markdownDocument } from "../src/shared/document.mjs";

test("exported Markdown restores title, category, IDs and body without a duplicate H1", () => {
  const draft = {
    id: "draft-05f7ecaa-ed14-4adb-a610-d0524197987a",
    title: "제목: 왕복",
    category: "개발",
    createdAt: "2026-10-22",
    updatedAt: "2026-10-22",
    markdown: "## 실제 본문\n\n코드 \x60값\x60",
  };
  const imported = parseMarkdownDocument(markdownDocument(draft));
  assert.equal(imported.title, draft.title);
  assert.equal(imported.category, draft.category);
  assert.equal(imported.id, draft.id.slice(6));
  assert.equal(imported.markdown.trim(), draft.markdown);
});

test("an unrelated first heading remains in the body", () => {
  const imported = parseMarkdownDocument(
    '---\ntitle: "문서"\ncategory: "개발"\n---\n\n# 본문 제목\n\n내용',
  );
  assert.match(imported.markdown, /# 본문 제목/);
  assert.equal(imported.title, "문서");
});

test("plain Markdown imports its first heading as the document title", () => {
  const imported = parseMarkdownDocument("# 새 글\n\n내용");
  assert.equal(imported.title, "새 글");
  assert.equal(imported.markdown.trim(), "내용");
});

test("invalid backup metadata fails before the document can be replaced", () => {
  assert.throws(
    () =>
      parseBlockBackup(
        JSON.stringify({
          title: "제목",
          category: 123,
          blocks: [{ type: "paragraph" }],
        }),
      ),
    /문자열/,
  );
  assert.throws(
    () =>
      parseMarkdownDocument('---\ntitle: "제목"\ncategory: 123\n---\n\n본문'),
    /문자열/,
  );
  assert.deepEqual(
    parseBlockBackup('{"title":"제목","blocks":[{"type":"paragraph"}]}')
      .category,
    "기록",
  );
});

test("horizontal rules do not discard the enclosed body", () => {
  const markdown = "---\nKeep this paragraph.\n---\n\nMore content.";
  assert.equal(parseMarkdownDocument(markdown).markdown, markdown);
});
