import {
  CATEGORIES_HREF,
  HOME_HREF,
  RECORDS_HREF,
  postIdFromHash,
} from "../shared/routes";
import { useEffect, useState } from "react";
import SiteDialog from "../components/dialog/SiteDialog";
import SiteFooter from "../components/layout/SiteFooter";
import SiteHeader from "../components/layout/SiteHeader";
import { site } from "../config/site";
import PageTree from "../features/page-explorer/PageTree";
import { useCategoryCatalog } from "../features/post-category/useCategoryCatalog";
import { useRecordsBrowser } from "../features/post-category/useRecordsBrowser";
import HomePage from "../pages/home/HomePage";
import CategoriesPage from "../pages/categories/CategoriesPage";
import RecordsPage from "../pages/records/RecordsPage";
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
  const [dialog, setDialog] = useState<"tree" | null>(null);
  const [backHref, setBackHref] = useState(HOME_HREF);
  const selectedId = postIdFromHash(hash);
  const selected = posts.find((post) => post.id === selectedId);
  const isRecords = hash === RECORDS_HREF;
  const isCategories = hash === CATEGORIES_HREF;
  const isHome = !selectedId && !isRecords && !isCategories;
  const catalog = useCategoryCatalog(posts);
  const records = useRecordsBrowser(posts, catalog.groups, isRecords && !dialog);

  useEffect(() => {
    if (isHome || isRecords) {
      setBackHref(isRecords ? RECORDS_HREF : HOME_HREF);
    }
  }, [isHome, isRecords]);

  useEffect(() => {
    let title = site.homeTitle;
    if (selected) title = selected.title + " — " + site.name;
    else if (isRecords) title = "기록 — " + site.name;
    else if (isCategories) title = "카테고리 관리 — " + site.name;
    document.title = title;
  }, [selected, isRecords, isCategories]);

  let page;
  if (selectedId) {
    page = selected ? (
      <PostPage
        post={selected}
        posts={posts}
        hash={hash}
        onEdit={onEdit}
        backHref={backHref}
      />
    ) : (
      <MissingPostPage />
    );
  } else if (isRecords) {
    page = (
      <RecordsPage
        posts={posts}
        catalog={catalog}
        browser={records}
        onWrite={onWrite}
      />
    );
  } else if (isCategories) {
    page = <CategoriesPage posts={posts} catalog={catalog} />;
  } else {
    page = <HomePage posts={posts} />;
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
        activeHref={hash}
        onExplore={() => setDialog("tree")}
        onWrite={onWrite}
      />
      {page}
      <SiteFooter />
      <SiteDialog
        open={dialog !== null}
        title="페이지 탐색"
        onClose={() => setDialog(null)}
      >
        <p className="dialog-description">
          원문의 페이지 구조를 따라 기록을 탐색합니다.
        </p>
        <PageTree posts={posts} onClose={() => setDialog(null)} />
      </SiteDialog>
    </div>
  );
}
