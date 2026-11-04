import Arrow from "../../components/icons/Arrow";
import PostArt from "../../components/post-art/PostArt";
import { site } from "../../config/site";
import type { Post } from "../../shared/post";
import { formatDate } from "../../shared/post-content";
import { postHref, RECORDS_HREF } from "../../shared/routes";
import "./HomePage.css";

export default function HomePage({ posts }: { posts: Post[] }) {
  const articles = posts
    .filter((post) => !post.draft)
    .sort(
      (a, b) =>
        (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0),
    );
  const latest = articles.slice(0, 4);
  // ponytail: 조회수 연동 전에는 최신 글 5개로 순위 UI만 표시한다. 집계 연결 후 교체한다.
  const popular = articles.slice(0, 5);

  return (
    <main id="main-content" tabIndex={-1}>
      <section className="blog-intro" aria-labelledby="blog-title">
        <div>
          <p className="eyebrow">{site.author}</p>
          <h1 id="blog-title">
            {site.introTitleStart}
            <br />
            <span>{site.introTitleEnd}</span>
          </h1>
        </div>
        <p>
          {site.introDescriptionStart}
          <br />
          {site.introDescriptionEnd}
        </p>
      </section>
      <div className="home-discovery">
        <section className="home-latest" aria-labelledby="latest-articles-title">
          <div className="home-section-heading">
            <h2 id="latest-articles-title">최신 아티클</h2>
            <a href={RECORDS_HREF}>
              전체 아티클 보기 <Arrow />
            </a>
          </div>
          {latest.length ? (
            <div className="home-article-grid">
              {latest.map((post, index) => (
                <a
                  className="home-article-card"
                  key={post.id}
                  href={postHref(post.id)}
                >
                  <PostArt post={post} variant={index} />
                  <div className="home-article-copy">
                    <time dateTime={post.createdAt}>
                      {formatDate(post.createdAt)}
                    </time>
                    <h3>{post.title}</h3>
                    <p>{post.excerpt}</p>
                    <span className="home-read-link">
                      아티클 읽기 <Arrow />
                    </span>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <p className="home-empty">공개한 아티클이 아직 없습니다.</p>
          )}
        </section>
        <aside className="home-popular" aria-labelledby="popular-articles-title">
          <div className="home-section-heading">
            <h2 id="popular-articles-title">인기 아티클</h2>
            <span className="home-sample-badge">순위 예시</span>
          </div>
          <p className="home-popular-description">
            조회수 연동 전 예시 목록입니다.
          </p>
          {popular.length ? (
            <ol className="home-popular-list" role="list">
              {popular.map((post, index) => (
                <li key={post.id}>
                  <a className="home-popular-link" href={postHref(post.id)}>
                    <span className="home-rank" aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div className="home-popular-copy">
                      <h3>{post.title}</h3>
                      <time dateTime={post.createdAt}>
                        {formatDate(post.createdAt)}
                      </time>
                    </div>
                    <Arrow />
                  </a>
                </li>
              ))}
            </ol>
          ) : (
            <p className="home-empty">표시할 아티클이 없습니다.</p>
          )}
          <a className="home-archive-link" href={RECORDS_HREF}>
            <div>
              <strong>찾는 아티클이 있나요?</strong>
              <span>기록 관리에서 검색하고 찾아보세요.</span>
            </div>
            <Arrow />
          </a>
        </aside>
      </div>
    </main>
  );
}
