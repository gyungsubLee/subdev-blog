import { useState } from "react";
import type { Post } from "../../shared/post";
import { usePostPagination } from "../post-pagination/usePostPagination";
import { usePostSearch } from "../post-search/usePostSearch";
import type { CategoryGroup } from "./catalog";

export type RecordsView = "sidebar" | "tabs" | "sections";

export function useRecordsBrowser(
  posts: Post[],
  groups: CategoryGroup[],
  enabled: boolean,
) {
  const search = usePostSearch(enabled);
  const pagination = usePostPagination();
  const [view, setView] = useState<RecordsView>("sidebar");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const categoryGroup = groups.find((group) =>
    group.categories.some((category) => category.id === selectedCategoryId),
  );
  const group = categoryGroup ?? groups.find((item) => item.id === selectedGroupId);
  const category = categoryGroup?.categories.find(
    (item) => item.id === selectedCategoryId,
  );
  const filteredPosts = posts.filter((post) => {
    const matchesCategory = category
      ? post.category === category.source
      : !group || group.categories.some((item) => item.source === post.category);
    return matchesCategory && search.matches(post);
  });

  function setQuery(query: string) {
    search.setQuery(query);
    pagination.reset();
  }

  function selectGroup(id: string | null) {
    setSelectedGroupId(id);
    setSelectedCategoryId(null);
    pagination.reset();
  }

  function selectCategory(id: string) {
    const owner = groups.find((item) =>
      item.categories.some((category) => category.id === id),
    );
    setSelectedGroupId(owner?.id ?? null);
    setSelectedCategoryId(owner ? id : null);
    pagination.reset();
  }

  function resetFilters() {
    search.setQuery("");
    selectGroup(null);
  }

  return {
    query: search.query,
    inputRef: search.inputRef,
    setQuery,
    clearQuery: () => search.setQuery(""),
    groupId: group?.id ?? null,
    categoryId: category?.id ?? null,
    selectGroup,
    selectCategory,
    view,
    setView,
    limit: pagination.limit,
    showMore: pagination.showMore,
    resetFilters,
    filteredPosts,
  };
}
