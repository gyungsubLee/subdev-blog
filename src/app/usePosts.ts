import { useEffect, useMemo, useState } from "react";
import { draftAssetUrl, draftDisplayMarkdown, readDrafts } from "../shared/drafts.mjs";
import { validatePublicCategories } from "../features/post-category/hierarchy";
import type { Post, PublicCategory } from "../shared/post";

export function usePosts(postId: string | undefined) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      fetch("/content/index.json", { signal: controller.signal }),
      fetch("/content/categories.json", { signal: controller.signal }),
    ])
      .then(async ([indexResponse, categoryResponse]) => {
        if (!indexResponse.ok || !categoryResponse.ok)
          throw new Error("보관한 글을 불러오지 못했습니다.");
        return Promise.all([indexResponse.json(), categoryResponse.json()]);
      })
      .then(([data, categoryData]) => {
        if (
          !Array.isArray(data) ||
          !data.every(
            (post) =>
              typeof post.id === "string" && typeof post.markdown === "string",
          )
        ) {
          throw new Error("글 파일 형식을 확인하십시오.");
        }
        if (!validatePublicCategories(categoryData)) {
          throw new Error("분류 파일 형식을 확인하십시오.");
        }
        setCategories(categoryData);
        setPosts(data);
        setLoaded(true);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") {
          setError(reason.message);
          setLoaded(true);
        }
      });
    try {
      setDrafts(readDrafts(localStorage));
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "초안을 읽지 못했습니다.",
      );
    }
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const id = postId;
    const post = posts.find((item) => item.id === id);
    if (!post || post.bodyLoaded !== false) return;
    const controller = new AbortController();
    fetch("/content/posts/" + encodeURIComponent(post.id) + ".json", {
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok)
          throw new Error(
            "글 본문을 불러오지 못했습니다. 페이지를 다시 여십시오.",
          );
        return response.json();
      })
      .then((article) => {
        if (article.id !== id || typeof article.markdown !== "string")
          throw new Error("글 본문 형식을 확인하십시오.");
        setPosts((current) =>
          current.map((item) =>
            item.id === id ? { ...article, bodyLoaded: true } : item,
          ),
        );
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, [postId, posts]);

  const displayedDrafts = useMemo(() => drafts.map((draft) => ({
    ...draft,
    markdown: draftDisplayMarkdown(draft),
    cover: draft.cover ? draftAssetUrl(draft, draft.cover) : draft.cover,
  })), [drafts]);
  return { posts, categories, drafts: displayedDrafts, error, loaded, setDrafts };
}
