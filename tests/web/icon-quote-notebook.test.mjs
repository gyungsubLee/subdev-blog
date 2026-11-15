import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadComponent } from "../support/load-component.mjs";

const { default: MarkdownContent } = await loadComponent("app/web/src/features/post-reader/MarkdownContent.tsx");
const post = { id: "test", title: "검사", markdown: "", path: "test.md" };

function render(body, check) {
  const dom = new JSDOM(renderToStaticMarkup(createElement(MarkdownContent, {
    body, post, posts: [post],
  })));
  try {
    check(dom.window.document);
  } finally {
    dom.window.close();
  }
}

test("icon-prefixed quotes use notebook paper and preserve their formatted content", () => {
  for (const icon of ["✏️", "📖", "☝🏻", "⚠️", "🇰🇷", "1️⃣", "/icons/push-pin_green.svg"]) {
    render(`> <a id="before"></a>\n>\n> **${icon} 정의**\n>\n> 문장과 \`코드\`\n>\n> - 항목\n>\n> ![](example.webp)`, (document) => {
      assert.equal(document.querySelectorAll("section.ivory-notebook").length, 1, icon);
      assert.equal(document.querySelectorAll(".notebook-holes i").length, 3);
      assert.equal(document.querySelector(".ivory-notebook-content strong")?.textContent, `${icon} 정의`);
      assert.equal(document.querySelector(".ivory-notebook-content code")?.textContent, "코드");
      assert.equal(document.querySelector(".ivory-notebook-content li")?.textContent, "항목");
      assert.equal(document.querySelector(".ivory-notebook-content img")?.getAttribute("src"), "example.webp");
      assert.ok(document.querySelector("blockquote") === null);
    });
  }
});

test("ordinary quotes, body emoji, images and TOCs retain their existing rendering", () => {
  for (const body of ["> 일반 인용문", "> 본문 중간 ✏️ 아이콘", "> 1. 숫자 목록", "> ![](photo.webp)\n>\n> ✏️ 사진 설명", "> 목차\n>\n> - [항목](#heading)"]) {
    render(body, (document) => {
      assert.equal(document.querySelectorAll(".ivory-notebook").length, 0, body);
      assert.equal(document.querySelectorAll("blockquote").length, 1);
    });
  }
  render("> 목차\n>\n> - [항목](#heading)", (document) => {
    assert.equal(document.querySelectorAll(".article-toc").length, 1);
  });
});

test("a nested icon quote does not convert its ordinary parent", () => {
  render("> 일반 인용문\n>\n> > 💡 내부 메모\n> >\n> > 내용", (document) => {
    assert.equal(document.querySelectorAll("body > blockquote").length, 1);
    assert.equal(document.querySelectorAll("blockquote > .ivory-notebook").length, 1);
  });
});

test("icon quote anchors survive and an icon after a list is not a quote marker", () => {
  render('<blockquote id="note"><p>💡 메모</p></blockquote>', (document) => {
    assert.ok(document.querySelector("section.ivory-notebook#user-content-note") !== null);
  });
  render("> - 목록\n>\n> ✏️ 뒤쪽 이모지", (document) => {
    assert.equal(document.querySelectorAll(".ivory-notebook").length, 0);
  });
});

test("the reported statistics post renders all seven icon quotes including the variance image", async () => {
  const source = await readFile("content/posts/3f2eda9b-0fe1-80db-84ad-c844a2eb9f9f/평균, 분산, 표준편차.md", "utf8");
  render(source.replace(/^---\n[\s\S]*?\n---\n/, ""), (document) => {
    assert.equal(document.querySelectorAll(".ivory-notebook").length, 7);
    const image = document.querySelector('.ivory-notebook img[src="04570827f0e7d206.webp"]');
    assert.ok(image !== null);
    assert.match(image.closest(".ivory-notebook").textContent, /얼마나 떨어져있는지/);
  });
});
