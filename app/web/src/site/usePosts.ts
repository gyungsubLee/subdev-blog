import { useCallback, useEffect, useState } from "react";
import { readDrafts } from "../shared/drafts.mjs";
import { validatePublicCategories } from "../features/post-category/hierarchy";
import type { Post, PublicCategory } from "../shared/post";

export function usePosts(postId: string | undefined) {
  const [{ posts, categories, contentCommit }, setContent] = useState<{
    posts: Post[];
    categories: PublicCategory[];
    contentCommit: string;
  }>({ posts: [], categories: [], contentCommit: "" });
  const [request, setRequest] = useState({ generation: 0, afterCommit: "" });
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback((afterCommit?: string) => {
    setRequest((current) => ({
      generation: current.generation + 1,
      afterCommit: afterCommit ?? "",
    }));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams({ kind: "index" });
    if (request.afterCommit) params.set("after", request.afterCommit);
    setError("");
    fetch("/api/public?" + params, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "보관한 글을 불러오지 못했습니다.",
          );
        }
        return data;
      })
      .then((data) => {
        if (
          !Array.isArray(data?.posts) ||
          !data.posts.every((post: Post) =>
            post && typeof post.id === "string" && typeof post.markdown === "string",
          ) ||
          typeof data.contentCommit !== "string" ||
          !/^[a-f0-9]{40}$/.test(data.contentCommit)
        ) {
          throw new Error("글 파일 형식을 확인하십시오.");
        }
        if (!validatePublicCategories(data.categories)) {
          throw new Error("분류 파일 형식을 확인하십시오.");
        }
        if (active) {
          setContent(data);
          setLoaded(true);
        }
      })
      .catch((reason) => {
        if (active && reason.name !== "AbortError") {
          setError(reason.message);
          setLoaded(true);
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [request]);

  useEffect(() => {
    try {
      setDrafts(readDrafts(localStorage));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "초안을 읽지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const id = postId;
    const post = posts.find((item) => item.id === id);
    if (!post || post.bodyLoaded !== false) return;
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams({
      kind: "post", id: post.id, commit: contentCommit,
    });
    fetch("/api/public?" + params, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "글 본문을 불러오지 못했습니다. 페이지를 다시 여십시오.",
          );
        }
        return data;
      })
      .then((article) => {
        if (article?.id !== id || typeof article.markdown !== "string") {
          throw new Error("글 본문 형식을 확인하십시오.");
        }
        if (!active) return;
        setContent((current) => {
          if (current.contentCommit !== contentCommit) return current;
          return {
            ...current,
            posts: current.posts.map((item) =>
              item.id === id ? { ...article, bodyLoaded: true } : item,
            ),
          };
        });
      })
      .catch((reason) => {
        if (active && reason.name !== "AbortError") setError(reason.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [postId, posts, contentCommit]);

  return { posts, categories, drafts, error, loaded, setDrafts, reload };
}
