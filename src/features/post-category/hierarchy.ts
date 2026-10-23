import type { Post, PublicCategory } from "../../shared/post";
import {
  normalizeCategoryName,
  type CategoryGroup,
  type CategoryItem,
} from "./catalog";

export type CategoryNode = {
  id: string;
  name: string;
  parentId: string | null;
  sources: string[];
};
export const UNCLASSIFIED_CATEGORY_ID = "group:unclassified";
export const MAX_CATEGORIES = 500;

// Keep personal aliases and placement; attach canonical IDs to their existing source owner.
export function mergeCanonicalCategories(
  nodes: CategoryNode[],
  categories: PublicCategory[],
): CategoryNode[] {
  const next = nodes.map((node) => ({ ...node, sources: [...node.sources] }));
  const owners = new Map(
    next.flatMap((node) =>
      node.sources.map((source) => [source, node] as const),
    ),
  );
  const names = new Set(next.map((node) => node.name.toLocaleLowerCase()));
  const canonicalOwners = new Map<string, string>();
  const added = new Set<string>();
  for (const category of categories) {
    const sources = [...new Set([...category.sources, category.id])];
    let owner =
      next.find((node) => node.id === category.id) ??
      owners.get(category.id) ??
      sources.map((source) => owners.get(source)).find(Boolean);
    if (!owner) {
      let name = category.name;
      for (let number = 2; names.has(name.toLocaleLowerCase()); number++) {
        const suffix = ` (${number})`;
        name = category.name.slice(0, 100 - suffix.length).trimEnd() + suffix;
      }
      owner = { id: category.id, name, parentId: category.parentId, sources: [] };
      next.push(owner);
      names.add(name.toLocaleLowerCase());
      added.add(owner.id);
    }
    canonicalOwners.set(category.id, owner.id);
    for (const source of sources) {
      if (owners.has(source)) continue;
      owner.sources.push(source);
      owners.set(source, owner);
    }
  }
  for (const node of next) {
    if (added.has(node.id) && node.parentId !== null) {
      const parentId = canonicalOwners.get(node.parentId) ?? node.parentId;
      // A personal merge can put parent and child sources in the same node.
      node.parentId = parentId === node.id ? null : parentId;
    }
  }
  return next;
}

export function migrateCategoryGroups(groups: CategoryGroup[]): CategoryNode[] {
  const nodes = groups.flatMap((group) => [
    { id: group.id, name: group.name, parentId: null, sources: [] },
    ...group.categories.map((item) => ({
      id: item.id,
      name: item.name,
      parentId: group.id,
      sources: [item.source],
    })),
  ]);
  // V1 allowed a group and a category to share a name; preserve their IDs and sources.
  const reserved = new Set(nodes.map((node) => node.name.toLocaleLowerCase()));
  const seen = new Set<string>();
  return nodes.map((node) => {
    let name = node.name;
    if (seen.has(name.toLocaleLowerCase())) {
      for (let number = 2; ; number++) {
        const suffix = ` (${number})`;
        name = node.name.slice(0, 100 - suffix.length).trimEnd() + suffix;
        if (!reserved.has(name.toLocaleLowerCase())) break;
      }
      reserved.add(name.toLocaleLowerCase());
    }
    seen.add(name.toLocaleLowerCase());
    return name === node.name ? node : { ...node, name };
  });
}

export function categoryDescendants(
  nodes: CategoryNode[],
  id: string,
): Set<string> {
  const result = new Set([id]);
  for (let size = 0; size !== result.size;) {
    size = result.size;
    for (const node of nodes)
      if (node.parentId !== null && result.has(node.parentId))
        result.add(node.id);
  }
  return result;
}

