import { useMemo, useState } from "react";
import type { CategoryCatalog } from "./catalog";
import { normalizeCategoryName } from "./catalog";
import {
  categoryNodesToGroups,
  MAX_CATEGORIES,
  mergeCanonicalCategories,
  UNCLASSIFIED_CATEGORY_ID,
  validatePublicCategories,
  type CategoryNode,
} from "./hierarchy";

const KEY = "second-brain:records-categories:v1";
type Saved = { nodes: CategoryNode[]; baseNodes: CategoryNode[] };
function validNodes(value: unknown): value is CategoryNode[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_CATEGORIES &&
    validatePublicCategories(
      value.map((node) => node && { ...node, order: 0 }),
    ) &&
    value.every(
      (node) =>
        node.name.length > 0 &&
        node.name.length <= 100 &&
        normalizeCategoryName(node.name) === node.name,
    )
  );
}

// Browsing customizations never publish or overwrite the canonical content catalog.
export function useRecordsCatalog(base: CategoryCatalog): CategoryCatalog {
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return { saved: null, error: "" };
      const parsed = JSON.parse(raw);
      if (
        parsed.version !== 1 ||
        !validNodes(parsed.nodes) ||
        !validNodes(parsed.baseNodes)
      )
        throw Error("Invalid records categories");
      return {
        saved: { nodes: parsed.nodes, baseNodes: parsed.baseNodes } as Saved,
        error: "",
      };
    } catch {
      return {
        saved: null,
        error:
          "분류 설정을 읽지 못했습니다. 기존 저장 데이터를 유지하며 저장을 중단했습니다.",
      };
    }
  });
  const [saved, setSaved] = useState<Saved | null>(initial.saved);
  const [error, setError] = useState(initial.error);
  const nodes = useMemo(() => {
    if (!saved) return base.nodes;
    const previousIds = new Set(saved.baseNodes.map((node) => node.id));
    const localIds = new Set(saved.nodes.map((node) => node.id));
    const incoming = base.nodes.filter(
      (node) => !previousIds.has(node.id) || localIds.has(node.id),
    );
    const merged = mergeCanonicalCategories(
      saved.nodes,
      incoming.map((node, order) => ({ ...node, order })),
    );
    const knownSources = new Set(
      [...saved.nodes, ...base.nodes].flatMap((node) => node.sources),
    );
    const originalNames = new Map(
      saved.baseNodes.map((node) => [node.id, node.name]),
    );
    const currentNames = new Map(
      base.nodes.map((node) => [node.id, node.name]),
    );
    return merged.map((node) => ({
      ...node,
      sources: node.sources.filter((source) => knownSources.has(source)),
      name:
        originalNames.get(node.id) === node.name && currentNames.has(node.id)
          ? currentNames.get(node.id)!
          : node.name,
    }));
  }, [saved, base.nodes]);
  const groups = useMemo(() => categoryNodesToGroups(nodes), [nodes]);

  function saveNodes(next: CategoryNode[]) {
    if (initial.error) return false;
    if (!validNodes(next)) {
      setError("분류 이름이나 저장 형식을 확인하십시오.");
      return false;
    }
    const owners = new Map(
      nodes.flatMap((node) =>
        node.sources.map((source) => [source, node.id] as const),
      ),
    );
    const nextOwners = new Map(
      next.flatMap((node) =>
        node.sources.map((source) => [source, node.id] as const),
      ),
    );
    const originalOwners = new Map(
      base.nodes.flatMap((node) =>
        node.sources.map((source) => [source, node.id] as const),
      ),
    );
    if (
      owners.size !== nextOwners.size ||
      [...owners].some(([source, owner]) => {
        const destination = nextOwners.get(source);
        return (
          destination !== owner &&
          !(
            destination === UNCLASSIFIED_CATEGORY_ID &&
            !next.some((node) => node.id === owner)
          ) &&
          !(
            owner === UNCLASSIFIED_CATEGORY_ID &&
            destination === originalOwners.get(source)
          )
        );
      })
    ) {
      setError("원문 분류는 변경할 수 없습니다.");
      return false;
    }
    const value = { nodes: next, baseNodes: base.nodes };
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ version: 1, ...value }),
      );
    } catch {
      setError(
        "분류 설정을 저장하지 못했습니다. 브라우저 저장 공간과 권한을 확인하십시오.",
      );
      return false;
    }
    setSaved(value);
    setError("");
    return true;
  }
  return { ...base, nodes, groups, saveNodes, error };
}
