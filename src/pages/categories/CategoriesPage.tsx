import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  normalizeCategoryName,
  type CategoryCatalog,
} from "../../features/post-category/catalog";
import {
  MAX_CATEGORIES,
  UNCLASSIFIED_CATEGORY_ID,
  moveCategoryNode,
  removeCategoryNode,
  type CategoryNode,
  type CategoryDrop,
} from "../../features/post-category/hierarchy";
import type { Post } from "../../shared/post";
import { useCategoryDrag } from "./useCategoryDrag";
import "./CategoriesPage.css";

type Editing = {
  mode: "add" | "edit";
  id: string | null;
  parentId: string | null;
  name: string;
};
type Props = {
  posts: Post[];
  catalog: Pick<CategoryCatalog,
    "draftNodes" | "stage" | "undo" | "canUndo" | "dirty" | "saveNodes" | "error"
  >;
  canonical?: boolean;
  busy?: boolean;
  note?: ReactNode;
  footer?: ReactNode;
  deleteError?: (node: CategoryNode) => string | null;
};

export default function CategoriesPage({
  posts,
  catalog,
  canonical = false,
  busy = false,
  note,
  footer,
  deleteError,
}: Props) {
  const nodes = catalog.draftNodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const [selectedId, setSelectedId] = useState<string | null>(
    () =>
      nodes.find((node) => node.name === "기술 면접 준비")?.id ??
      nodes[0]?.id ??
      null,
  );
  const [expanded, setExpanded] = useState(() => new Set(["group:cs"]));
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const children = (parentId: string | null) =>
    nodes.filter((node) => node.parentId === parentId);
  const directCounts = new Map<string, number>();
  for (const post of posts) {
    if (canonical && post.draft) continue;
    const category = canonical ? (post.categoryId ?? post.category) : post.category;
    directCounts.set(category, (directCounts.get(category) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const categoryKeys = canonical ? [...new Set([node.id, ...node.sources])] : node.sources;
    const count = categoryKeys.reduce(
      (total, source) => total + (directCounts.get(source) ?? 0),
      0,
    );
    let ancestor: CategoryNode | undefined = node;
    while (ancestor) {
      counts.set(ancestor.id, (counts.get(ancestor.id) ?? 0) + count);
      ancestor =
        ancestor.parentId === null ? undefined : byId.get(ancestor.parentId);
    }
  }

  useEffect(() => {
    if (deletingId !== null && dialog.current && !dialog.current.open)
      dialog.current.showModal();
  }, [deletingId]);

  function reveal(parentId: string | null) {
    setExpanded((previous) => {
      const next = new Set(previous);
      let parent = parentId === null ? undefined : byId.get(parentId);
      while (parent) {
        next.add(parent.id);
        parent =
          parent.parentId === null ? undefined : byId.get(parent.parentId);
      }
      return next;
    });
  }
  function stage(next: CategoryNode[], message: string) {
    catalog.stage(next);
    setEditing(null);
    setNotice(message);
  }
  function move(
    id: string,
    destination: Pick<CategoryDrop, "parentId" | "beforeId">,
  ) {
    try {
      const next = moveCategoryNode(
        nodes,
        id,
        destination.parentId,
        destination.beforeId,
      );
      setSelectedId(id);
      reveal(destination.parentId);
      stage(
        next,
        "끌어서 순서와 깊이를 변경했습니다. 하위 분류도 함께 이동합니다.",
      );
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "분류를 옮기지 못했습니다.",
      );
    }
  }
  const drag = useCategoryDrag(nodes, editing !== null || busy, move);

  function startEditing(mode: Editing["mode"], node?: CategoryNode) {
    if (editing) {
      setNotice("열려 있는 편집을 확인하거나 취소하십시오.");
      return;
    }
    if (mode === "add" && nodes.length >= MAX_CATEGORIES) {
      setNotice("분류는 500개까지 추가할 수 있습니다.");
      return;
    }
    const parentId = mode === "add" ? (node?.id ?? null) : node!.parentId;
    if (node && mode === "edit") setSelectedId(node.id);
    reveal(parentId);
    setEditing({
      mode,
      id: mode === "edit" ? node!.id : null,
      parentId,
      name: mode === "edit" ? node!.name : "",
    });
    setNotice("");
  }
  function saveEdit(name: string): string | null {
    if (!editing) return null;
    if (
      !canonical &&
      nodes.some(
        (node) =>
          node.id !== editing.id &&
          node.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      return "같은 이름의 카테고리가 있습니다.";
    }
    if (editing.mode === "edit") {
      stage(
        nodes.map((node) =>
          node.id === editing.id ? { ...node, name } : node,
        ),
        "카테고리 이름을 변경했습니다.",
      );
      return null;
    }
    if (nodes.length >= MAX_CATEGORIES)
      return "분류는 500개까지 추가할 수 있습니다.";
    const node: CategoryNode = {
      id: crypto.randomUUID(),
      name,
      parentId: editing.parentId,
      sources: [],
    };
    const firstChild = children(editing.parentId)[0];
    const next = [...nodes];
    next.splice(
      firstChild
        ? next.findIndex((item) => item.id === firstChild.id)
        : next.length,
      0,
      node,
    );
    setSelectedId(node.id);
    stage(next, "카테고리를 추가했습니다. 하단에서 변경사항을 저장하십시오.");
    return null;
  }
  function keyboardMove(
    event: KeyboardEvent<HTMLButtonElement>,
    node: CategoryNode,
  ) {
    if (
      editing ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const siblings = children(node.parentId);
    const index = siblings.findIndex((item) => item.id === node.id);
    let destination: Pick<CategoryDrop, "parentId" | "beforeId"> | null = null;
    if (event.key === "ArrowLeft" && node.parentId !== null) {
      const parent = byId.get(node.parentId)!;
      const uncles = children(parent.parentId);
      const afterParent =
        uncles[uncles.findIndex((item) => item.id === parent.id) + 1];
      destination = {
        parentId: parent.parentId,
        beforeId: afterParent?.id ?? null,
      };
    } else if (event.key === "ArrowRight" && index > 0) {
      destination = { parentId: siblings[index - 1].id, beforeId: null };
    } else if (event.key === "ArrowUp" && index > 0) {
      destination = {
        parentId: node.parentId,
        beforeId: siblings[index - 1].id,
      };
    } else if (event.key === "ArrowDown" && index < siblings.length - 1) {
      destination = {
        parentId: node.parentId,
        beforeId: siblings[index + 2]?.id ?? null,
      };
    }
    if (destination) {
      move(node.id, destination);
      window.requestAnimationFrame(() => {
        [
          ...(drag.pageRef.current?.querySelectorAll<HTMLElement>(
            ".category-row",
          ) ?? []),
        ]
          .find((row) => row.dataset.id === node.id)
          ?.querySelector<HTMLButtonElement>(".grip")
          ?.focus({ preventScroll: true });
      });
    }
  }
  function closeDelete() {
    dialog.current?.close();
    setDeletingId(null);
  }
  function deleteCategory() {
    if (deletingId === null) return;
    const node = byId.get(deletingId);
    if (!node) {
      closeDelete();
      return;
    }
    const blocked = deleteError?.(node);
    if (blocked) {
      setNotice(blocked);
      closeDelete();
      return;
    }
    const next = canonical
      ? nodes.filter((item) => item.id !== node.id)
      : removeCategoryNode(nodes, node.id);
    setSelectedId(node.parentId ?? next[0]?.id ?? null);
    stage(next, "분류를 삭제했습니다. 실행 취소로 복원할 수 있습니다.");
    closeDelete();
  }
  function inlineForm(depth: number) {
    return editing ? (
      <InlineCategoryForm
        key={editing.mode + (editing.id ?? editing.parentId ?? "root")}
        editing={editing}
        depth={depth}
        onCancel={() => setEditing(null)}
        onSave={saveEdit}
      />
    ) : null;
  }
  function rows(parentId: string | null, depth = 0): React.ReactNode {
    return children(parentId).map((node) => {
      const hasChildren = children(node.id).length > 0;
      return (
        <div className="category-branch" key={node.id}>
          {editing?.id === node.id ? (
            inlineForm(depth)
          ) : (
            <div
              className={
                "category-row" + (selectedId === node.id ? " selected" : "")
              }
              style={{ "--depth": depth } as React.CSSProperties}
              data-id={node.id}
            >
              <button
                type="button"
                className="expander"
                disabled={!hasChildren}
                aria-expanded={hasChildren ? expanded.has(node.id) : undefined}
                aria-label={`${node.name} ${expanded.has(node.id) ? "접기" : "펼치기"}`}
                onClick={() =>
                  setExpanded((previous) => {
                    const next = new Set(previous);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
              >
                {hasChildren ? (expanded.has(node.id) ? "⌄" : "›") : "·"}
              </button>
              <button
                type="button"
                className="grip"
                aria-label={`${node.name} 끌어서 이동`}
                title="끌어서 이동 · 방향키로 순서와 깊이 변경"
                onPointerDown={(event) => drag.start(event, node, depth)}
                onKeyDown={(event) => keyboardMove(event, node)}
              >
                ≡
              </button>
              <button
                type="button"
                className="row-name"
                aria-pressed={selectedId === node.id}
                onClick={() => {
                  if (!editing) setSelectedId(node.id);
                }}
              >
                {node.name}
                <span className="inline-count">
                  ({(counts.get(node.id) ?? 0).toLocaleString()})
                </span>
              </button>
              <div className="row-actions">
                <button
                  type="button"
                  data-action="add"
                  aria-label={`${node.name} 하위 추가`}
                  disabled={Boolean(editing) || nodes.length >= MAX_CATEGORIES}
                  onClick={() => startEditing("add", node)}
                >
                  추가
                </button>
                <button
                  type="button"
                  data-action="edit"
                  aria-label={`${node.name} 수정`}
                  disabled={Boolean(editing)}
                  onClick={() => startEditing("edit", node)}
                >
                  수정
                </button>
                <button
                  type="button"
                  data-action="delete"
                  aria-label={`${node.name} 삭제`}
                  disabled={
                    Boolean(editing) ||
                    node.id === UNCLASSIFIED_CATEGORY_ID ||
                    Boolean(deleteError?.(node))
                  }
                  title={deleteError?.(node) ?? undefined}
                  onClick={() => setDeletingId(node.id)}
                >
                  삭제
                </button>
              </div>
            </div>
          )}
          {editing?.mode === "add" && editing.parentId === node.id
            ? inlineForm(depth + 1)
            : null}
          {hasChildren && expanded.has(node.id)
            ? rows(node.id, depth + 1)
            : null}
        </div>
      );
    });
  }

  return (
    <main
      id="main-content"
      className="categories-page"
      tabIndex={-1}
      ref={drag.pageRef}
    >
      <div className="page-heading">
        <div>
          <p className="eyebrow">기록 관리</p>
          <h1>카테고리 관리</h1>
        </div>
      </div>
      <p className="category-local-note">
        {note ?? <>분류 설정은 이 브라우저에만 저장합니다. 원문 기록과 페이지 계층은 바꾸지 않습니다.</>}
      </p>
      <fieldset className="category-edit-controls" disabled={busy}>
        <div className="layout">
          <section className="manager" aria-label="카테고리 목록 관리">
            <div className="manager-heading">
              <div>
                <p>카테고리 순서와 계층을 정리합니다.</p>
                <p className="muted">
                  끌어서 순서와 깊이를 바꾸고, 행 안에서 분류를 편집합니다.
                </p>
              </div>
              <div className="tree-tools">
                <span>
                  {nodes.length + (editing?.mode === "add" ? 1 : 0)} / 500
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setExpanded(new Set(nodes.map((node) => node.id)))
                  }
                >
                  전체 펼치기
                </button>
                <button type="button" onClick={() => setExpanded(new Set())}>
                  전체 접기
                </button>
              </div>
            </div>
            <div className="tree-frame">
              <div className="all-row">
                <span className="grip-icon" aria-hidden="true">
                  ≡
                </span>
                <span>분류 전체보기</span>
              </div>
              <div className="tree" aria-label="분류 계층">
                {editing?.mode === "add" && editing.parentId === null
                  ? inlineForm(0)
                  : null}
                {rows(null)}
              </div>
              <button
                type="button"
                id="add-bottom"
                className="add-bottom"
                disabled={Boolean(editing) || nodes.length >= MAX_CATEGORIES}
                onClick={() => startEditing("add")}
              >
                <span>＋　카테고리 추가</span>
                <span>
                  {nodes.length + (editing?.mode === "add" ? 1 : 0)} / 500
                </span>
              </button>
            </div>
            <div className="save-bar">
              <div>
                <p>
                  {catalog.dirty
                    ? "저장하지 않은 변경사항이 있습니다."
                    : "저장한 상태입니다."}
                </p>
                <button
                  type="button"
                  id="undo"
                  disabled={!catalog.canUndo || Boolean(editing)}
                  onClick={() => {
                    catalog.undo();
                    setNotice("마지막 변경을 취소했습니다.");
                  }}
                >
                  실행 취소
                </button>
              </div>
              <button
                type="button"
                className="dark"
                id="save-all"
                disabled={!catalog.dirty || Boolean(editing)}
                onClick={() => {
                  if (catalog.saveNodes(nodes))
                    setNotice("분류 설정을 저장했습니다.");
                  else setNotice("");
                }}
              >
                변경사항 저장
              </button>
            </div>
          </section>
        </div>
      </fieldset>
      {catalog.error ? (
        <p className="error category-storage-error" role="alert">
          {catalog.error}
        </p>
      ) : null}
      <p className="status" role="status" aria-live="polite">
        {notice}
      </p>
      {footer}
      <dialog
        id="delete-dialog"
        ref={dialog}
        aria-labelledby="delete-title"
        onCancel={() => setDeletingId(null)}
      >
        <div className="modal-body">
          <h2 id="delete-title">분류 삭제</h2>
          <p>
            '{byId.get(deletingId ?? "")?.name}' 카테고리를 삭제하시겠습니까?
          </p>
          <p className="muted">
            {canonical
              ? "하위 분류와 배정한 글이 없는 분류만 삭제합니다."
              : "하위 분류는 한 단계 위로 옮깁니다. 기록은 미분류에 유지합니다."}
          </p>
        </div>
        <div className="modal-footer">
          <button type="button" onClick={closeDelete}>
            취소
          </button>
          <button
            type="button"
            id="confirm-delete"
            className="dark"
            disabled={busy}
            onClick={deleteCategory}
          >
            삭제
          </button>
        </div>
      </dialog>
      <div id="drag-ghost" ref={drag.ghostRef} hidden />
      <div id="drop-line" ref={drag.lineRef} hidden />
      <div
        id="drop-hint"
        ref={drag.hintRef}
        hidden
        role="status"
        aria-live="polite"
      />
    </main>
  );
}

function InlineCategoryForm({
  editing,
  depth,
  onCancel,
  onSave,
}: {
  editing: Editing;
  depth: number;
  onCancel: () => void;
  onSave: (name: string) => string | null;
}) {
  const [name, setName] = useState(editing.name);
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const normalized = normalizeCategoryName(name);
    if (!normalized || normalized.length > 100) {
      setError("이름은 1자에서 100자까지 입력하십시오.");
      return;
    }
    setError(onSave(normalized) ?? "");
  }
  return (
    <div
      className="inline-row"
      style={{ "--depth": depth } as React.CSSProperties}
    >
      <form id="inline-form" onSubmit={submit} noValidate>
        <label className="sr-only" htmlFor="inline-name">
          카테고리 이름
        </label>
        <input
          id="inline-name"
          maxLength={100}
          autoComplete="off"
          autoFocus
          value={name}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "inline-error" : undefined}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder="카테고리 이름"
        />
        <button type="button" onClick={onCancel}>
          취소
        </button>
        <button
          type="submit"
          disabled={!normalizeCategoryName(name) || name === editing.name}
        >
          확인
        </button>
      </form>
      {error ? (
        <div id="inline-error" className="inline-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
