import { ALL_CATEGORIES } from "../../features/post-category/config";
import type { RefObject } from "react";
import Arrow from "../../components/icons/Arrow";
import { site } from "../../config/site";
import PostCategoryFilter from "../../features/post-category/PostCategoryFilter";
import FeaturedPosts from "../../features/post-list/FeaturedPosts";
import PostList from "../../features/post-list/PostList";
import PostLoadMore from "../../features/post-pagination/PostLoadMore";
import PostResultCount from "../../features/post-pagination/PostResultCount";
import PostSearch from "../../features/post-search/PostSearch";
import type { Post } from "../../shared/post";
import "./HomePage.css";

type HomePageProps = {
  posts: Post[];
  filtered: Post[];
  query: string;
  searchRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onQueryClear: () => void;
  category: string;
  categories: string[];
  onCategoryChange: (category: string) => void;
  limit: number;
  onLoadMore: () => void;
  onResetFilters: () => void;
  onWrite: () => void;
};

export default function HomePage({
  posts,
  filtered,
  query,
  searchRef,
  onQueryChange,
  onQueryClear,
  category,
  categories,
  onCategoryChange,
  limit,
  onLoadMore,
  onResetFilters,
  onWrite,
}: HomePageProps) {
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
      {!query.trim() && category === ALL_CATEGORIES ? (
        <FeaturedPosts posts={posts} />
      ) : null}
      <section className="all-posts" aria-labelledby="all-posts-title">
        <div className="section-heading">
          <h2 id="all-posts-title">
            모든 기록 <span>{posts.length}</span>
          </h2>
          <PostSearch
            query={query}
            inputRef={searchRef}
            onChange={onQueryChange}
            onClear={onQueryClear}
          />
        </div>
        <PostCategoryFilter
          category={category}
          categories={categories}
          onChange={onCategoryChange}
        />
        <PostResultCount query={query} count={filtered.length} />
        <PostList
          posts={filtered.slice(0, limit)}
          hasPosts={posts.length > 0}
          onReset={onResetFilters}
          onWrite={onWrite}
        />
        <PostLoadMore
          limit={limit}
          total={filtered.length}
          onLoadMore={onLoadMore}
        />
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
  );
}
