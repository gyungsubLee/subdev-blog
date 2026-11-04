import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import Button from "../../components/button/Button";
import type { Post } from "../../shared/post";
import { normalizeCategoryName, type CategoryCatalog } from "./catalog";
import {
  categoryDescendants,
  MAX_CATEGORIES,
  moveCategoryNode,
  removeCategoryNode,
  UNCLASSIFIED_CATEGORY_ID,
  type CategoryNode,
} from "./hierarchy";
import type { useRecordsBrowser } from "./useRecordsBrowser";
import { useRecordsCategoryDrag } from "./useRecordsCategoryDrag";
import "./records-categories.css";

type Snapshot = {
  nodes: CategoryNode[];
  selected: string | null;
  expanded: Set<string>;
  overviewExpanded: Set<string>;
};
type Menu = {
  id: string | null;
  postId?: string;
  overview: boolean;
  x: number;
  y: number;
};
type Editor = {
  mode: "add" | "rename" | "delete";
  id: string | null;
  parentId: string | null;
  name: string;
};

function RecordsDialog({
  label,
  className = "",
  onClose,
  children,
}: {
  label: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const origin = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (origin instanceof HTMLElement && origin.isConnected) origin.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`records-dialog ${className}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export default function RecordsCategories({
  posts,
  catalog,
  browser,
  onWrite,
  onEdit,
  onDelete,
  children,
}: {
  posts: Post[];
  catalog: CategoryCatalog;
  browser: ReturnType<typeof useRecordsBrowser>;
  onWrite: (categoryId?: string) => void;
  onEdit?: (post: Post) => void;
  onDelete?: (post: Post) => void;
  children: ReactNode;
}) {
  const nodes = catalog.nodes;
  const root = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<"tags" | "sidebar">("tags");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [overviewExpanded, setOverviewExpanded] = useState<Set<string>>(
    () => new Set(),
  );
  const [overview, setOverview] = useState(false);
  const [menu, setMenu] = useState<Menu | null>(null);
  const menuOrigin = useRef<HTMLElement | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    redo: boolean;
    expected: Snapshot;
  } | null>(null);
  const undo = useRef<Snapshot[]>([]);
  const redo = useRef<Snapshot[]>([]);
  const selected = browser.categoryId ?? browser.groupId;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const latest = useRef({ nodes, expanded, overviewExpanded });
  latest.current = { nodes, expanded, overviewExpanded };

  const counts = useMemo(() => {
    const direct = new Map<string, number>();
    for (const post of posts)
      direct.set(post.category, (direct.get(post.category) ?? 0) + 1);
    const totals = new Map(nodes.map((node) => [node.id, 0]));
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      const count = node.sources.reduce(
        (sum, source) => sum + (direct.get(source) ?? 0),
        0,
      );
      let ancestor: CategoryNode | undefined = node;
      while (ancestor) {
        totals.set(ancestor.id, (totals.get(ancestor.id) ?? 0) + count);
        ancestor =
          ancestor.parentId === null ? undefined : byId.get(ancestor.parentId);
      }
    }
    return totals;
  }, [posts, nodes]);

  function snapshot(): Snapshot {
    return {
      nodes: latest.current.nodes,
      selected: selectedRef.current,
      expanded: new Set(latest.current.expanded),
      overviewExpanded: new Set(latest.current.overviewExpanded),
    };
  }
  function apply(next: CategoryNode[]) {
    if (JSON.stringify(next) === JSON.stringify(nodes)) return false;
    const previous = snapshot();
    if (!catalog.saveNodes(next)) return false;
    // ponytail: immutable category snapshots are capped at 50; use inverse operations for larger catalogs.
    undo.current = [...undo.current.slice(-49), previous];
    redo.current = [];
    return true;
  }
  function reveal(
    id: string | null,
    items: CategoryNode[],
    from = expanded,
    exclusive = false,
  ) {
    const next = new Set(from);
    let node = items.find((item) => item.id === id);
    while (node) {
      if (exclusive) {
        for (const sibling of items.filter(
          (item) => item.parentId === node!.parentId && item.id !== node!.id,
        )) {
          for (const id of categoryDescendants(items, sibling.id))
            next.delete(id);
        }
      }
      next.add(node.id);
      node = items.find((item) => item.id === node!.parentId);
    }
    return next;
  }
  const drag = useRecordsCategoryDrag(root, nodes, (id, destination) => {
    try {
      const next = moveCategoryNode(
        nodes,
        id,
        destination.parentId,
        destination.beforeId,
      );
      if (!apply(next)) return false;
      setExpanded(
        reveal(destination.parentId, next, expanded, view === "tags"),
      );
      setOverviewExpanded(reveal(destination.parentId, next, overviewExpanded));
      return true;
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "이동하지 못했습니다.",
      );
      return false;
    }
  });

  function select(id: string | null) {
    const node = nodes.find((item) => item.id === id);
    if (!node || node.parentId === null) browser.selectGroup(node?.id ?? null);
    else browser.selectCategory(node.id);
    setExpanded(
      reveal(node?.parentId ?? null, nodes, expanded, view === "tags"),
    );
    setOverview(false);
  }
  function restoreHistory() {
    if (!confirmation) return;
    const source = confirmation.redo ? redo.current : undo.current;
    const destination = confirmation.redo ? undo.current : redo.current;
    const previous = source.at(-1);
    if (previous !== confirmation.expected) {
      setConfirmation(null);
      return;
    }
    if (!catalog.saveNodes(previous.nodes)) return;
    destination.push(snapshot());
    source.pop();
    setExpanded(previous.expanded);
    setOverviewExpanded(previous.overviewExpanded);
    const node = previous.nodes.find((item) => item.id === previous.selected);
    if (!node || node.parentId === null) browser.selectGroup(node?.id ?? null);
    else browser.selectCategory(node.id);
    setConfirmation(null);
  }
  useEffect(() => {
    function key(event: globalThis.KeyboardEvent) {
      if (
        !event.metaKey ||
        event.key.toLowerCase() !== "z" ||
        event.altKey ||
        event.isComposing
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
        )
      )
        return;
      if (editor || confirmation) return;
      const expected = (event.shiftKey ? redo.current : undo.current).at(-1);
      if (!expected) return;
      event.preventDefault();
      drag.cancel();
      setMenu(null);
      setConfirmation({ redo: event.shiftKey, expected });
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [editor, confirmation]);

  function openOverview() {
    drag.cancel();
    setOverviewExpanded(
      new Set([
        ...nodes
          .filter((node) => node.parentId === null)
          .map((node) => node.id),
        ...expanded,
      ]),
    );
    setOverview(true);
    setMenu(null);
  }
  function write(id = selected ?? undefined) {
    drag.cancel();
    setMenu(null);
    setOverview(false);
    onWrite(id);
  }
  function closeMenu() {
    setMenu(null);
    menuOrigin.current?.focus();
  }
  function context(target: Element, x: number, y: number) {
    drag.cancel();
    menuOrigin.current = target.closest<HTMLElement>("button,a,dialog,main");
    if (target.closest("[data-record-all]")) {
      setMenu(null);
      return;
    }
    const row = target.closest<HTMLElement>("[data-record-category]");
    const postId = target
      .closest<HTMLAnchorElement>("a.post-card")
      ?.getAttribute("href")
      ?.match(/^#\/post\/([^/#?]+)/)?.[1];
    setMenu({
      postId,
      id: row?.dataset.recordCategory ?? null,
      overview: Boolean(target.closest(".overview-dialog")),
      x,
      y,
    });
  }
  function contextMenu(event: MouseEvent) {
    if (
      !(event.target instanceof Element) ||
      event.target.closest("input,textarea,select")
    )
      return;
    event.preventDefault();
    context(event.target, event.clientX, event.clientY);
  }
  function contextKey(event: KeyboardEvent) {
    if (
      event.target instanceof Element &&
      event.target.closest("input,textarea,select,[contenteditable]")
    )
      return;
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      if (!(event.target instanceof Element)) return;
      event.preventDefault();
      const rect = event.target.getBoundingClientRect();
      context(event.target, rect.left, rect.bottom);
    }
  }
  function edit(mode: Editor["mode"], parentId: string | null = null) {
    menuOrigin.current?.focus();
    const node = nodes.find((item) => item.id === menu?.id);
    setEditor({
      mode,
      id: node?.id ?? null,
      parentId,
      name: mode === "rename" ? (node?.name ?? "") : "",
    });
    setError("");
    setMenu(null);
  }
  function submit() {
    if (!editor) return;
    try {
      let next: CategoryNode[];
      if (editor.mode === "delete") {
        if (
          nodes.some((node) => node.parentId === editor.id) ||
          editor.id === UNCLASSIFIED_CATEGORY_ID
        )
          throw Error("하위 카테고리가 있는 분류는 삭제할 수 없습니다.");
        next = removeCategoryNode(nodes, editor.id!);
      } else {
        const name = normalizeCategoryName(editor.name);
        if (!name || name.length > 100)
          throw Error("분류 이름은 1~100자로 입력하십시오.");
        if (
          nodes.some(
            (node) =>
              node.id !== editor.id &&
              node.parentId ===
                (editor.mode === "rename"
                  ? nodes.find((item) => item.id === editor.id)?.parentId
                  : editor.parentId) &&
              node.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )
        )
          throw Error("같은 이름의 분류가 있습니다.");
        if (editor.mode === "add") {
          if (nodes.length >= MAX_CATEGORIES)
            throw Error("분류는 최대 500개까지 만들 수 있습니다.");
          next = [
            ...nodes,
            {
              id: crypto.randomUUID(),
              name,
              parentId: editor.parentId,
              sources: [],
            },
          ];
        } else
          next = nodes.map((node) =>
            node.id === editor.id ? { ...node, name } : node,
          );
      }
      if (apply(next)) {
        if (editor.mode === "add") {
          setExpanded(reveal(editor.parentId, next, expanded, view === "tags"));
          setOverviewExpanded(reveal(editor.parentId, next, overviewExpanded));
        }
        setEditor(null);
      } else if (JSON.stringify(next) === JSON.stringify(nodes))
        setEditor(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "분류를 저장하지 못했습니다.",
      );
    }
  }
  const displayNodes = drag.preview?.nodes ?? nodes;
  const breadcrumb: string[] = [];
  let ancestor = nodes.find((node) => node.id === selected);
  while (ancestor) {
    breadcrumb.unshift(ancestor.name);
    ancestor = nodes.find((node) => node.id === ancestor!.parentId);
  }

  function navigation(variant: "tags" | "sidebar" | "overview") {
    const isOverview = variant === "overview";
    let open = isOverview ? overviewExpanded : expanded;
    if (drag.preview)
      open = reveal(
        drag.preview.parentId,
        displayNodes,
        open,
        variant === "tags",
      );
    const childrenOf = (id: string | null) =>
      displayNodes.filter((node) => node.parentId === id);
    const roots = childrenOf(null);
    function toggle(node: CategoryNode) {
      const next = new Set(open);
      if (next.has(node.id)) {
        for (const id of categoryDescendants(displayNodes, node.id))
          next.delete(id);
      } else {
        if (variant === "tags") {
          for (const sibling of childrenOf(node.parentId)) {
            for (const id of categoryDescendants(displayNodes, sibling.id))
              next.delete(id);
          }
        }
        next.add(node.id);
      }
      (isOverview ? setOverviewExpanded : setExpanded)(next);
    }
    function row(node: CategoryNode, depth: number): ReactNode {
      const children = childrenOf(node.id);
      const branch = children.length > 0;
      const expandedNode = open.has(node.id);
      const previewSource = drag.preview?.id === node.id;
      return (
        <div key={node.id} className="records-category-branch">
          <Button
            type="button"
            className={`records-category-row${branch ? " branch-row" : " leaf-row"}${depth === 1 ? " root-row" : ""}${drag.dropped === node.id && variant !== "tags" ? " records-drop-feedback" : ""}`}
            data-record-category={node.id}
            data-drag-source={drag.activeId === node.id || undefined}
            data-depth={depth}
            data-preview-source={previewSource || undefined}
            data-preview-level={
              (variant !== "tags" && drag.preview?.parentId === node.id) ||
              undefined
            }
            aria-label={node.name}
            aria-expanded={branch ? expandedNode : undefined}
            aria-pressed={!branch ? selected === node.id : undefined}
            onClick={() => (branch ? toggle(node) : select(node.id))}
            onDoubleClick={() => branch && select(node.id)}
          >
            {variant !== "tags" && branch ? (
              <span className="records-chevron" aria-hidden="true">
                {expandedNode ? "⌄" : "›"}
              </span>
            ) : null}
            {variant === "sidebar" && depth === 1 ? (
              <svg
                className="records-folder"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M3 5h7l2 3h9v12H3z" />
              </svg>
            ) : null}
            <span className="records-category-label">{node.name}</span>
            {variant !== "tags" || !branch ? (
              <span className="records-count">
                {(counts.get(node.id) ?? 0).toLocaleString()}
              </span>
            ) : null}
          </Button>
          {variant !== "tags" && branch && expandedNode ? (
            <div className="records-category-children">
              {children.map((child) => row(child, depth + 1))}
            </div>
          ) : null}
        </div>
      );
    }
    const all = (
      <Button
        type="button"
        className="records-category-row records-all"
        data-record-all=""
        aria-label="모든 기록"
        aria-pressed={!selected}
        onClick={() => select(null)}
      >
        <span>모든 기록</span>
        <span className="records-count">{posts.length.toLocaleString()}</span>
      </Button>
    );
    let contents: ReactNode;
    if (variant === "tags") {
      const levels: ReactNode[] = [];
      let level = roots;
      let depth = 1;
      while (level.length) {
        levels.push(
          <div
            key={depth}
            className="records-tag-level"
            aria-label={`${depth}단계 카테고리`}
          >
            {depth === 1 ? all : null}
            {level.map((node) => row(node, depth))}
          </div>,
        );
        const branch = level.find(
          (node) => open.has(node.id) && childrenOf(node.id).length,
        );
        level = branch ? childrenOf(branch.id) : [];
        depth++;
      }
      contents = levels.length ? levels : all;
    } else
      contents = (
        <>
          {all}
          <div
            className={
              isOverview ? "records-category-grid" : "records-category-tree"
            }
          >
            {roots.map((node) => (
              <section key={node.id}>{row(node, 1)}</section>
            ))}
          </div>
        </>
      );
    return (
      <nav
        className={`records-category-nav records-nav-${variant}`}
        data-view={variant}
        aria-label="카테고리"
      >
        {contents}
      </nav>
    );
  }

  const menuNode = nodes.find((node) => node.id === menu?.id);
  const deleteDisabled =
    menuNode?.id === UNCLASSIFIED_CATEGORY_ID ||
    nodes.some((node) => node.parentId === menuNode?.id);
  return (
    <div
      ref={root}
      className="records-category-workspace"
      onContextMenu={contextMenu}
      onKeyDown={contextKey}
    >
      <section className="records-view-panel" aria-label="카테고리 보기 설정">
        <h2>카테고리</h2>
        <div
          className="records-view-options"
          role="group"
          aria-label="카테고리 보기"
        >
          {(["tags", "sidebar", "overview"] as const).map((variant) => {
            const label =
              variant === "tags"
                ? "태그 보기"
                : variant === "sidebar"
                  ? "사이드바 보기"
                  : "카테고리 전체 보기";
            return (
              <span className="records-view-option" key={variant}>
                <Button
                  type="button"
                  aria-label={label}
                  aria-describedby={`records-tooltip-${variant}`}
                  aria-pressed={
                    variant !== "overview" ? view === variant : undefined
                  }
                  aria-haspopup={variant === "overview" ? "dialog" : undefined}
                  onClick={() => {
                    if (variant === "overview") openOverview();
                    else {
                      drag.cancel();
                      setView(variant);
                    }
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    aria-hidden="true"
                  >
                    {variant === "tags" ? (
                      <>
                        <rect x="3" y="5" width="8" height="5" rx="2.5" />
                        <rect x="14" y="5" width="7" height="5" rx="2.5" />
                        <rect x="3" y="14" width="13" height="5" rx="2.5" />
                      </>
                    ) : variant === "sidebar" ? (
                      <>
                        <rect x="3" y="4" width="18" height="16" rx="1" />
                        <path d="M9 4v16M5.5 8h1M5.5 12h1M5.5 16h1" />
                      </>
                    ) : (
                      <>
                        <rect x="3" y="3" width="7" height="7" rx="1" />
                        <rect x="14" y="3" width="7" height="7" rx="1" />
                        <rect x="3" y="14" width="7" height="7" rx="1" />
                        <rect x="14" y="14" width="7" height="7" rx="1" />
                      </>
                    )}
                  </svg>
                </Button>
                <span role="tooltip" id={`records-tooltip-${variant}`}>
                  {label}
                </span>
              </span>
            );
          })}
        </div>
      </section>
      <div className={`records-body records-layout-${view}`}>
        <aside aria-label="카테고리">{navigation(view)}</aside>
        {children}
      </div>
      {catalog.error ? <p role="alert">{catalog.error}</p> : null}
      {overview ? (
        <RecordsDialog
          label="카테고리 전체 보기"
          className="overview-dialog"
          onClose={() => {
            drag.cancel();
            setOverview(false);
            setMenu(null);
          }}
        >
          <header className="overview-dialog-heading">
            <div>
              <h2>카테고리 전체 보기</h2>
              <p>{breadcrumb.join("　›　") || "모든 기록"}</p>
            </div>
            <Button
              type="button"
              className="dialog-close"
              autoFocus
              onClick={() => {
                drag.cancel();
                setOverview(false);
                setMenu(null);
              }}
            >
              닫기 <span aria-hidden="true">×</span>
            </Button>
          </header>
          <div className="overview-dialog-actions">
            <Button
              type="button"
              onClick={() =>
                setOverviewExpanded(new Set(nodes.map((node) => node.id)))
              }
            >
              모두 펼치기
            </Button>
            <Button
              type="button"
              onClick={() => setOverviewExpanded(new Set())}
            >
              모두 닫기
            </Button>
          </div>
          <div className="overview-dialog-body">{navigation("overview")}</div>
          {menu?.overview ? renderMenu() : null}
        </RecordsDialog>
      ) : null}
      {menu && !menu.overview ? renderMenu() : null}
      {editor ? (
        <RecordsDialog
          label={
            editor.mode === "add"
              ? "카테고리 추가"
              : editor.mode === "rename"
                ? "카테고리 이름 변경"
                : "카테고리 삭제"
          }
          className="records-category-editor"
          onClose={() => setEditor(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <h2>
              {editor.mode === "delete"
                ? "카테고리 삭제"
                : editor.mode === "rename"
                  ? "카테고리 이름 변경"
                  : "카테고리 추가"}
            </h2>
            {editor.mode === "delete" ? (
              <p>
                이 카테고리를 삭제합니다. 연결된 기록은 미분류로 이동합니다.
              </p>
            ) : (
              <label>
                카테고리 이름
                <input
                  name="categoryName"
                  value={editor.name}
                  maxLength={100}
                  autoFocus
                  onChange={(event) =>
                    setEditor({ ...editor, name: event.target.value })
                  }
                />
              </label>
            )}
            {error ? <p role="alert">{error}</p> : null}
            <div className="records-dialog-actions">
              <Button type="button" onClick={() => setEditor(null)}>
                취소
              </Button>
              <Button type="submit">
                {editor.mode === "delete" ? "삭제" : "저장"}
              </Button>
            </div>
          </form>
        </RecordsDialog>
      ) : null}
      {confirmation ? (
        <RecordsDialog
          label={confirmation.redo ? "다시 실행" : "되돌리기"}
          className="history-confirmation"
          onClose={() => setConfirmation(null)}
        >
          <h2>{confirmation.redo ? "다시 실행" : "되돌리기"}</h2>
          <p>
            {confirmation.redo
              ? "되돌린 변경을 다시 적용합니다. 계속하시겠습니까?"
              : "최근 변경을 되돌립니다. 계속하시겠습니까?"}
          </p>
          <div className="records-dialog-actions">
            <Button
              type="button"
              autoFocus
              onClick={() => setConfirmation(null)}
            >
              취소
            </Button>
            <Button type="button" onClick={restoreHistory}>
              확인
            </Button>
          </div>
        </RecordsDialog>
      ) : null}
    </div>
  );

  function renderMenu() {
    if (!menu) return null;
    const post = posts.find((item) => item.id === menu.postId);
    const postCategory =
      post && nodes.find((node) => node.sources.includes(post.category));
    const entries = post
      ? [
          { label: "글 추가", action: () => write(postCategory?.id) },
          {
            label: "글 수정",
            disabled: !onEdit,
            action: () => {
              setMenu(null);
              onEdit?.(post);
            },
          },
          {
            label: "글 삭제",
            disabled: !onDelete,
            action: () => {
              setMenu(null);
              onDelete?.(post);
            },
          },
        ]
      : menuNode
        ? [
            { label: "글 추가", action: () => write(menuNode.id) },
            {
              label: "하위 카테고리 추가",
              action: () => edit("add", menuNode.id),
            },
            { label: "카테고리 이름 변경", action: () => edit("rename") },
            {
              label: "카테고리 삭제",
              disabled: deleteDisabled,
              action: () => edit("delete"),
            },
          ]
        : [
            { label: "카테고리 추가", action: () => edit("add") },
            { label: "글 추가", action: () => write() },
            ...(!menu.overview
              ? [
                  {
                    label: "태그 보기",
                    action: () => {
                      setView("tags");
                      setMenu(null);
                    },
                  },
                  {
                    label: "사이드바 보기",
                    action: () => {
                      setView("sidebar");
                      setMenu(null);
                    },
                  },
                  { label: "카테고리 전체 보기", action: openOverview },
                ]
              : []),
          ];
    return (
      <div
        className="records-menu-scrim"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setMenu(null);
        }}
      >
        <div
          role="menu"
          aria-label="기록 메뉴"
          className="records-context-menu"
          style={{
            left: Math.max(8, Math.min(menu.x, window.innerWidth - 252)),
            top: Math.max(
              8,
              Math.min(menu.y, window.innerHeight - entries.length * 42 - 16),
            ),
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              closeMenu();
            }
            if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
              event.preventDefault();
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  "button:not(:disabled)",
                ),
              ];
              const index = buttons.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              buttons[
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? buttons.length - 1
                    : (index +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        buttons.length) %
                      buttons.length
              ]?.focus();
            }
          }}
        >
          {entries.map((entry, index) => (
            <Button
              key={entry.label}
              type="button"
              role="menuitem"
              autoFocus={index === 0}
              disabled={entry.disabled}
              onClick={entry.action}
            >
              {entry.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }
}
