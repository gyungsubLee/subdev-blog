import { categoryMatches } from "../../features/post-category/hierarchy";
import RecordViewIcon from "../../components/icons/RecordViewIcon";
import { site } from "../../config/site";
import type {
  CategoryCatalog,
  CategoryGroup,
} from "../../features/post-category/catalog";
import type {
  RecordsView,
  useRecordsBrowser,
} from "../../features/post-category/useRecordsBrowser";
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

const views: { id: RecordsView; name: string }[] = [
  { id: "sidebar", name: "사이드바 보기" },
  { id: "tabs", name: "탭 보기" },
  { id: "sections", name: "섹션 보기" },
];

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
    return item.categories.map((category) => (
      <button
        key={category.id}
        type="button"
        style={
          browser.view === "sidebar"
            ? { paddingLeft: 12 + (category.depth ?? 0) * 16 }
            : undefined
        }
        aria-label={category.name}
        aria-pressed={browser.categoryId === category.id}
        onClick={() => browser.selectCategory(category.id)}
      >
        <span>{category.name}</span>
        {browser.view === "sidebar" ? (
          <span className="records-count">
            {posts
              .filter((post) => categoryMatches(category, post.category))
              .length.toLocaleString()}
          </span>
        ) : null}
      </button>
    ));
  }

  function childTabs(item: CategoryGroup) {
    return (
      <div className="records-child-tabs" role="group" aria-label={item.name + " 하위 분류"}>
        <button
          type="button"
          aria-pressed={browser.groupId === item.id && !browser.categoryId}
          onClick={() => browser.selectGroup(item.id)}
        >
          {item.name} 전체
        </button>
        {categoryButtons(item)}
      </div>
    );
  }

  const allButton = (
    <button
      type="button"
      aria-pressed={!browser.groupId}
      onClick={() => browser.selectGroup(null)}
    >
      {browser.view === "sidebar" ? "모든 기록" : "전체"}
      {browser.view === "sidebar" ? (
        <span className="records-count">{posts.length.toLocaleString()}</span>
      ) : null}
    </button>
  );

  return (
    <main id="main-content" className="records-page" tabIndex={-1}>
      <header className="records-heading">
        <div>
          <p className="eyebrow">{site.author}</p>
          <h1>
            기록 <span>{posts.length.toLocaleString()}</span>
          </h1>
          <p className="records-description">개발하며 배운 내용을 주제별로 모았습니다.</p>
        </div>
        <div className="records-view-control">
          <div role="group" aria-label="보기 방식">
            <span className="records-view-label">보기 방식</span>
            {views.map((view) => (
              <button
                key={view.id}
                type="button"
                aria-label={view.name}
                title={view.name}
                aria-pressed={browser.view === view.id}
                onClick={() => browser.setView(view.id)}
              >
                <RecordViewIcon view={view.id} />
              </button>
            ))}
          </div>
          <p>{views.find((view) => view.id === browser.view)?.name}</p>
        </div>
      </header>
      <div className="records-toolbar">
        <PostSearch
          query={browser.query}
          inputRef={browser.inputRef}
          onChange={browser.setQuery}
          onClear={browser.clearQuery}
        />
        <a href="#/categories" className="outline-button">카테고리 관리</a>
      </div>
      <div className={"records-body records-layout-" + browser.view}>
        {browser.view === "sidebar" ? (
          <aside className="records-sidebar" aria-label="카테고리">
            <h2>카테고리</h2>
            {allButton}
            {groups.map((item, index) => (
              <details
                key={item.id}
                open={browser.groupId === item.id || (!browser.groupId && index === 0)}
              >
                <summary>
                  <span>{item.name}</span>
                  <span className="records-count">
                    {groupPosts(posts, item).length.toLocaleString()}
                  </span>
                </summary>
                <div className="records-tree-children">
                  <button
                    type="button"
                    aria-pressed={browser.groupId === item.id && !browser.categoryId}
                    onClick={() => browser.selectGroup(item.id)}
                  >
                    {item.name} 전체
                  </button>
                  {categoryButtons(item)}
                </div>
              </details>
            ))}
          </aside>
        ) : null}
        <section className="records-content" aria-label="기록 목록">
          {browser.view === "tabs" ? (
            <>
              <nav className="records-group-tabs" aria-label="상위 분류">
                {allButton}
                {groups.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={browser.groupId === item.id}
                    onClick={() => browser.selectGroup(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </nav>
              {group ? childTabs(group) : null}
            </>
          ) : null}
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
          {browser.view === "sections" && browser.filteredPosts.length ? (
            <>
              <div className="records-section-reset">{allButton}</div>
              {groups.map((item) => {
                const matches = groupPosts(browser.filteredPosts, item);
                const visible = groupPosts(visiblePosts, item);
                return (
                  <details
                    className="records-section"
                    key={item.id}
                    open={!browser.groupId || browser.groupId === item.id}
                  >
                    <summary>
                      <span>{item.name}</span>
                      <span className="records-count">{matches.length.toLocaleString()}</span>
                    </summary>
                    <div className="records-section-content">
                      {childTabs(item)}
                      {visible.length ? cards(visible) : (
                        <p className="records-section-empty">
                          {matches.length
                            ? "더 보기를 누르면 나머지 기록을 표시합니다."
                            : "현재 조건에 맞는 기록이 없습니다."}
                        </p>
                      )}
                    </div>
                  </details>
                );
              })}
            </>
          ) : cards(visiblePosts)}
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
