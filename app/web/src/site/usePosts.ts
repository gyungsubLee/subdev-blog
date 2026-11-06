import { useCallback, useEffect, useRef, useState } from "react";
import { readDrafts } from "../shared/drafts.mjs";
import { validatePublicCategories } from "../features/post-category/hierarchy";
import { SYNC_EVENT, overlayContent } from "../features/content-management/background-sync.mjs";
import { readPublicCache, writePublicCache } from "./public-cache";
import type { Post, PublicCategory } from "../shared/post";

let checkedIndex = false;

export function usePosts(postId: string | undefined) {
  const [{ posts, categories, contentCommit, sourceCommit }, setContent] = useState<{
    posts: Post[];
    categories: PublicCategory[];
    contentCommit: string;
    sourceCommit?: string;
  }>({ posts: [], categories: [], contentCommit: "" });
  const [request, setRequest] = useState({ generation: 0, afterCommit: "" });
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const refreshingIndex = useRef<{ contentCommit: string; signal: AbortSignal } | null>(null);
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
    const cachePath = "/api/public?kind=index";
    const load = async () => {
      const cached = await readPublicCache(cachePath) as { posts?: Post[]; categories?: PublicCategory[]; contentCommit?: string } | null;
      if (cached && Array.isArray(cached.posts) && cached.posts.every(post => post && typeof post.id === "string" && typeof post.markdown === "string") &&
          typeof cached.contentCommit === "string" && /^[a-f0-9]{40}$/.test(cached.contentCommit) && validatePublicCategories(cached.categories)) {
        if (active) {
          const content = await overlayContent(cached) as { posts: Post[]; categories: PublicCategory[]; contentCommit: string };
          if (!active) return null;
          setContent(content);
          setLoaded(true);
        }
        if (checkedIndex && request.generation === 0 && !request.afterCommit) return null;
      }
      if (!active) return null;
      return fetch("/api/public?" + params, { signal: controller.signal });
    };
    load().then(async (response) => {
        if (!response) return null;
        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string" ? data.error : "보관한 글을 불러오지 못했습니다.",
          );
        }
        return data;
      })
      .then(async (data) => {
        if (data === null) return;
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
          const pending = { contentCommit: data.contentCommit, signal: controller.signal };
          refreshingIndex.current = pending;
          try {
            const content = await overlayContent(data, { revalidate: true, signal: controller.signal });
            if (!active) return;
            checkedIndex = true;
            setContent(content);
            setLoaded(true);
            await writePublicCache(cachePath, data);
          } finally {
            if (refreshingIndex.current === pending) refreshingIndex.current = null;
          }
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
      if (refreshingIndex.current?.signal === controller.signal) refreshingIndex.current = null;
    };
  }, [request]);

  useEffect(() => {
    try {
      setDrafts(readDrafts(localStorage));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "초안을 읽지 못했습니다.");
    }
  }, [request]);

  useEffect(() => {
    let active = true;
    async function localChange(event: Event) {
      const detail = (event as CustomEvent).detail;
      if(detail?.state==='publication'&&detail.result?.state==='published') {
        if (refreshingIndex.current?.contentCommit &&
            refreshingIndex.current.contentCommit === detail.result.publicCommit) return;
        reload(detail.result.publicCommit);
        return;
      }
      const cached = await readPublicCache("/api/public?kind=index") as {posts:Post[];categories:PublicCategory[];contentCommit:string} | null;
      if (active && cached && Array.isArray(cached.posts) && validatePublicCategories(cached.categories)) {
        const content = await overlayContent(cached);
        if (!active) return;
        setContent(content);
        setLoaded(true);
      }
      if (active && detail?.error) setError(detail.error.message);
    }
    window.addEventListener(SYNC_EVENT, localChange);
    return () => {active=false;window.removeEventListener(SYNC_EVENT,localChange);};
  }, [reload]);

  useEffect(() => {
    const id = postId;
    const post = posts.find((item) => item.id === id);
    if (!post || post.bodyLoaded !== false) return;
    const controller = new AbortController();
    let active = true;
    const params = new URLSearchParams({
      kind: "post", id: post.id, commit: contentCommit,
    });
    const cachePath = "/api/public?" + params;
    const load = async () => {
      const cached = await readPublicCache(cachePath) as Post | null;
      if (cached && cached.id === id && typeof cached.markdown === "string") return cached;
      const response = await fetch(cachePath, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(
            typeof data?.error === "string"
              ? data.error
              : "글 본문을 불러오지 못했습니다. 페이지를 다시 여십시오.",
          );
        }
        return data;
    };
    load().then(async (article) => {
        if (article?.id !== id || typeof article.markdown !== "string") {
          throw new Error("글 본문 형식을 확인하십시오.");
        }
        if (!active) return;
        await writePublicCache(cachePath, article);
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

  return { posts, categories, contentCommit, sourceCommit:sourceCommit??contentCommit, drafts, error, loaded, setDrafts, reload };
}
