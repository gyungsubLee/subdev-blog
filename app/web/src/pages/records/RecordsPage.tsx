import RecordsCategories from "../../features/post-category/RecordsCategories";
import type { CategoryCatalog } from "../../features/post-category/catalog";
import type { useRecordsBrowser } from "../../features/post-category/useRecordsBrowser";
import PostList from "../../features/post-list/PostList";
import PostLoadMore from "../../features/post-pagination/PostLoadMore";
import PostResultCount from "../../features/post-pagination/PostResultCount";
import PostSearch from "../../features/post-search/PostSearch";
import type { Post } from "../../shared/post";
import "./RecordsPage.css";

type RecordsPageProps = {
  posts: Post[];
  catalog: CategoryCatalog;
  browser: ReturnType<typeof useRecordsBrowser>;
  onWrite: (categoryId?: string) => void;
  onEdit?: (post: Post) => void;
  onDelete?: (post: Post) => void;
};

export default function RecordsPage({
  posts,
  catalog,
  browser,
  onWrite,
  onEdit,
  onDelete,
}: RecordsPageProps) {
  const { groups } = catalog;
  const group = groups.find((item) => item.id === browser.groupId);
  const category = group?.categories.find((item) => item.id === browser.categoryId);
  const names = new Map(
    groups.flatMap((item) =>
      item.categories.flatMap((category) =>
        (category.sources ?? [category.source]).map(
          (source) => [source, category.name] as const,
        ),
      ),
    ),
  );
  const canonicalNames = new Map(
    catalog.nodes.flatMap((node) => [
      [node.id, node.name] as const,
      ...node.sources.map((source) => [source, node.name] as const),
    ]),
  );
  const visiblePosts = browser.filteredPosts.slice(0, browser.limit);
  const path: string[] = [];
  let selectedNode = catalog.nodes.find(
    node => node.id === (browser.categoryId ?? browser.groupId),
  );
  while (selectedNode) {
    path.unshift(selectedNode.name);
    selectedNode = catalog.nodes.find(
      node => node.id === selectedNode!.parentId,
    );
  }
  const title = category?.name ?? group?.name ?? "모든 기록";

  function cards(items: Post[]) {
    return (
      <PostList
        posts={items.map((post) => ({
          ...post,
          category:
            canonicalNames.get(post.categoryId ?? post.category) ??
            names.get(post.category) ?? post.category,
        }))}
        hasPosts={posts.length > 0}
        onReset={browser.resetFilters}
        onWrite={() => onWrite(browser.categoryId ?? browser.groupId ?? undefined)}
      />
    );
  }

  return (
    <main id="main-content" className="records-page" tabIndex={-1}>
      <header className="records-heading">
        <div className="records-title-row">
          <h1>
            기록 <span>{posts.length.toLocaleString()}</span>
          </h1>
          <PostSearch
            query={browser.query}
            inputRef={browser.inputRef}
            onChange={browser.setQuery}
            onClear={browser.clearQuery}
          />
        </div>
        <p className="records-description">개발하며 배운 내용을 주제별로 모았습니다.</p>
      </header>
      <RecordsCategories
        posts={posts}
        catalog={catalog}
        browser={browser}
        onWrite={onWrite}
        onEdit={onEdit}
        onDelete={onDelete}
      >
        <section className="records-content" aria-label="기록 목록">
          <div className="records-context">
            <div>
              <p>{path.length ? path.join("　›　") : "모든 기록"}</p>
              <h2>{title}</h2>
            </div>
            <PostResultCount query={browser.query} count={browser.filteredPosts.length} />
          </div>
          {cards(visiblePosts)}
          <PostLoadMore
            limit={browser.limit}
            total={browser.filteredPosts.length}
            onLoadMore={browser.showMore}
          />
        </section>
      </RecordsCategories>
    </main>
  );
}
