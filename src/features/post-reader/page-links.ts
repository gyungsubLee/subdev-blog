import { postHref } from "../../shared/routes";
import type { Post } from "../../shared/post";

export function pageLink(href: string, current: Post, posts: Post[]) {
  if (href.startsWith("#")) return href;
  const fragment = href.split("#")[1];
  const articleHref = (target: Post) =>
    postHref(target.id, fragment);
  const id = href
    .match(
      /[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
    )?.[0]
    ?.replaceAll("-", "");
  if (id) {
    const target = posts.find((post) => post.id.replaceAll("-", "") === id);
    if (target) return articleHref(target);
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return href;
  try {
    const path = decodeURIComponent(
      new URL(href, "https://archive.local/" + current.path).pathname,
    ).replace(/^\//, "");
    const target = posts.find((post) => post.path.replace(/^\//, "") === path);
    if (target) return articleHref(target);
  } catch {
    return href;
  }
  return href;
}

export function scrollToFragment(fragment: string) {
  let id = fragment;
  try {
    id = decodeURIComponent(fragment);
  } catch {
    // Keep malformed escapes literal instead of leaving the article route.
  }
  let target =
    document.getElementById(id) ||
    document.getElementById("user-content-" + id);
  if (!target) {
    const seen = new Map<string, number>();
    for (const heading of document.querySelectorAll<HTMLElement>(
      ".article-prose h1, .article-prose h2, .article-prose h3, .article-prose h4, .article-prose h5, .article-prose h6",
    )) {
      const slug = (heading.textContent || "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, "")
        .trim()
        .replace(/\s/g, "-");
      const count = seen.get(slug) || 0;
      seen.set(slug, count + 1);
      if ((count ? slug + "-" + count : slug) === id) {
        target = heading;
        break;
      }
    }
  }
  target?.scrollIntoView({
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
    block: "start",
  });
}
