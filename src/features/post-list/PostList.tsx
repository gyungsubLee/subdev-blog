import { postHref } from "../../shared/routes";
import Arrow from "../../components/icons/Arrow";
import PostArt from "../../components/post-art/PostArt";
import type { Post } from "../../shared/post";
import { formatDate } from "../../shared/post-content";
import "./post-list.css";

export default function PostList({
  posts,
  hasPosts,
  onReset,
  onWrite,
}: {
  posts: Post[];
  hasPosts: boolean;
  onReset: () => void;
  onWrite: () => void;
}) {
  if (!posts.length) {
    return (
      <div className="empty-results">
        <h3>
          {hasPosts ? "검색한 기록이 없습니다." : "수집한 기록이 아직 없습니다."}
        </h3>
        <p>
          {hasPosts
            ? "다른 검색어 또는 카테고리를 선택하십시오."
            : "수집 상태를 확인하거나 첫 글을 작성하십시오."}
        </p>
        <button
          className="outline-button"
          type="button"
          onClick={hasPosts ? onReset : onWrite}
        >
          {hasPosts ? "전체 글 보기" : "글 쓰기"}
        </button>
      </div>
    );
  }

  return (
    <div className="post-grid">
      {posts.map((post, index) => (
        <a className="post-card" key={post.id} href={postHref(post.id)}>
          <PostArt post={post} variant={index} />
          <div className="post-meta">
            <span>{post.category}</span>
            {post.draft ? <span className="draft-badge">초안</span> : null}
          </div>
          <h3>{post.title}</h3>
          <p>{post.excerpt}</p>
          <div className="card-bottom">
            <time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time>
            <Arrow />
          </div>
        </a>
      ))}
    </div>
  );
}
