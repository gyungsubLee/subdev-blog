import type { Post } from "../../shared/post";

import type { CategoryNode } from "./hierarchy";

export type CategoryItem = {
  id: string;
  source: string;
  name: string;
  sources?: string[];
  descendantSources?: string[];
  depth?: number;
};
export type CategoryGroup = { id: string; name: string; categories: CategoryItem[] };
export type CategoryCatalog = {
  groups: CategoryGroup[];
  nodes: CategoryNode[];
  saveNodes: (nodes: CategoryNode[]) => boolean;
  draftNodes: CategoryNode[];
  stage: (nodes: CategoryNode[]) => void;
  undo: () => void;
  canUndo: boolean;
  dirty: boolean;
  error: string;
  save: (groups: CategoryGroup[]) => boolean;
};

const INITIAL_GROUPS = [
  {
    id: "group:cs",
    name: "CS",
    sources: [
      "수학",
      "구조적인 문제 해결을 위한 컴퓨터공학",
      "논리적 문제 해결을 위한 컴퓨터과학",
      "네트워크(입문)",
      "디자인패턴",
      "알고리즘",
      "자료구조",
      "기술 면접 준비",
    ],
  },
  {
    id: "group:backend",
    name: "백엔드",
    sources: [
      "Spring ( Java )",
      "Nest.js",
      "Golang",
      "Python",
      "DBMS",
      "Redis",
      "ElasticSearch",
      "테스트코드",
      "대규모 시스템 설계",
    ],
  },
  {
    id: "group:frontend",
    name: "프론트엔드",
    sources: [
      "리액트",
      "Next.js",
      "HTML, CSS",
      "Javascript",
      "Typescript",
    ],
  },
  {
    id: "group:infra",
    name: "인프라",
    sources: [
      "Docker",
      "Kubernetes",
      "Nginx",
      "CI/CD",
      "베포 ( AWS )",
      "Git",
      "모니터링",
    ],
  },
  {
    id: "group:ai-data",
    name: "AI·데이터",
    sources: [
      "Model",
      "Agent",
      "강화학습",
      "데이터 분석",
      "온톨로지",
      "클로드코드",
      "n8n",
    ],
  },
  {
    id: "group:learning-tools",
    name: "학습·도구",
    sources: [
      "내일 배움 캠프 ( 백엔드 코스 7기)",
      "Tool",
      "History",
    ],
  },
];
const UNCLASSIFIED_ID = "group:unclassified";

export function createCategoryGroups(posts: Pick<Post, "category">[]): CategoryGroup[] {
  const groups = INITIAL_GROUPS.map(({ id, name, sources }) => ({
    id,
    name,
    categories: sources.map((source) => ({ id: "source:" + source, source, name: source })),
  }));
  groups.push({ id: UNCLASSIFIED_ID, name: "미분류", categories: [] });
  return reconcileCategoryGroups(groups, posts);
}

export function reconcileCategoryGroups(
  groups: CategoryGroup[],
  posts: Pick<Post, "category">[],
): CategoryGroup[] {
  const sources = new Set(groups.flatMap((group) => group.categories.map((item) => item.source)));
  const missing = [...new Set(posts.map((post) => post.category))].filter((source) => !sources.has(source));
  if (!missing.length) return groups;

  const names = new Set(groups.flatMap((group) =>
    group.categories.map((item) => item.name.toLocaleLowerCase())));
  const unknown = missing.map((source) => {
    const baseName = normalizeCategoryName(source).slice(0, 100).trimEnd() || "이름 없는 분류";
    let name = baseName;
    let number = 2;
    while (names.has(name.toLocaleLowerCase())) {
      const suffix = ` (${number++})`;
      name = baseName.slice(0, 100 - suffix.length).trimEnd() + suffix;
    }
    names.add(name.toLocaleLowerCase());
    return { id: "source:" + source, source, name };
  });
  const unclassified = groups.find((group) => group.id === UNCLASSIFIED_ID);
  if (!unclassified) {
    return [...groups, { id: UNCLASSIFIED_ID, name: "미분류", categories: unknown }];
  }
  return groups.map((group) => group.id === UNCLASSIFIED_ID
    ? { ...group, categories: [...group.categories, ...unknown] }
    : group);
}

export function normalizeCategoryName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

// Validate browser storage as untrusted input before exposing it to navigation.
export function validateCategoryGroups(value: unknown): value is CategoryGroup[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  const sources = new Set<string>();
  const names = new Set<string>();
  function validId(id: unknown): id is string {
    if (typeof id !== "string" || !id.trim() || ids.has(id)) return false;
    ids.add(id);
    return true;
  }
  function validName(name: unknown): name is string {
    return typeof name === "string" && name.length <= 100
      && name.length > 0 && normalizeCategoryName(name) === name;
  }
  for (const group of value) {
    if (!group || !validId(group.id) || !validName(group.name) || !Array.isArray(group.categories)) return false;
    for (const item of group.categories) {
      if (!item || !validId(item.id) || typeof item.source !== "string"
        || sources.has(item.source) || !validName(item.name)) return false;
      const name = item.name.toLocaleLowerCase();
      if (names.has(name)) return false;
      names.add(name);
      sources.add(item.source);
    }
  }
  return true;
}
