import { useEffect, useMemo, useState } from "react";
import type { Post } from "../../shared/post";
import {
  createCategoryGroups,
  validateCategoryGroups,
  type CategoryCatalog,
  type CategoryGroup,
} from "./catalog";
import {
  categoryNodesToGroups,
  migrateCategoryGroups,
  reconcileCategoryNodes,
  validateCategoryNodes,
  UNCLASSIFIED_CATEGORY_ID,
  type CategoryNode,
} from "./hierarchy";

const STORAGE_KEY = "second-brain:categories:v2";
const LEGACY_STORAGE_KEY = "second-brain:categories:v1";

export function useCategoryCatalog(posts: Post[]): CategoryCatalog {
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw !== null) {
        const stored = JSON.parse(raw);
        if (stored?.version !== 2 || !validateCategoryNodes(stored.nodes))
          throw new Error("Invalid categories");
        return { nodes: stored.nodes as CategoryNode[], error: "" };
      }
      const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacyRaw === null)
        return {
          nodes: migrateCategoryGroups(createCategoryGroups(posts)),
          error: "",
        };
      const legacy = JSON.parse(legacyRaw);
      if (legacy?.version !== 1 || !validateCategoryGroups(legacy.groups))
        throw new Error("Invalid legacy categories");
      const nodes = migrateCategoryGroups(legacy.groups);
      if (!validateCategoryNodes(nodes))
        throw new Error("Invalid migrated categories");
      return { nodes, error: "" };
    } catch {
      return {
        nodes: migrateCategoryGroups(createCategoryGroups(posts)),
        error:
          "분류 설정을 읽지 못했습니다. 기존 저장 데이터를 확인하십시오. 저장은 중단했습니다.",
      };
    }
  });
  const [savedNodes, setSavedNodes] = useState<CategoryNode[]>(initial.nodes);
  const [error, setError] = useState(initial.error);
  const [draft, setDraft] = useState<{
    nodes: CategoryNode[] | null;
    history: CategoryNode[][];
  }>({ nodes: null, history: [] });
  const nodes = useMemo(
    () => reconcileCategoryNodes(savedNodes, posts),
    [savedNodes, posts],
  );
  const draftNodes = useMemo(
    () =>
      draft.nodes === null ? nodes : reconcileCategoryNodes(draft.nodes, posts),
    [draft.nodes, nodes, posts],
  );
  const groups = useMemo(() => categoryNodesToGroups(nodes), [nodes]);
  const originalOwners = useMemo(
    () =>
      new Map(
        reconcileCategoryNodes(initial.nodes, posts).flatMap((node) =>
          node.sources.map((source) => [source, node.id] as const),
        ),
      ),
    [initial.nodes, posts],
  );
  const dirty = JSON.stringify(draftNodes) !== JSON.stringify(nodes);

  useEffect(() => {
    if (!dirty) return;
    function confirmClose(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", confirmClose);
    return () => window.removeEventListener("beforeunload", confirmClose);
  }, [dirty]);

  function stage(next: CategoryNode[]) {
    setDraft((previous) => ({
      nodes: next,
      history: [...previous.history, draftNodes],
    }));
  }

  function undo() {
    setDraft((previous) =>
      previous.history.length
        ? {
            nodes: previous.history.at(-1)!,
            history: previous.history.slice(0, -1),
          }
        : previous,
    );
  }

  function saveNodes(next: CategoryNode[]) {
    if (initial.error) return false;
    if (!validateCategoryNodes(next)) {
      setError(
        "분류 이름이나 저장 형식을 확인하십시오. 중복 이름은 사용할 수 없습니다.",
      );
      return false;
    }
    const previousOwners = new Map(
      nodes.flatMap((node) =>
        node.sources.map((source) => [source, node.id] as const),
      ),
    );
    const nextOwners = new Map(
      next.flatMap((node) =>
        node.sources.map((source) => [source, node.id] as const),
      ),
    );
    const sourcesChanged =
      previousOwners.size !== nextOwners.size ||
      [...previousOwners].some(([source, owner]) => {
        const destination = nextOwners.get(source);
        if (destination === owner) return false;
        if (
          destination === UNCLASSIFIED_CATEGORY_ID &&
          !next.some((node) => node.id === owner)
        )
          return false;
        // Undo may restore a saved deletion, but cannot invent a source assignment.
        return (
          owner !== UNCLASSIFIED_CATEGORY_ID ||
          destination !== originalOwners.get(source)
        );
      });
    if (sourcesChanged) {
      setError("원문 분류는 변경할 수 없습니다.");
      return false;
    }
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ version: 2, nodes: next }),
      );
    } catch {
      setError(
        "분류 설정을 저장하지 못했습니다. 브라우저 저장 공간과 권한을 확인하십시오.",
      );
      return false;
    }
    setSavedNodes(next);
    setDraft((previous) => ({ ...previous, nodes: next }));
    setError("");
    return true;
  }

  function save(nextGroups: CategoryGroup[]) {
    if (!validateCategoryGroups(nextGroups)) return false;
    return saveNodes(migrateCategoryGroups(nextGroups));
  }

  return {
    groups,
    nodes,
    draftNodes,
    stage,
    undo,
    canUndo: draft.history.length > 0,
    dirty,
    error,
    save,
    saveNodes,
  };
}
