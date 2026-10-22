import {
  Children,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Post } from "./types";

type BlogProps = {
  posts: Post[];
  onWrite: () => void;
  onEdit: (post: Post) => void;
};

const markdownSchema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, src: ["http", "https", "data"] },
};

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "날짜 없음" : dateFormat.format(date);
}

function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      className={back ? "arrow-back" : undefined}
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NotebookArt({ variant = 0 }: { variant?: number }) {
  return (
    <svg
      className={"notebook-art art-" + variant}
      viewBox="0 0 600 360"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="art-branch"
        d="M300 84v64M300 148H146v70M300 148h154v70M300 148v90"
      />
      <rect className="art-page" x="252" y="30" width="96" height="64" rx="5" />
      <rect
        className="art-page"
        x="92"
        y="215"
        width="108"
        height="90"
        rx="5"
        transform="rotate(-8 146 260)"
      />
      <rect
        className="art-page"
        x="246"
        y="231"
        width="108"
        height="90"
        rx="5"
        transform="rotate(5 300 276)"
      />
      <rect
        className="art-page"
        x="400"
        y="215"
        width="108"
        height="90"
        rx="5"
        transform="rotate(-4 454 260)"
      />
      <path
        className="art-rule"
        d="M273 52h40m-40 12h54m-54 12h30M113 240h52m-52 15h61m-61 15h41M268 256h51m-51 15h62m-62 15h40M422 240h51m-51 15h62m-62 15h40"
      />
      <circle className="art-dot" cx="300" cy="149" r="7" />
      <path
        className="art-spark"
        d="m493 62 9 20 21 5-21 8-9 21-7-21-21-8 21-5 7-20ZM79 105l5 12 13 4-13 5-5 13-4-13-12-5 12-4 4-12Z"
      />
    </svg>
  );
}

function PostArt({ post, variant = 0 }: { post: Post; variant?: number }) {
  const image =
    post.cover ||
    post.markdown.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/)?.[1];
  return (
    <div className={"post-art post-art-" + (variant % 3)}>
      {image ? (
        <img src={image} alt="" loading="lazy" />
      ) : (
        <NotebookArt variant={variant % 3} />
      )}
    </div>
  );
}

