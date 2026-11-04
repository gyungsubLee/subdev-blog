import { useState } from "react";
import type { Post } from "../../shared/post";
import { usePostPagination } from "../post-pagination/usePostPagination";
import { usePostSearch } from "../post-search/usePostSearch";
import type { CategoryGroup } from "./catalog";
import { categoryMatches } from "./hierarchy";

export function useRecordsBrowser(
  posts: Post[],
  groups: CategoryGroup[],
  enabled: boolean,
) {
  const search = usePostSearch(enabled);
  const pagination = usePostPagination();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const group = groups.find(item => item.id === selectedId) ?? groups.find(item =>
    item.categories.some(category => category.id === selectedId),
  );
  const category = group?.id === selectedId ? undefined : group?.categories.find(
    item => item.id === selectedId,
  );
  const filteredPosts = posts.filter((post) => {
    const matchesCategory = category
      ? categoryMatches(category, post.category)
      : !group || group.categories.some((item) => categoryMatches(item, post.category));
    return matchesCategory && search.matches(post);
  });

  function setQuery(query: string) {
    search.setQuery(query);
    pagination.reset();
  }

  function selectGroup(id: string | null) {
    setSelectedId(id);
    pagination.reset();
  }

  function selectCategory(id: string) {
    // Resolve on render so a move or undo can select an ID before new groups arrive.
    setSelectedId(id);
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
    limit: pagination.limit,
    showMore: pagination.showMore,
    resetFilters,
    filteredPosts,
  };
}
