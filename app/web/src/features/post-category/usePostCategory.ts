import { ALL_CATEGORIES } from "./config";
import { useState } from "react";
import type { Post } from "../../shared/post";

export function usePostCategory(posts: Post[]) {
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const categories = [
    ...new Set(posts.map((post) => post.category).filter(Boolean)),
  ];

  function matches(post: Post) {
    return category === ALL_CATEGORIES || post.category === category;
  }

  return { category, categories, setCategory, matches };
}