function validateCategoryHierarchy(value: unknown): value is CategoryNode[] {
  if (!Array.isArray(value)) return false;
  const nodes = new Map<string, CategoryNode>();
  const sources = new Set<string>();
  for (const node of value) {
    if (
      !node ||
      typeof node.id !== "string" ||
      !node.id.trim() ||
      nodes.has(node.id) ||
      typeof node.name !== "string" ||
      (node.parentId !== null && typeof node.parentId !== "string") ||
      !Array.isArray(node.sources)
    )
      return false;
    for (const source of node.sources) {
      if (typeof source !== "string" || sources.has(source)) return false;
      sources.add(source);
    }
    nodes.set(node.id, node);
  }
  for (const node of value) {
    const ancestors = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId !== null) {
      const parent = nodes.get(parentId);
      if (!parent || ancestors.has(parentId)) return false;
      ancestors.add(parentId);
      parentId = parent.parentId;
    }
  }
  return true;
}

export function validateCategoryNodes(value: unknown): value is CategoryNode[] {
  if (!validateCategoryHierarchy(value)) return false;
  const names = new Set<string>();
  for (const node of value) {
    const name = node.name.toLocaleLowerCase();
    if (
      !node.name.length || node.name.length > 100 ||
      normalizeCategoryName(node.name) !== node.name || names.has(name)
    ) return false;
    names.add(name);
  }
  return true;
}

export function validatePublicCategories(value: unknown): value is PublicCategory[] {
  return validateCategoryHierarchy(value) && value.every(
    (category) => "order" in category && typeof category.order === "number" &&
      Number.isSafeInteger(category.order) && category.order >= 0,
  );
}

export function moveCategoryNode(
  nodes: CategoryNode[],
  id: string,
  parentId: string | null,
  beforeId: string | null = null,
): CategoryNode[] {
  const node = nodes.find((item) => item.id === id);
  if (
    !node ||
    (parentId !== null && !nodes.some((item) => item.id === parentId))
  ) {
    throw new Error("이동할 분류를 찾지 못했습니다.");
  }
  if (parentId !== null && categoryDescendants(nodes, id).has(parentId)) {
    throw new Error("자신이나 하위 분류 아래로 이동할 수 없습니다.");
  }
  if (beforeId === id) return nodes;
  const next = nodes.filter((item) => item.id !== id);
  const index =
    beforeId === null
      ? next.length
      : next.findIndex(
          (item) => item.id === beforeId && item.parentId === parentId,
        );
  if (index < 0) throw new Error("이동 위치를 찾지 못했습니다.");
  next.splice(index, 0, { ...node, parentId });
  return next;
}

export function removeCategoryNode(
  nodes: CategoryNode[],
  id: string,
): CategoryNode[] {
  const node = nodes.find((item) => item.id === id);
  if (!node || id === UNCLASSIFIED_CATEGORY_ID)
    throw new Error("이 분류는 삭제할 수 없습니다.");
  const next = nodes
    .filter((item) => item.id !== id)
    .map((item) => ({
      ...item,
      parentId: item.parentId === id ? node.parentId : item.parentId,
    }));
  if (!node.sources.length) return next;
  const unclassified = next.find(
    (item) => item.id === UNCLASSIFIED_CATEGORY_ID,
  );
  if (unclassified) {
    return next.map((item) =>
      item.id === unclassified.id
        ? { ...item, sources: [...item.sources, ...node.sources] }
        : item,
    );
  }
  const names = new Set(next.map((item) => item.name.toLocaleLowerCase()));
  let name = "미분류";
  for (let number = 2; names.has(name.toLocaleLowerCase()); number++)
    name = `미분류 (${number})`;
  return [
    ...next,
    {
      id: UNCLASSIFIED_CATEGORY_ID,
      name,
      parentId: null,
      sources: [...node.sources],
    },
  ];
}

