import { categoryMatches } from "../../features/post-category/hierarchy";
import type {
  CategoryCatalog,
  CategoryGroup,
} from "../../features/post-category/catalog";
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
  onWrite: () => void;
};

export default function RecordsPage({
  posts,
  catalog,
  browser,
  onWrite,
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
  const title = category?.name ?? group?.name ?? "모든 기록";

  function groupPosts(items: Post[], group: CategoryGroup) {
    return items.filter((post) =>
      group.categories.some((category) => categoryMatches(category, post.category)),
    );
  }

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
        onWrite={onWrite}
      />
    );
  }

  function categoryButtons(item: CategoryGroup) {
    const children = item.categories.filter((category) => category.id !== item.id);
    return children.map((category) => (
      <button
        key={category.id}
        type="button"
        style={{ paddingLeft: 12 + (category.depth ?? 0) * 16 }}
        aria-label={category.name}
        aria-pressed={browser.categoryId === category.id}
        onClick={() => browser.selectCategory(category.id)}
      >
        <span>{category.name}</span>
        <span className="records-count">
          {posts
            .filter((post) => categoryMatches(category, post.category))
            .length.toLocaleString()}
        </span>
      </button>
    ));
  }

  const allButton = (
    <button
      type="button"
      aria-pressed={!browser.groupId}
      onClick={() => browser.selectGroup(null)}
    >
      모든 기록
      <span className="records-count">{posts.length.toLocaleString()}</span>
    </button>
  );

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
      <div className="records-body records-layout-sidebar">
        <aside className="records-sidebar" aria-label="카테고리">
          <h2>카테고리</h2>
          {allButton}
          {groups.map((item, index) => {
            const children = categoryButtons(item);
            const rootButton = (
              <button
                key={item.id}
                type="button"
                className="records-category-root"
                aria-label={item.name}
                aria-pressed={browser.groupId === item.id && !browser.categoryId}
                onClick={() => browser.selectGroup(item.id)}
              >
                <span>{item.name}</span>
                <span className="records-count">
                  {groupPosts(posts, item).length.toLocaleString()}
                </span>
              </button>
            );
            return children.length ? (
              <details
                key={item.id}
                open={browser.groupId === item.id || (!browser.groupId && index === 0)}
              >
                <summary aria-label={item.name + " 하위 분류"}>
                  {rootButton}
                </summary>
                <div className="records-tree-children">
                  {children}
                </div>
              </details>
            ) : rootButton;
          })}
        </aside>
        <section className="records-content" aria-label="기록 목록">
          <div className="records-context">
            <div>
              {category && group ? (
                <p>
                  {group.name} <span aria-hidden="true">›</span> {category.name}
                </p>
              ) : null}
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
      </div>
    </main>
  );
}
