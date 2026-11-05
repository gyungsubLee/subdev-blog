import Button from "../../components/button/Button";
import { useMemo, useState } from "react";
import type { Post, PublicCategory } from "../../shared/post";
import { PostStatus, POST_STATUS_LABELS } from "../../shared/post-status";
import {
  categoryDescendants,
  UNCLASSIFIED_CATEGORY_ID,
} from "../post-category/hierarchy";
import CategorySelectionDialog from "../post-category/CategorySelectionDialog";
import PostDeleteDialog from "./PostDeleteDialog";
import type { ManagementSession } from "./types";
import "./workspace.css";

const PAGE_SIZE = 15;

type WorkspaceRow = {
  post: Post;
  title: string;
  markdown: string;
  categoryId: string;
  updatedAt: string;
  status: PostStatus;
  dirty: boolean;
};

function workspaceRows(posts: Post[]): { rows: WorkspaceRow[]; error: string } {
  const rows = new Map<string, WorkspaceRow>();
  const publicIds = new Set<string>();
  for (const post of posts) {
    rows.set(post.id, {
      post,
      title: post.title,
      markdown: post.markdown,
      categoryId: post.categoryId ?? post.category,
      updatedAt: post.updatedAt,
      status: post.draft ? PostStatus.Draft : PostStatus.Published,
      dirty: false,
    });
    if (!post.draft) publicIds.add(post.id);
  }
  let error = "";
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith("second-brain:canonical-draft:")) continue;
      const id = key.slice("second-brain:canonical-draft:".length);
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "null");
        const document = value?.sourceDocument?.document;
        if (
          !id ||
          typeof value?.title !== "string" ||
          typeof value.markdown !== "string" ||
          typeof value.category !== "string" ||
          typeof document?.metadata?.id !== "string" ||
          typeof document.markdown !== "string"
        ) {
          throw new Error("Invalid recovery draft");
        }
        const metadata = document.metadata;
        const publishedRecovery = [
          "published",
          "superseded",
          "unchanged",
        ].includes(value.publication?.state);
        if (publishedRecovery && publicIds.has(metadata.id)) {
          if (id !== metadata.id) rows.delete(id);
          continue;
        }
        const canonicalId = value.canonicalId === metadata.id || publishedRecovery
          ? metadata.id
          : null;
        const rowId = canonicalId ?? id;
        const existing = rows.get(rowId);
        const associatedPost =
          existing?.post && rowId !== id
            ? { ...existing.post, recoveryKey: id }
            : existing?.post;
        const post: Post = associatedPost ?? {
          id: rowId,
          draft: !canonicalId,
          ...(canonicalId ? { recoveryKey: id } : {}),
          title: value.title,
          markdown: value.markdown,
          category: value.category,
          categoryId: value.category,
          createdAt:
            typeof metadata.created === "string" ? metadata.created : "",
          updatedAt:
            typeof metadata.updated === "string" ? metadata.updated : "",
          parentId: metadata.parent_id ?? null,
          excerpt: "",
          path: "",
          url: "",
        };
        const published = !post.draft;
        const dirty =
          published &&
          (value.title !== metadata.title ||
            value.markdown !== document.markdown ||
            value.category !== (metadata.category_id ?? "") ||
            JSON.stringify(value.tags ?? metadata.tags ?? []) !==
              JSON.stringify(metadata.tags ?? []));
        if (rowId !== id && rows.get(id)?.post.draft) rows.delete(id);
        rows.set(rowId, {
          post,
          title: value.title,
          markdown: value.markdown,
          categoryId: value.category,
          updatedAt:
            typeof value.updatedAt === "string"
              ? value.updatedAt
              : post.updatedAt,
          status: published ? PostStatus.Published : PostStatus.Draft,
          dirty,
        });
      } catch {
        error = "보관한 초안 일부를 읽지 못했습니다. 기존 데이터는 유지합니다.";
      }
    }
  } catch {
    error = "보관한 초안을 읽지 못했습니다. 브라우저 저장소를 확인하십시오.";
  }
  return {
    rows: [...rows.values()].sort((first, second) =>
      second.updatedAt.localeCompare(first.updatedAt),
    ),
    error,
  };
}