export function reconcileCategoryNodes(
  nodes: CategoryNode[],
  posts: Pick<Post, "category">[],
): CategoryNode[] {
  const sources = new Set(nodes.flatMap((node) => node.sources));
  const missing = [...new Set(posts.map((post) => post.category))].filter(
    (source) => !sources.has(source),
  );
  if (!missing.length) return nodes;
  const next = [...nodes];
  const names = new Set(nodes.map((node) => node.name.toLocaleLowerCase()));
  if (!next.some((node) => node.id === UNCLASSIFIED_CATEGORY_ID)) {
    let name = "미분류";
    for (let number = 2; names.has(name.toLocaleLowerCase()); number++)
      name = `미분류 (${number})`;
    next.push({
      id: UNCLASSIFIED_CATEGORY_ID,
      name,
      parentId: null,
      sources: [],
    });
    names.add(name.toLocaleLowerCase());
  }
  const ids = new Set(next.map((node) => node.id));
  for (const source of missing) {
    const baseName =
      normalizeCategoryName(source).slice(0, 100).trimEnd() || "이름 없는 분류";
    let name = baseName;
    for (let number = 2; names.has(name.toLocaleLowerCase()); number++) {
      const suffix = ` (${number})`;
      name = baseName.slice(0, 100 - suffix.length).trimEnd() + suffix;
    }
    let id = "source:" + source;
    for (let number = 2; ids.has(id); number++)
      id = `source:${source}:${number}`;
    next.push({
      id,
      name,
      parentId: UNCLASSIFIED_CATEGORY_ID,
      sources: [source],
    });
    names.add(name.toLocaleLowerCase());
    ids.add(id);
  }
  return next;
}

export function categoryMatches(
  category: CategoryItem,
  source: string,
): boolean {
  return (
    category.descendantSources ??
    category.sources ?? [category.source]
  ).includes(source);
}

// Records retain their existing three views; each root exposes its ordered descendants.
export function categoryNodesToGroups(nodes: CategoryNode[]): CategoryGroup[] {
  function item(node: CategoryNode, depth: number): CategoryItem {
    const branch = categoryDescendants(nodes, node.id);
    return {
      id: node.id,
      name: node.name,
      source: node.sources[0] ?? node.name,
      sources: node.sources,
      depth,
      descendantSources: nodes
        .filter((current) => branch.has(current.id))
        .flatMap((current) => current.sources),
    };
  }
  function children(parentId: string, depth = 0): CategoryItem[] {
    return nodes
      .filter((node) => node.parentId === parentId)
      .flatMap((node) => [item(node, depth), ...children(node.id, depth + 1)]);
  }
  return nodes
    .filter((node) => node.parentId === null)
    .map((root) => ({
      id: root.id,
      name: root.name,
      categories: [
        ...(root.sources.length ? [item(root, 0)] : []),
        ...children(root.id),
      ],
    }));
}

export type CategoryDrop = {
  parentId: string | null;
  beforeId: string | null;
  position: "before" | "after" | "inside";
  depth: number;
};

export function projectCategoryDrop(
  nodes: CategoryNode[],
  sourceId: string,
  targetId: string,
  side: "before" | "after",
  requestedDepth: number,
): CategoryDrop | null {
  if (categoryDescendants(nodes, sourceId).has(targetId)) return null;
  const ancestors: CategoryNode[] = [];
  let target = nodes.find((node) => node.id === targetId);
  if (!target) return null;
  while (target) {
    ancestors.unshift(target);
    target = nodes.find((node) => node.id === target!.parentId);
  }
  const depth = Math.max(0, Math.min(ancestors.length, requestedDepth));
  if (depth === ancestors.length)
    return { parentId: targetId, beforeId: null, position: "inside", depth };
  const anchor = ancestors[depth];
  const siblings = nodes.filter(
    (node) => node.parentId === anchor.parentId && node.id !== sourceId,
  );
  const index = siblings.findIndex((node) => node.id === anchor.id);
  return {
    parentId: anchor.parentId,
    beforeId: side === "before" ? anchor.id : (siblings[index + 1]?.id ?? null),
    position: side,
    depth,
  };
}
