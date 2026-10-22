import { useMemo, useState } from "react";
import type { Post } from "../../shared/post";
import {
  createCategoryGroups,
  reconcileCategoryGroups,
  validateCategoryGroups,
  type CategoryCatalog,
  type CategoryGroup,
} from "./catalog";

const STORAGE_KEY = "second-brain:categories:v1";

export function useCategoryCatalog(posts: Post[]): CategoryCatalog {
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) return { groups: createCategoryGroups(posts), error: "" };
      const stored = JSON.parse(raw);
      if (stored?.version !== 1 || !validateCategoryGroups(stored.groups)) {
        throw new Error("Invalid category settings");
      }
      return { groups: stored.groups, error: "" };
    } catch {
      return {
        groups: createCategoryGroups(posts),
        error: "분류 설정을 읽지 못했습니다. 기존 저장 데이터를 확인하십시오. 저장은 중단했습니다.",
      };
    }
  });
  const [savedGroups, setSavedGroups] = useState<CategoryGroup[]>(initial.groups);
  const [error, setError] = useState(initial.error);
  const groups = useMemo(() => reconcileCategoryGroups(savedGroups, posts), [savedGroups, posts]);

  function save(nextGroups: CategoryGroup[]) {
    if (initial.error) return false;
    if (!validateCategoryGroups(nextGroups)) {
      setError("분류 이름이나 저장 형식을 확인하십시오. 중복 이름은 사용할 수 없습니다.");
      return false;
    }
    const previousSources = new Map(groups.flatMap((group) => group.categories.map((item) => [item.id, item.source] as const)));
    const changedSource = nextGroups.some((group) => group.categories.some((item) =>
      previousSources.has(item.id) && previousSources.get(item.id) !== item.source));
    if (changedSource) {
      setError("원문 분류는 변경할 수 없습니다.");
      return false;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, groups: nextGroups }));
    } catch {
      setError("분류 설정을 저장하지 못했습니다. 브라우저 저장 공간과 권한을 확인하십시오.");
      return false;
    }
    setSavedGroups(nextGroups);
    setError("");
    return true;
  }

  return { groups, error, save };
}
