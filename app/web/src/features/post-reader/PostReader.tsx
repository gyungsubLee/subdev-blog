import { useEffect } from "react";
import type { Post } from "../../shared/post";
import { getBody } from "../../shared/post-content";
import MarkdownContent from "./MarkdownContent";
import { scrollToFragment } from "./page-links";
import "./post-reader.css";

function headingText(source: string) {
  const namedEntities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: "\u00a0",
  };
  return source
    .replace(/<[^>]+>/g, "")
    .replace(/[*_\x60]/g, "")
    .replace(
      /&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos|nbsp);/gi,
      (entity, name: string) => {
        if (!name.startsWith("#")) return namedEntities[name.toLowerCase()];
        const hex = name[1].toLowerCase() === "x";
        const codePoint = Number.parseInt(name.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (
          codePoint <= 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          return entity;
        }
        return String.fromCodePoint(codePoint);
      },
    );
}

export default function PostReader({
  post,
  posts,
  hash,
}: {
  post: Post;
  posts: Post[];
  hash: string;
}) {
  const body = getBody(post);
  const requestedHeading =
    hash.match(/^#\/post\/[^#]+#(.+)$/)?.[1] ||
    new URLSearchParams(hash.split("?")[1] || "").get("heading");
  useEffect(() => {
    if (!requestedHeading || post.bodyLoaded === false) return;
    const frame = requestAnimationFrame(() =>
      scrollToFragment(requestedHeading),
    );
    return () => cancelAnimationFrame(frame);
  }, [requestedHeading, post.id, post.bodyLoaded]);
  const headings: { title: string; line: number; level: number }[] = [];
  let fence = "";
  body.split("\n").forEach((line, index) => {
    const marker = line.match(/^\s*(\x60{3}|~~~)/)?.[1];
    if (marker) fence = fence ? "" : marker;
    if (fence) return;
    const markdownHeading = line.match(/^(#{1,3})\s+(.+)$/);
    const heading =
      markdownHeading ?? line.match(/^\s*<h([1-3])\b[^>]*>(.*?)<\/h\1>/i);
    if (heading)
      headings.push({
        title: headingText(heading[2]),
        line: index + 1,
        level: markdownHeading ? heading[1].length : Number(heading[1]),
      });
  });
  const scrollBehavior = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth";

  return (
    <div className="article-layout">
      <aside className="article-sidebar">
        {headings.length ? (
          <nav aria-label="글 목차">
            <span className="eyebrow">이 글에서</span>
            {headings.map((heading) => (
              <button
                key={heading.line}
                className={"toc-level-" + heading.level}
                type="button"
                onClick={() =>
                  document
                    .getElementById("heading-" + heading.line)
                    ?.scrollIntoView({
                      behavior: scrollBehavior(),
                      block: "start",
                    })
                }
              >
                {heading.title}
              </button>
            ))}
          </nav>
        ) : null}
        {!post.draft && post.url ? (
          <a
            className="source-link"
            href={post.url}
            target="_blank"
            rel="noreferrer"
          >
            노션 원문 <span aria-hidden="true">↗</span>
          </a>
        ) : null}
      </aside>
      <div className="article-prose" aria-busy={post.bodyLoaded === false}>
        {post.bodyLoaded === false ? (
          <div className="article-loading" role="status">
            <p>글을 불러오는 중입니다.</p>
            <span />
            <span />
            <span />
          </div>
        ) : (
          <MarkdownContent body={body} post={post} posts={posts} />
        )}
        {post.bodyLoaded !== false && !body.trim() ? (
          <p className="empty-body">이 페이지에는 본문이 없습니다.</p>
        ) : null}
      </div>
    </div>
  );
}