function downloadMarkdown(post: Post) {
  const url = URL.createObjectURL(
    new Blob([post.markdown], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = post.title.replace(/[\\/:*?"<>|]/g, "-") + ".md";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function getBody(post: Post) {
  const body = post.markdown;
  const firstHeading = body.match(/^\s*# ([^\n]+)\r?\n/);
  return firstHeading?.[1].trim() === post.title.trim()
    ? body.replace(firstHeading[0], "")
    : body;
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [message, setMessage] = useState("복사");
  const code = Children.toArray(children).find((child) =>
    isValidElement(child),
  );
  const language = isValidElement<{ className?: string }>(code)
    ? code.props.className?.replace("language-", "") || "코드"
    : "코드";
  async function copy() {
    try {
      await navigator.clipboard.writeText(pre.current?.textContent || "");
      setMessage("복사함");
    } catch {
      setMessage("복사 실패");
    }
    window.setTimeout(() => setMessage("복사"), 2000);
  }
  return (
    <figure className="article-code">
      <figcaption>
        <span>{language}</span>
        <button type="button" onClick={copy} aria-live="polite">
          {message}
        </button>
      </figcaption>
      <pre ref={pre}>{children}</pre>
    </figure>
  );
}

function pageLink(href: string, current: Post, posts: Post[]) {
  if (href.startsWith("#")) return href;
  const fragment = href.split("#")[1];
  const articleHref = (target: Post) =>
    "#/post/" + target.id + (fragment ? "#" + fragment : "");
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

function scrollToFragment(fragment: string) {
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

function PageTree({ posts, onClose }: { posts: Post[]; onClose: () => void }) {
  const ids = new Set(posts.map((post) => post.id));
  const roots = posts.filter(
    (post) => !post.parentId || !ids.has(post.parentId),
  );
  const childrenByParent = new Map<string | null, Post[]>();
  for (const post of posts) {
    const children = childrenByParent.get(post.parentId) || [];
    children.push(post);
    childrenByParent.set(post.parentId, children);
  }
  const [openIds, setOpenIds] = useState(
    () => new Set(roots.map((post) => post.id)),
  );

  function branch(post: Post, ancestors: Set<string>): ReactNode {
    if (ancestors.has(post.id)) return null;
    const children = childrenByParent.get(post.id) || [];
    const next = new Set([...ancestors, post.id]);
    const link = (
      <a href={"#/post/" + post.id} onClick={onClose}>
        <span aria-hidden="true">{children.length ? "▧" : "▤"}</span>
        {post.title}
        {post.draft ? <small>초안</small> : null}
      </a>
    );
    if (!children.length) return <li key={post.id}>{link}</li>;
    const isOpen = openIds.has(post.id);
    return (
      <li key={post.id}>
        <details
          open={isOpen}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setOpenIds((current) => {
              if (current.has(post.id) === open) return current;
              const updated = new Set(current);
              if (open) updated.add(post.id);
              else updated.delete(post.id);
              return updated;
            });
          }}
        >
          <summary>{link}</summary>
          {isOpen ? (
            <ul>{children.map((child) => branch(child, next))}</ul>
          ) : null}
        </details>
      </li>
    );
  }
  return (
    <ul className="page-tree">
      {roots.map((post) => branch(post, new Set()))}
    </ul>
  );
}

function Article({
  post,
  posts,
  onEdit,
}: {
  post: Post;
  posts: Post[];
  onEdit: (post: Post) => void;
}) {
  const body = getBody(post);
  const requestedHeading =
    window.location.hash.match(/^#\/post\/[^#]+#(.+)$/)?.[1] ||
    new URLSearchParams(window.location.hash.split("?")[1] || "").get(
      "heading",
    );
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
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading)
      headings.push({
        title: heading[2].replace(/[*_\x60]/g, ""),
        line: index + 1,
        level: heading[1].length,
      });
  });
  const ancestors: Post[] = [];
  const visited = new Set([post.id]);
  let parent = posts.find((item) => item.id === post.parentId);
  while (parent && !visited.has(parent.id)) {
    ancestors.unshift(parent);
    visited.add(parent.id);
    parent = posts.find((item) => item.id === parent?.parentId);
  }
  const siblings = posts.filter((item) => item.parentId === post.parentId);
  const index = siblings.findIndex((item) => item.id === post.id);
  const readingMinutes = Math.max(1, Math.ceil(body.split(/\s+/).length / 200));
  const scrollBehavior = () =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth";

  return (
    <main id="main-content" className="article-page" tabIndex={-1}>
      <div className="article-topline">
        <a className="back-link" href="#/">
          <Arrow back /> 전체 글
        </a>
        <div className="article-actions">
          <button
            className="quiet-button"
            type="button"
            disabled={post.bodyLoaded === false}
            onClick={() => downloadMarkdown(post)}
          >
            Markdown 내려받기 <span aria-hidden="true">↓</span>
          </button>
          <button
            className="outline-button"
            type="button"
            disabled={post.bodyLoaded === false}
            onClick={() => onEdit(post)}
          >
            편집하기
          </button>
        </div>
      </div>
      <header className="article-header">
        <nav className="breadcrumbs" aria-label="페이지 경로">
          {ancestors.map((ancestor) => (
            <a key={ancestor.id} href={"#/post/" + ancestor.id}>
              {ancestor.title}
              <span aria-hidden="true">/</span>
            </a>
          ))}
          <span>{post.category}</span>
        </nav>
        <h1>{post.title}</h1>
        <div className="article-meta">
          <span>경섭의 기록</span>
          <span aria-hidden="true">·</span>
          <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
          <span aria-hidden="true">·</span>
          <span>
            {post.bodyLoaded === false
              ? "본문 불러오는 중"
              : readingMinutes + "분 읽기"}
          </span>
        </div>
        {post.draft ? (
          <p className="draft-note">
            이 브라우저의 초안입니다. 공개 블로그에는 아직 발행하지 않았습니다.
          </p>
        ) : null}
      </header>
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
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]}
              urlTransform={(url, key, node) =>
                key === "src" &&
                node.tagName === "img" &&
                /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=]+$/i.test(
                  url,
                )
                  ? url
                  : defaultUrlTransform(url)
              }
              components={{
                h1: ({ node, children }) => (
                  <h1 id={"heading-" + node?.position?.start.line}>
                    {children}
                  </h1>
                ),
                h2: ({ node, children }) => (
                  <h2 id={"heading-" + node?.position?.start.line}>
                    {children}
                  </h2>
                ),
                h3: ({ node, children }) => (
                  <h3 id={"heading-" + node?.position?.start.line}>
                    {children}
                  </h3>
                ),
                pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
                a: ({ href, id, children }) => {
                  if (!href) return <a id={id}>{children}</a>;
                  const url = pageLink(href || "", post, posts);
                  if (url.startsWith("#") && !url.startsWith("#/")) {
                    return (
                      <a
                        href={url}
                        onClick={(event) => {
                          event.preventDefault();
                          scrollToFragment(url.slice(1));
                        }}
                      >
                        {children}
                      </a>
                    );
                  }
                  return (
                    <a
                      href={url}
                      target={/^https?:/.test(url) ? "_blank" : undefined}
                      rel={/^https?:/.test(url) ? "noreferrer" : undefined}
                    >
                      {children}
                    </a>
                  );
                },
                img: ({ src, alt }) =>
                  src ? (
                    <img src={src} alt={alt || ""} loading="lazy" />
                  ) : alt ? (
                    <span className="missing-image">{alt}</span>
                  ) : null,
                table: ({ children }) => (
                  <div className="table-scroll">
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {body}
            </ReactMarkdown>
          )}
          {post.bodyLoaded !== false && !body.trim() ? (
            <p className="empty-body">이 페이지에는 본문이 없습니다.</p>
          ) : null}
        </div>
      </div>
      <nav className="article-pagination" aria-label="다른 글">
        {index > 0 ? (
          <a href={"#/post/" + siblings[index - 1].id}>
            <span>이전 글</span>
            <strong>{siblings[index - 1].title}</strong>
          </a>
        ) : (
          <span />
        )}
        {index < siblings.length - 1 ? (
          <a href={"#/post/" + siblings[index + 1].id}>
            <span>다음 글</span>
            <strong>{siblings[index + 1].title}</strong>
          </a>
        ) : null}
      </nav>
    </main>
  );
}

export default function Blog({ posts, onWrite, onEdit }: BlogProps) {
  const [hash, setHash] = useState(window.location.hash);
  const [category, setCategory] = useState("전체");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(12);
  const [dialog, setDialog] = useState<"tree" | "about" | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const selectedId = hash.match(/^#\/post\/([^/?#]+)/)?.[1];
  const selected = posts.find((post) => post.id === selectedId);
  const categories = [
    ...new Set(posts.map((post) => post.category).filter(Boolean)),
  ];
  const words = query.toLocaleLowerCase().trim();
  const filtered = posts.filter(
    (post) =>
      (category === "전체" || post.category === category) &&
      (!words ||
        (post.title + " " + post.excerpt + " " + post.markdown)
          .toLocaleLowerCase()
          .includes(words)),
  );
  const featured =
    posts.find((post) => !post.draft && getBody(post).length > 300) || posts[0];
  const secondary = posts
    .filter((post) => post.id !== featured?.id)
    .slice(0, 2);

  useEffect(() => {
    function change() {
      setHash(window.location.hash);
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    document.title = selected
      ? selected.title + " — Second Brain"
      : "Second Brain — 경섭의 기록";
  }, [selected]);
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        target.isContentEditable ||
        /INPUT|TEXTAREA|SELECT/.test(target.tagName) ||
        dialogRef.current?.open
      )
        return;
      if (event.key === "/" && !selectedId) {
        event.preventDefault();
        search.current?.focus();
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [selectedId]);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);

  return (
    <div className="blog-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        본문으로 이동
      </a>
      <header className="site-header">
        <a href="#/" className="wordmark" aria-label="Second Brain 홈">
          <svg
            width="30"
            height="30"
            viewBox="0 0 30 30"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 7c5-2 8 0 11 3 3-3 6-5 11-3v17c-5-2-8 0-11 3-3-3-6-5-11-3V7Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M15 10v17M8 11l3 1m-3 4 3 1m8-5 3-1m-3 6 3-1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <span>
            Second Brain<span className="brand-period">.</span>
          </span>
        </a>
        <nav className="header-navigation" aria-label="주 메뉴">
          <a href="#/" aria-current={!selectedId ? "page" : undefined}>
            기록
          </a>
          <button type="button" onClick={() => setDialog("tree")}>
            페이지 탐색
          </button>
          <button type="button" onClick={() => setDialog("about")}>
            소개
          </button>
        </nav>
        <button
          className="dark-button header-write"
          type="button"
          onClick={onWrite}
        >
          글 쓰기 <span aria-hidden="true">↗</span>
        </button>
      </header>
      {selectedId ? (
        selected ? (
          <Article post={selected} posts={posts} onEdit={onEdit} />
        ) : (
          <main id="main-content" className="missing-page" tabIndex={-1}>
            <span className="eyebrow">PAGE NOT FOUND</span>
            <h1>글을 찾지 못했습니다.</h1>
            <p>주소를 확인하거나 전체 글에서 다시 선택하십시오.</p>
            <a className="dark-button" href="#/">
              전체 글 보기 <Arrow />
            </a>
          </main>
        )
      ) : (
        <main id="main-content" tabIndex={-1}>
          <section className="blog-intro" aria-labelledby="blog-title">
            <div>
              <p className="eyebrow">경섭의 기록</p>
              <h1 id="blog-title">
                배우고, 만들고,
                <br />
                <span>기록합니다.</span>
              </h1>
            </div>
            <p>
              개발하며 만난 질문과 배운 것을 씁니다.
              <br />
              생각을 연결하고, 다시 꺼내 보는 공간.
            </p>
          </section>
          {featured && !words && category === "전체" ? (
            <section className="featured-grid" aria-label="대표 글">
              <a className="featured-card" href={"#/post/" + featured.id}>
                <PostArt post={featured} />
                <div className="featured-copy">
                  <div className="post-meta">
                    <span>{featured.category}</span>
                    <span>
                      {featured.draft ? "초안" : formatDate(featured.createdAt)}
                    </span>
                  </div>
                  <h2>{featured.title}</h2>
                  <p>{featured.excerpt}</p>
                  <span className="read-link">
                    글 읽기 <Arrow />
                  </span>
                </div>
              </a>
              <div className="secondary-posts">
                {secondary.map((post, index) => (
                  <a
                    className="secondary-card"
                    key={post.id}
                    href={"#/post/" + post.id}
                  >
                    <div className="secondary-copy">
                      <div className="post-meta">
                        <span>{post.category}</span>
                      </div>
                      <h2>{post.title}</h2>
                      <div className="secondary-bottom">
                        <span>
                          {post.draft
                            ? "이 브라우저의 초안"
                            : formatDate(post.createdAt)}
                        </span>
                        <Arrow />
                      </div>
                    </div>
                    <PostArt post={post} variant={index + 1} />
                  </a>
                ))}
              </div>
            </section>
          ) : null}
          <section className="all-posts" aria-labelledby="all-posts-title">
            <div className="section-heading">
              <h2 id="all-posts-title">
                모든 기록 <span>{posts.length}</span>
              </h2>
              <label className="search-field">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="10.5"
                    cy="10.5"
                    r="6.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="m16 16 4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <span className="sr-only">제목과 요약 검색</span>
                <input
                  ref={search}
                  type="search"
                  value={query}
                  placeholder="기록 검색"
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(12);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setQuery("");
                      search.current?.blur();
                    }
                  }}
                />
                <kbd aria-hidden="true">/</kbd>
              </label>
            </div>
            <div className="category-tabs" role="group" aria-label="카테고리">
              {["전체", ...categories].map((name) => (
                <button
                  type="button"
                  key={name}
                  aria-pressed={category === name}
                  onClick={() => {
                    setCategory(name);
                    setLimit(12);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <p className="result-count" role="status">
              {words ? "“" + query + "” 검색 결과 " : ""}
              {filtered.length}개의 기록
            </p>
            {filtered.length ? (
              <div className="post-grid">
                {filtered.slice(0, limit).map((post, index) => (
                  <a
                    className="post-card"
                    key={post.id}
                    href={"#/post/" + post.id}
                  >
                    <PostArt post={post} variant={index} />
                    <div className="post-meta">
                      <span>{post.category}</span>
                      {post.draft ? (
                        <span className="draft-badge">초안</span>
                      ) : null}
                    </div>
                    <h3>{post.title}</h3>
                    <p>{post.excerpt}</p>
                    <div className="card-bottom">
                      <time dateTime={post.createdAt}>
                        {formatDate(post.createdAt)}
                      </time>
                      <Arrow />
                    </div>
                  </a>
                ))}
              </div>
            ) : (
              <div className="empty-results">
                <h3>
                  {posts.length
                    ? "검색한 기록이 없습니다."
                    : "수집한 기록이 아직 없습니다."}
                </h3>
                <p>
                  {posts.length
                    ? "다른 검색어 또는 카테고리를 선택하십시오."
                    : "수집 상태를 확인하거나 첫 글을 작성하십시오."}
                </p>
                <button
                  className="outline-button"
                  type="button"
                  onClick={() => {
                    if (posts.length) {
                      setQuery("");
                      setCategory("전체");
                    } else onWrite();
                  }}
                >
                  {posts.length ? "전체 글 보기" : "글 쓰기"}
                </button>
              </div>
            )}
            {filtered.length > limit ? (
              <div className="load-more">
                <button
                  className="outline-button"
                  type="button"
                  onClick={() => setLimit((value) => value + 12)}
                >
                  더 보기 <span aria-hidden="true">↓</span>
                </button>
                <span>
                  {Math.min(limit, filtered.length)} / {filtered.length}
                </span>
              </div>
            ) : null}
          </section>
          <section className="writing-invitation">
            <div>
              <span className="eyebrow">한 편의 기록에서 시작합니다</span>
              <h2>다음 생각을 남겨 보세요.</h2>
            </div>
            <button className="dark-button" type="button" onClick={onWrite}>
              새 글 쓰기 <Arrow />
            </button>
          </section>
        </main>
      )}
      <footer className="site-footer">
        <a href="#/" className="footer-wordmark">
          Second Brain.
        </a>
        <span>배운 것을 기록하고, 기록한 것을 연결합니다.</span>
        <button
          type="button"
          onClick={() =>
            window.scrollTo({
              top: 0,
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
                .matches
                ? "instant"
                : "smooth",
            })
          }
        >
          맨 위로 ↑
        </button>
      </footer>
      <dialog
        className="site-dialog"
        ref={dialogRef}
        onCancel={() => setDialog(null)}
        onClose={() => setDialog(null)}
        onClick={(event) => {
          if (event.target === dialogRef.current) setDialog(null);
        }}
      >
        <div className="dialog-topline">
          <h2>{dialog === "tree" ? "페이지 탐색" : "Second Brain"}</h2>
          <button
            type="button"
            aria-label="창 닫기"
            onClick={() => setDialog(null)}
          >
            ×
          </button>
        </div>
        {dialog === "tree" ? (
          <>
            <p className="dialog-description">
              원문의 페이지 구조를 따라 기록을 탐색합니다.
            </p>
            <PageTree posts={posts} onClose={() => setDialog(null)} />
          </>
        ) : (
          <div className="about-copy">
            <p>경섭이 개발하며 배운 것을 기록하는 공간입니다.</p>
            <p>
              노션의 페이지와 연결을 Markdown으로 옮겼습니다. 글 목록이나 페이지
              탐색에서 원문의 구조를 따라 읽을 수 있습니다.
            </p>
            <p>
              새 글은 블록 편집기로 작성합니다. 이 브라우저에 저장한 초안은 공개
              글과 따로 표시합니다.
            </p>
            <button
              className="dark-button"
              type="button"
              onClick={() => {
                setDialog(null);
                onWrite();
              }}
            >
              새 글 쓰기 <Arrow />
            </button>
          </div>
        )}
      </dialog>
    </div>
  );
}
