import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { loadComponent } from "./support/load-component.mjs";

const { default: HomePage } = await loadComponent("src/pages/home/HomePage.tsx");
const post = {
  id: "article",
  title: "긴 제목으로 작성한 아티클",
  parentId: null,
  category: "개발",
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  markdown: "본문",
  excerpt: "요약",
  path: "article.md",
  url: "",
};

function render(posts) {
  return new JSDOM(renderToStaticMarkup(React.createElement(HomePage, { posts })));
}

test("home shows four newest published articles without mutating archive order", () => {
  const posts = [2, 6, 1, 4, 3, 5].map((day) => ({
    ...post,
    id: "p" + day,
    createdAt: `2026-10-0${day}T00:00:00.000Z`,
    updatedAt: `2026-11-0${7 - day}T00:00:00.000Z`,
  }));
  posts.unshift({ ...post, id: "draft", draft: true });
  const original = [...posts];
  const dom = render(posts);
  try {
    const document = dom.window.document;
    const cards = [...document.querySelectorAll(".home-article-card")];
    assert.deepEqual(cards.map((card) => card.getAttribute("href")), [
      "#/post/p6", "#/post/p5", "#/post/p4", "#/post/p3",
    ]);
    assert.deepEqual(posts, original);
    assert.equal(document.querySelectorAll(".home-popular-link").length, 5);
    assert.match(document.querySelector(".home-popular").textContent, /순위 예시/);
    assert.match(document.querySelector(".home-popular").textContent, /조회수 연동 전/);
    assert.equal(document.querySelector('a[href="#/post/draft"]'), null);
    assert.equal(document.querySelector('input[type="search"]'), null);
    assert.equal(document.querySelector(".category-filter"), null);
    assert.equal(document.querySelector(".all-posts"), null);
    assert.equal(document.querySelector(".writing-invitation"), null);
    assert.ok(document.querySelector('main a[href="#/records"]'));
    assert.match(document.querySelector("#latest-articles-title").textContent, /최신 아티클/);
    assert.match(document.querySelector("#popular-articles-title").textContent, /인기 아티클/);
  } finally {
    dom.window.close();
  }
});

test("home keeps small archives usable and places undated articles last", () => {
  const dom = render([
    { ...post, id: "undated", createdAt: "" },
    { ...post, id: "published" },
  ]);
  try {
    assert.deepEqual(
      [...dom.window.document.querySelectorAll(".home-article-card")].map(
        (card) => card.getAttribute("href"),
      ),
      ["#/post/published", "#/post/undated"],
    );
    assert.equal(dom.window.document.querySelectorAll(".home-popular-link").length, 2);
    assert.match(dom.window.document.body.textContent, /날짜 없음/);
  } finally {
    dom.window.close();
  }
});

test("home explains an empty published archive and links to records", () => {
  const dom = render([{ ...post, draft: true }]);
  try {
    assert.equal(dom.window.document.querySelectorAll(".home-article-card").length, 0);
    assert.equal(dom.window.document.querySelectorAll(".home-popular-link").length, 0);
    assert.match(dom.window.document.body.textContent, /공개한 아티클이 아직 없습니다/);
    assert.ok(dom.window.document.querySelector('main a[href="#/records"]'));
  } finally {
    dom.window.close();
  }
});
