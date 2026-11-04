import { postHref } from "../../shared/routes";
import type { Post } from "../../shared/post";

export function pageLink(href: string, current: Post, posts: Post[]) {
  if (href.startsWith("#")) return href;
  if (href.startsWith("/content/assets/") || href.startsWith("/notion/assets/"))
    return href;

  const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href);
  try {
    // Post.path is a literal filename; only href is URL-encoded input.
    const currentPath = current.path.split("/").map(encodeURIComponent).join("/");
    const url = new URL(href, "https://archive.local/" + currentPath.replace(/^\//, ""));
    const path = decodeURIComponent(url.pathname).replace(/^\//, "");
    let pageName = path.split("/").at(-1) ?? "";
    if (external) {
      if (!/(?:^|\.)(?:notion\.so|notion\.site)$/i.test(url.hostname))
        return href;
      pageName = path.replace(/\/$/, "").split("/").at(-1) ?? "";
    } else {
      if (!/\.md$/i.test(pageName)) return href;
      const target = posts.find((post) => post.path.replace(/^\//, "") === path);
      if (target) return postHref(target.id, url.hash.slice(1) || undefined);
      pageName = pageName.replace(/\.md$/i, "");
    }
    const id = pageName.match(
      /([a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i,
    )?.[1]?.replaceAll("-", "").toLowerCase();
    const target = id && posts.find((post) => post.id.replaceAll("-", "").toLowerCase() === id);
    if (target) return postHref(target.id, url.hash.slice(1) || undefined);
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
