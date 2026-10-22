import { postIdFromHash } from "../shared/routes";
import { ALL_CATEGORIES } from "../features/post-category/config";
import { useEffect, useState } from "react";
import SiteDialog from "../components/dialog/SiteDialog";
import Arrow from "../components/icons/Arrow";
import SiteFooter from "../components/layout/SiteFooter";
import SiteHeader from "../components/layout/SiteHeader";
import { site } from "../config/site";
import PageTree from "../features/page-explorer/PageTree";
import { usePostCategory } from "../features/post-category/usePostCategory";
import { usePostPagination } from "../features/post-pagination/usePostPagination";
import { usePostSearch } from "../features/post-search/usePostSearch";
import HomePage from "../pages/home/HomePage";
import MissingPostPage from "../pages/post/MissingPostPage";
import PostPage from "../pages/post/PostPage";
import type { Post } from "../shared/post";

type BlogViewProps = {
  posts: Post[];
  hash: string;
  onWrite: () => void;
  onEdit: (post: Post) => void;
};

export default function BlogView({
  posts,
  hash,
  onWrite,
  onEdit,
}: BlogViewProps) {
  const [dialog, setDialog] = useState<"tree" | "about" | null>(null);
  const selectedId = postIdFromHash(hash);
  const selected = posts.find((post) => post.id === selectedId);
  const search = usePostSearch(!selectedId && !dialog);
  const category = usePostCategory(posts);
  const pagination = usePostPagination();
  const filtered = posts.filter(
    (post) => category.matches(post) && search.matches(post),
  );

  useEffect(() => {
    document.title = selected
      ? selected.title + " — " + site.name
      : site.homeTitle;
  }, [selected]);

  function changeQuery(query: string) {
    search.setQuery(query);
    pagination.reset();
  }

  function changeCategory(name: string) {
    category.setCategory(name);
    pagination.reset();
  }

  function resetFilters() {
    search.setQuery("");
    category.setCategory(ALL_CATEGORIES);
  }

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
      <SiteHeader
        isHome={!selectedId}
        onExplore={() => setDialog("tree")}
        onAbout={() => setDialog("about")}
        onWrite={onWrite}
      />
      {selectedId ? (
        selected ? (
          <PostPage post={selected} posts={posts} hash={hash} onEdit={onEdit} />
        ) : (
          <MissingPostPage />
        )
      ) : (
        <HomePage
          posts={posts}
          filtered={filtered}
          query={search.query}
          searchRef={search.inputRef}
          onQueryChange={changeQuery}
          onQueryClear={() => search.setQuery("")}
          category={category.category}
          categories={category.categories}
          onCategoryChange={changeCategory}
          limit={pagination.limit}
          onLoadMore={pagination.showMore}
          onResetFilters={resetFilters}
          onWrite={onWrite}
        />
      )}
      <SiteFooter />
      <SiteDialog
        open={dialog !== null}
        title={dialog === "tree" ? "페이지 탐색" : site.name}
        onClose={() => setDialog(null)}
      >
        {dialog === "tree" ? (
          <>
            <p className="dialog-description">
              원문의 페이지 구조를 따라 기록을 탐색합니다.
            </p>
            <PageTree posts={posts} onClose={() => setDialog(null)} />
          </>
        ) : (
          <div className="about-copy">
            <p>{site.aboutIntro}</p>
            <p>{site.aboutArchive}</p>
            <p>{site.aboutDrafts}</p>
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
      </SiteDialog>
    </div>
  );
}
