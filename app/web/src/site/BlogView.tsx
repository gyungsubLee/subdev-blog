import {
  CATEGORIES_HREF,
  CONTENT_HREF,
  HOME_HREF,
  RECORDS_HREF,
  postIdFromHash,
} from "../shared/routes";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import SiteFooter from "../components/layout/SiteFooter";
import SiteHeader from "../components/layout/SiteHeader";
import { site } from "../config/site";
import { useRecordsCatalog } from "../features/post-category/useRecordsCatalog";
import { useCategoryCatalog } from "../features/post-category/useCategoryCatalog";
import { useRecordsBrowser } from "../features/post-category/useRecordsBrowser";
import HomePage from "../pages/home/HomePage";
import CategoriesPage from "../features/post-category/CategoryManager";
import RecordsPage from "../pages/records/RecordsPage";
import MissingPostPage from "../pages/post/MissingPostPage";
import PostPage from "../pages/post/PostPage";
import type { Post, PublicCategory } from "../shared/post";
import type { Management } from "../features/content-management/useManagement";
import ContentWorkspace from "../features/content-management/ContentWorkspace";
import ManagedCategories from "../features/content-management/ManagedCategories";
import { categoryNodesToGroups } from "../features/post-category/hierarchy";

const PostDeleteDialog = lazy(
  () => import("../features/content-management/PostDeleteDialog"),
);

type BlogViewProps = {
  posts: Post[];
  categories?: PublicCategory[];
  hash: string;
  onWrite: (categoryId?: string, pendingCategories?: PublicCategory[]) => void;
  onEdit: (post: Post) => void;
  management?: Management;
  draftVersion?: number;
  onContentSaved?: (contentCommit?: string) => void;
};

export default function BlogView({
  posts,
  categories,
  hash,
  onWrite,
  onEdit,
  management,
  onContentSaved,
  draftVersion,
}: BlogViewProps) {
  const [deletingPost, setDeletingPost] = useState<Post | null>(null);
  const [backHref, setBackHref] = useState(HOME_HREF);
  const selectedId = postIdFromHash(hash);
  const selected = posts.find((post) => post.id === selectedId);
  const isRecords = hash === RECORDS_HREF;
  const isContent = hash === CONTENT_HREF;
  const isCategories = hash === CATEGORIES_HREF;
  const isHome = !selectedId && !isRecords && !isCategories && !isContent;
  const personalCatalog = useCategoryCatalog(posts, categories);
  const canonicalNodes = useMemo(() => [...(categories ?? [])]
    .sort((a, b) => a.order - b.order)
    .map((category) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      sources: [...new Set([...category.sources, category.id])],
    })), [categories]);
  const canonicalGroups = useMemo(() => categoryNodesToGroups(canonicalNodes), [canonicalNodes]);
  const catalog = management ? {
    ...personalCatalog,
    nodes: canonicalNodes,
    groups: canonicalGroups,
  } : personalCatalog;
  const recordsCatalog = useRecordsCatalog(catalog);
  const records = useRecordsBrowser(posts, recordsCatalog.groups, isRecords);

  useEffect(() => {
    if (isHome || isRecords) {
      setBackHref(isRecords ? RECORDS_HREF : HOME_HREF);
    }
  }, [isHome, isRecords]);

  useEffect(() => {
    let title = site.homeTitle;
    if (selected) title = selected.title + " — " + site.name;
    else if (isRecords) title = "기록 — " + site.name;
    else if (isContent) title = "콘텐츠 관리 — " + site.name;
    else if (isCategories) title = "카테고리 관리 — " + site.name;
    document.title = title;
  }, [selected, isRecords, isCategories, isContent]);

  let page;
  if (selectedId) {
    page = selected ? (
      <PostPage
        post={selected}
        categoryName={
          catalog.nodes.find((node) =>
            node.id === selected.categoryId ||
            node.sources.includes(selected.categoryId ?? selected.category),
          )?.name
        }
        posts={posts}
        hash={hash}
        onEdit={management?.session.state === "ready" ? onEdit : undefined}
        backHref={backHref}
      />
    ) : (
      <MissingPostPage />
    );
  } else if (isRecords) {
    page = (
      <RecordsPage
        posts={posts}
        catalog={recordsCatalog}
        browser={records}
        onEdit={management?.session.state === "ready" ? onEdit : undefined}
        onDelete={management?.session.state === "ready" ? setDeletingPost : undefined}
        onWrite={(id) => {
          const node = recordsCatalog.nodes.find(item => item.id === id);
          const canonical = canonicalNodes.find(item =>
            item.id === id || item.sources.some(source => node?.sources.includes(source)),
          );
          const pending: PublicCategory[] = [];
          let current = node;
          while (current && !canonicalNodes.some(item => item.id === current!.id)) {
            pending.unshift({
              ...current,
              order: recordsCatalog.nodes.indexOf(current),
            });
            current = recordsCatalog.nodes.find(
              item => item.id === current!.parentId,
            );
          }
          onWrite(canonical?.id ?? node?.id, pending);
        }}
      />
    );
  } else if (isContent) {
    page = management?.session.state === "ready" ? (
      <ContentWorkspace
        posts={posts}
        categories={categories ?? []}
        onEdit={onEdit}
        draftVersion={draftVersion}
        session={management.session}
        onDeleted={onContentSaved}
      />
    ) : (
      <main className="app-state" id="main-content" tabIndex={-1}>
        <h1>로그인이 필요합니다</h1>
        <p>콘텐츠 관리는 GitHub 로그인 후 이용할 수 있습니다.</p>
      </main>
    );
  } else if (isCategories) {
    if (!management) {
      page = <CategoriesPage posts={posts} catalog={catalog} />;
    } else if (management.session.state === "ready") {
      page = (
        <ManagedCategories
          categories={categories ?? []}
          posts={posts}
          session={management.session}
          onSaved={onContentSaved}
        />
      );
    } else {
      page = (
        <main className="app-state" id="main-content" tabIndex={-1}>
          <h1>로그인이 필요합니다</h1>
          <p>카테고리 관리는 GitHub 로그인 후 이용할 수 있습니다.</p>
        </main>
      );
    }
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
        onWrite={() => onWrite()}
        management={management}
      />
      {page}
      {deletingPost && management?.session.state === "ready" ? (
        <Suspense fallback={null}>
          <PostDeleteDialog
            post={deletingPost}
            session={management.session}
            onClose={() => setDeletingPost(null)}
            onDeleted={(commit) => {
              setDeletingPost(null);
              onContentSaved?.(commit);
            }}
          />
        </Suspense>
      ) : null}
      <SiteFooter />
    </div>
  );
}