export default function ContentWorkspace({
  posts,
  categories,
  onEdit,
  draftVersion = 0,
  session,
  deletedIds = new Set<string>(),
  onDeletePost,
}: {
  posts: Post[];
  categories: PublicCategory[];
  onEdit: (post: Post) => void;
  draftVersion?: number;
  session?: ManagementSession;
  deletedIds?: Set<string>;
  onDeletePost?: (post: Post) => void;
}) {
  const [deleting, setDeleting] = useState<Post | null>(null);
  const [status, setStatus] = useState<"all" | PostStatus>("all");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [page, setPage] = useState(1);
  const { rows, error } = useMemo(
    () => {
      const result = workspaceRows(posts);
      if (deletedIds.size === 0) return result;
      return { ...result, rows: result.rows.filter((row) => !deletedIds.has(row.post.id)) };
    },
    [posts, draftVersion, deletedIds],
  );
  const statusCounts = useMemo(() => {
    let drafts = 0;
    for (const row of rows) {
      if (row.status === PostStatus.Draft) drafts++;
    }
    return { all: rows.length, draft: drafts, published: rows.length - drafts };
  }, [rows]);
  const search = query.trim().toLocaleLowerCase();
  const categoryNames = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories],
  );
  const categoryIdsBySource = useMemo(() => {
    const ids = new Map(
      categories.map((category) => [category.id, category.id]),
    );
    for (const category of categories) {
      for (const source of [category.name, ...category.sources]) {
        if (!ids.has(source)) ids.set(source, category.id);
      }
    }
    return ids;
  }, [categories]);
  const pickerCategories = useMemo(() => {
    const counts = new Map<string, number>();
    const parents = new Map(
      categories.map((category) => [category.id, category.parentId]),
    );
    for (const row of rows) {
      let id =
        categoryIdsBySource.get(row.categoryId) ?? UNCLASSIFIED_CATEGORY_ID;
      const visited = new Set<string>();
      while (id && !visited.has(id)) {
        visited.add(id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
        id = parents.get(id) ?? "";
      }
    }
    const items = categories.map((category) => ({
      ...category,
      count: counts.get(category.id) ?? 0,
    }));
    if (!categoryNames.has(UNCLASSIFIED_CATEGORY_ID)) {
      items.push({
        id: UNCLASSIFIED_CATEGORY_ID,
        name: "미분류",
        parentId: null,
        order: 0,
        sources: [],
        count: counts.get(UNCLASSIFIED_CATEGORY_ID) ?? 0,
      });
    }
    return items;
  }, [categories, categoryNames, categoryIdsBySource, rows]);
  const categorySources = useMemo(
    () => (categoryId ? categoryDescendants(categories, categoryId) : null),
    [categories, categoryId],
  );
  const filtered = useMemo(
    () =>
      rows.filter(
        (row) =>
          (status === "all" || row.status === status) &&
          (!categorySources ||
            categorySources.has(
              categoryIdsBySource.get(row.categoryId) ??
                UNCLASSIFIED_CATEGORY_ID,
            )) &&
          (!search ||
            (row.title + " " + row.markdown + " " + row.post.excerpt)
              .toLocaleLowerCase()
              .includes(search)),
      ),
    [rows, status, categorySources, categoryIdsBySource, search],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const tabs = [
    { value: "all" as const, label: "전체" },
    { value: PostStatus.Draft, label: "초안" },
    { value: PostStatus.Published, label: "공개" },
  ];

  return (
    <main className="content-workspace" id="main-content" tabIndex={-1}>
      <div className="workspace-heading">
        <h1>콘텐츠 관리</h1>
      </div>
      {error ? (
        <p role="alert" className="workspace-description">
          {error}
        </p>
      ) : null}
      <div className="workspace-layout">
        <section className="work-list" aria-label="글 목록">
          <div className="status-tabs" role="tablist" aria-label="게시 상태">
            {tabs.map((tab) => (
              <Button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={status === tab.value}
                onClick={() => {
                  setStatus(tab.value);
                  setPage(1);
                }}
              >
                {tab.label}
                <span className="count">
                  {statusCounts[tab.value]}
                </span>
              </Button>
            ))}
          </div>
          <div className="workspace-toolbar">
            <div className="workspace-category-filter">
              <span>카테고리</span>
              <Button
                type="button"
                className="outline-button workspace-category-button"
                aria-label="카테고리 필터"
                aria-haspopup="dialog"
                aria-expanded={categoryOpen}
                aria-controls="workspace-category-selection"
                onClick={() => setCategoryOpen(true)}
              >
                {categoryNames.get(categoryId) ??
                  (categoryId === UNCLASSIFIED_CATEGORY_ID
                    ? "미분류"
                    : "모든 카테고리")}
                <span aria-hidden="true">⌄</span>
              </Button>
            </div>
            <label className="workspace-search">
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                placeholder="제목이나 본문으로 찾기"
                aria-label="콘텐츠 검색"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          </div>
          <div className="workspace-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>제목</th>
                  <th>상태</th>
                  <th>분류</th>
                  <th>수정일</th>
                  <th>
                    <span className="sr-only">작업</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <tr key={row.post.id}>
                    <td>
                      <Button
                        type="button"
                        className="row-title"
                        onClick={() => onEdit(row.post)}
                      >
                        {row.title || "제목 없음"}
                      </Button>
                      {row.dirty ? (
                        <p className="row-note">공개되지 않은 수정 사항</p>
                      ) : null}
                    </td>
                    <td>
                      <span className={`workspace-status ${row.status}`}>
                        {POST_STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td>
                      {categoryNames.get(row.categoryId) ??
                        (row.categoryId || "미분류")}
                    </td>
                    <td>{row.updatedAt.slice(0, 10)}</td>
                    <td>
                      <Button
                        type="button"
                        className="row-action"
                        onClick={() => onEdit(row.post)}
                      >
                        편집 ↗
                      </Button>
                      {session?.state === "ready" ? (
                        <Button
                          type="button"
                          className="row-action workspace-delete"
                          aria-label={`${row.title || "제목 없음"} 삭제`}
                          onClick={() => setDeleting({ ...row.post, title: row.title })}
                        >
                          삭제
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!visible.length ? (
              <p className="workspace-empty">
                조건에 맞는 글이 없습니다. 다른 검색어나 상태를 선택하세요.
              </p>
            ) : null}
          </div>
          <nav className="workspace-pagination" aria-label="콘텐츠 페이지">
            <Button
              type="button"
              className="outline-button"
              aria-label="이전 페이지"
              disabled={currentPage === 1}
              onClick={() => setPage(currentPage - 1)}
            >
              이전
            </Button>
            <span role="status">
              {filtered.length.toLocaleString()}개 · {currentPage} /{" "}
              {totalPages} 페이지
            </span>
            <Button
              type="button"
              className="outline-button"
              aria-label="다음 페이지"
              disabled={currentPage === totalPages}
              onClick={() => setPage(currentPage + 1)}
            >
              다음
            </Button>
          </nav>
        </section>
      </div>
      {deleting && session ? (
        <PostDeleteDialog
          post={deleting}
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            onDeletePost?.(deleting);
            setDeleting(null);
          }}
        />
      ) : null}
      {categoryOpen ? (
        <CategorySelectionDialog
          id="workspace-category-selection"
          categories={pickerCategories}
          value={categoryId}
          emptyLabel="모든 카테고리"
          onConfirm={(id) => {
            setCategoryId(id);
            setPage(1);
            setCategoryOpen(false);
          }}
          onClose={() => setCategoryOpen(false)}
        />
      ) : null}
    </main>
  );
}
