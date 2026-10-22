import { HOME_HREF, postHref } from "../../shared/routes";
import Arrow from "../../components/icons/Arrow";
import { site } from "../../config/site";
import PostReader from "../../features/post-reader/PostReader";
import { WORDS_PER_MINUTE } from "../../features/post-reader/config";
import { downloadFile } from "../../shared/download-file.mjs";
import type { Post } from "../../shared/post";
import { formatDate, getBody } from "../../shared/post-content";
import "./PostPage.css";

function downloadMarkdown(post: Post) {
  downloadFile(
    post.title + ".md",
    post.markdown,
    "text/markdown;charset=utf-8",
  );
}

export default function PostPage({
  post,
  posts,
  onEdit,
  hash,
}: {
  post: Post;
  posts: Post[];
  onEdit: (post: Post) => void;
  hash: string;
}) {
  const body = getBody(post);
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
  const readingMinutes = Math.max(
    1,
    Math.ceil(body.split(/\s+/).length / WORDS_PER_MINUTE),
  );

  return (
    <main id="main-content" className="article-page" tabIndex={-1}>
      <div className="article-topline">
        <a className="back-link" href={HOME_HREF}>
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
            <a key={ancestor.id} href={postHref(ancestor.id)}>
              {ancestor.title}
              <span aria-hidden="true">/</span>
            </a>
          ))}
          <span>{post.category}</span>
        </nav>
        <h1>{post.title}</h1>
        <div className="article-meta">
          <span>{site.author}</span>
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
      <PostReader post={post} posts={posts} hash={hash} />
      <nav className="article-pagination" aria-label="다른 글">
        {index > 0 ? (
          <a href={postHref(siblings[index - 1].id)}>
            <span>이전 글</span>
            <strong>{siblings[index - 1].title}</strong>
          </a>
        ) : (
          <span />
        )}
        {index < siblings.length - 1 ? (
          <a href={postHref(siblings[index + 1].id)}>
            <span>다음 글</span>
            <strong>{siblings[index + 1].title}</strong>
          </a>
        ) : null}
      </nav>
    </main>
  );
}
