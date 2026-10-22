import { useEffect, useRef, useState, type FormEvent } from "react";
import Arrow from "../../components/icons/Arrow";
import {
  normalizeCategoryName,
  type CategoryCatalog,
  type CategoryGroup,
  type CategoryItem,
} from "../../features/post-category/catalog";
import type { Post } from "../../shared/post";
import { postHref } from "../../shared/routes";
import "./CategoriesPage.css";

type CategoriesPageProps = { posts: Post[]; catalog: CategoryCatalog };

export default function CategoriesPage({ posts, catalog }: CategoriesPageProps) {
  const { groups } = catalog;
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    groups.flatMap((group) => group.categories).find((item) => item.source === "Spring ( Java )")?.id
      ?? groups[0]?.categories[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set([
    "group:backend", "group:learning-tools", "group:unclassified",
  ]));
  const [notice, setNotice] = useState("");
  const dragged = useRef<{ kind: "group" | "category"; id: string } | null>(null);
  const selectedGroup = groups.find((group) => group.categories.some((item) => item.id === selectedId));
  const selected = selectedGroup?.categories.find((item) => item.id === selectedId);
  const counts = new Map<string, number>();
  for (const post of posts) counts.set(post.category, (counts.get(post.category) ?? 0) + 1);

  function save(next: CategoryGroup[]) {
    setNotice("");
    if (!catalog.save(next)) return false;
    setNotice("분류 설정을 저장했습니다.");
    return true;
  }

  function moveCategory(id: string, targetGroupId: string, targetIndex: number) {
    const item = groups.flatMap((group) => group.categories).find((category) => category.id === id);
    if (!item) return;
    const next = groups.map((group) => {
      const categories = group.categories.filter((category) => category.id !== id);
      if (group.id === targetGroupId) categories.splice(targetIndex, 0, item);
      return { ...group, categories };
    });
    if (save(next)) setExpanded((previous) => new Set([...previous, targetGroupId]));
  }

  function moveGroup(id: string, targetIndex: number) {
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    const next = groups.filter((item) => item.id !== id);
    next.splice(targetIndex, 0, group);
    save(next);
  }

  function toggleGroup(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main id="main-content" className="categories-page" tabIndex={-1}>
      <header className="category-manager-heading">
        <div>
          <p className="eyebrow">기록 관리</p>
          <h1>카테고리 관리</h1>
          <p>분류를 끌어 순서를 바꾸거나, 상위 분류 아래로 옮깁니다.</p>
        </div>
        <button
          className="dark-button"
          type="button"
          onClick={() => {
            setAdding(true);
            setNotice("");
          }}
        >
          + 분류 추가
        </button>
      </header>
      <p className="category-local-notice">
        분류 설정은 이 브라우저에만 저장합니다. 원문과 페이지 계층은 바꾸지 않습니다.
      </p>
      {catalog.error ? <p className="category-error" role="alert">{catalog.error}</p> : null}
      <p className="category-save-status" role="status">{notice}</p>
      <div className="category-manager-layout">
        <section className="category-tree-panel" aria-label="분류 목록">
          <div className="category-tree-tools">
            <button
              type="button"
              className="quiet-button"
              onClick={() => setExpanded(new Set(groups.map((group) => group.id)))}
            >
              전체 펼치기
            </button>
            <button
              type="button"
              className="quiet-button"
              onClick={() => setExpanded(new Set())}
            >
              전체 접기
            </button>
            <span>
              {groups.reduce((total, group) => total + group.categories.length, 0)}개 하위 분류
            </span>
          </div>
          <div className="category-tree-columns">
            <span>분류</span>
            <span>기록 수</span>
            <span className="sr-only">순서 변경</span>
          </div>
          <ul className="category-manager-tree">
            {groups.map((group, groupIndex) => (
              <li key={group.id}>
                <div
                  className="category-manager-row category-manager-group"
                  draggable
                  onDragStart={(event) => {
                    dragged.current = { kind: "group", id: group.id };
                    event.dataTransfer.setData("text/plain", group.id);
                  }}
                  onDragEnd={() => { dragged.current = null; }}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const item = dragged.current;
                    if (item?.kind === "group") moveGroup(item.id, groupIndex);
                    if (item?.kind === "category") moveCategory(item.id, group.id, group.categories.length);
                    dragged.current = null;
                  }}
                >
                  <button
                    type="button"
                    className="category-row-select"
                    aria-expanded={expanded.has(group.id)}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span className="category-grip" aria-hidden="true">⠿</span>
                    <span className="category-chevron" aria-hidden="true">{expanded.has(group.id) ? "⌄" : "›"}</span>
                    <span>{group.name}</span>
                  </button>
                  <span className="category-row-count">{group.categories.reduce((total, item) => total + (counts.get(item.source) ?? 0), 0).toLocaleString()}</span>
                  <div className="category-row-order">
                    <button
                      type="button"
                      aria-label={`${group.name} 위로 이동`}
                      disabled={groupIndex === 0}
                      onClick={() => moveGroup(group.id, groupIndex - 1)}
                    >↑</button>
                    <button
                      type="button"
                      aria-label={`${group.name} 아래로 이동`}
                      disabled={groupIndex === groups.length - 1}
                      onClick={() => moveGroup(group.id, groupIndex + 1)}
                    >↓</button>
                  </div>
                </div>
                {expanded.has(group.id) ? (
                  <ul>
                    {group.categories.map((item, itemIndex) => (
                      <li
                        key={item.id}
                        className="category-manager-row category-manager-item"
                        data-category-source={item.source}
                        data-selected={!adding && selectedId === item.id}
                        draggable
                        onDragStart={(event) => {
                          dragged.current = { kind: "category", id: item.id };
                          event.dataTransfer.setData("text/plain", item.id);
                        }}
                        onDragEnd={() => { dragged.current = null; }}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={(event) => {
                          event.preventDefault();
                          const draggedItem = dragged.current;
                          if (draggedItem?.kind === "category" && draggedItem.id !== item.id) {
                            const index = group.categories.filter((category) => category.id !== draggedItem.id).findIndex((category) => category.id === item.id);
                            moveCategory(draggedItem.id, group.id, index);
                          }
                          dragged.current = null;
                        }}
                      >
                        <button
                          type="button"
                          className="category-row-select"
                          aria-pressed={!adding && selectedId === item.id}
                          onClick={() => {
                            setSelectedId(item.id);
                            setAdding(false);
                            setNotice("");
                          }}
                        >
                          <span className="category-grip" aria-hidden="true">⠿</span>
                          <span className="category-folder" aria-hidden="true">▱</span>
                          <span>{item.name}</span>
                        </button>
                        <span className="category-row-count">{(counts.get(item.source) ?? 0).toLocaleString()}</span>
                        <div className="category-row-order">
                          <button
                            type="button"
                            aria-label={`${item.name} 위로 이동`}
                            disabled={itemIndex === 0}
                            onClick={() => moveCategory(item.id, group.id, itemIndex - 1)}
                          >↑</button>
                          <button
                            type="button"
                            aria-label={`${item.name} 아래로 이동`}
                            disabled={itemIndex === group.categories.length - 1}
                            onClick={() => moveCategory(item.id, group.id, itemIndex + 1)}
                          >↓</button>
                        </div>
                      </li>
                    ))}
                    {!group.categories.length ? <li className="category-empty-group">하위 분류가 없습니다. 분류를 추가하거나 끌어 옮기십시오.</li> : null}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
        <CategoryEditor
          key={adding ? "new-category" : selectedId}
          item={adding ? undefined : selected}
          parentId={adding ? groups[0]?.id : selectedGroup?.id}
          adding={adding}
          posts={posts}
          groups={groups}
          onSave={(next, id, parentId) => {
            if (!save(next)) return false;
            setSelectedId(id);
            setAdding(false);
            setExpanded((previous) => new Set([...previous, parentId]));
            return true;
          }}
        />
      </div>
    </main>
  );
}

function CategoryEditor({ item, parentId, adding, posts, groups, onSave }: {
  item?: CategoryItem;
  parentId?: string;
  adding: boolean;
  posts: Post[];
  groups: CategoryGroup[];
  onSave: (groups: CategoryGroup[], id: string, parentId: string) => boolean;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [parent, setParent] = useState(parentId ?? "");
  const [error, setError] = useState("");
  const selectedPosts = item ? posts.filter((post) => post.category === item.source) : [];

  // A drag move updates the saved parent while the unfinished name stays editable.
  useEffect(() => {
    setParent(parentId ?? "");
  }, [parentId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeCategoryName(name);
    if (!normalized || normalized.length > 100) {
      setError("분류 이름은 1자에서 100자까지 입력하십시오.");
      return;
    }
    const duplicate = groups.some((group) => group.categories.some((category) => category.id !== item?.id
      && category.name.toLocaleLowerCase() === normalized.toLocaleLowerCase()));
    if (duplicate || (adding && groups.some((group) => group.categories.some((category) => category.source === normalized)))) {
      setError("같은 이름의 분류가 있습니다. 다른 이름을 입력하십시오.");
      return;
    }
    if (!groups.some((group) => group.id === parent)) {
      setError("상위 분류를 선택하십시오.");
      return;
    }
    const category = item ? { ...item, name: normalized } : {
      id: crypto.randomUUID(), source: normalized, name: normalized,
    };
    const next = groups.map((group) => {
      if (group.id === parent && group.id === parentId && item) {
        return { ...group, categories: group.categories.map((current) => current.id === item.id ? category : current) };
      }
      const categories = group.categories.filter((current) => current.id !== category.id);
      if (group.id === parent) categories.push(category);
      return { ...group, categories };
    });
    setError("");
    if (onSave(next, category.id, parent)) setName(normalized);
  }

  return (
    <aside className="category-editor" aria-label="분류 편집">
      <p className="eyebrow">{adding ? "새 분류" : "선택한 분류"}</p>
      <h2>{adding ? "분류 추가" : item?.name ?? "분류를 선택하십시오"}</h2>
      <p className="category-editor-count">{selectedPosts.length.toLocaleString()}개의 기록</p>
      {adding || item ? (
        <form onSubmit={submit} noValidate>
          <label htmlFor="category-name" data-field="name">분류 이름</label>
          <input
            id="category-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-describedby="category-name-hint"
          />
          <small id="category-name-hint">1자에서 100자까지 입력하십시오.</small>
          <label htmlFor="category-parent" data-field="parent">상위 분류</label>
          <select
            id="category-parent"
            value={parent}
            onChange={(event) => setParent(event.target.value)}
          >
            {!groups.length ? <option value="">상위 분류가 없습니다</option> : null}
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
          {error ? <p className="category-error" role="alert">{error}</p> : null}
          <button className="dark-button" type="submit" disabled={!groups.length}>
            {adding ? "분류 저장" : "변경 저장"}
          </button>
        </form>
      ) : null}
      <section className="category-source-posts" aria-labelledby="category-posts-title">
        <h3 id="category-posts-title">이 분류의 기록</h3>
        {selectedPosts.length ? (
          <ul>
            {selectedPosts.map((post) => (
              <li key={post.id}>
                <a href={postHref(post.id)}>
                  <span>{post.title}</span>
                  <Arrow />
                </a>
              </li>
            ))}
          </ul>
        ) : <p>아직 기록이 없습니다.</p>}
      </section>
    </aside>
  );
}
