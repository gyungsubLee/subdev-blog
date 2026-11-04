import { postHref } from "../../shared/routes";
import Arrow from "../../components/icons/Arrow";
import PostArt from "../../components/post-art/PostArt";
import type { Post } from "../../shared/post";
import { formatDate, getBody } from "../../shared/post-content";
import { FEATURED_MIN_BODY_LENGTH, SECONDARY_POST_COUNT } from "./config";
import "./post-list.css";

export default function FeaturedPosts({ posts }: { posts: Post[] }) {
  const featured =
    posts.find(
      (post) => !post.draft && getBody(post).length > FEATURED_MIN_BODY_LENGTH,
    ) || posts[0];
  const secondary = posts
    .filter((post) => post.id !== featured?.id)
    .slice(0, SECONDARY_POST_COUNT);
  if (!featured) return null;

  return (
    <section className="featured-grid" aria-label="대표 글">
      <a className="featured-card" href={postHref(featured.id)}>
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
            href={postHref(post.id)}
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
  );
}
