import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import Blog from "./Blog";
import { readDrafts } from "./drafts.mjs";
import type { Post } from "./types";

const Editor = lazy(() => import("./Editor"));

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error) {
      return (
        <main className="app-state">
          <h1>화면을 열지 못했습니다.</h1>
          <p>{this.state.error}</p>
          <a href="/">다시 열기</a>
        </main>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [drafts, setDrafts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [route, setRoute] = useState(window.location.hash);
  const [editing, setEditing] = useState<Post | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/content/index.json", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("보관한 글을 불러오지 못했습니다.");
        return response.json();
      })
      .then((data) => {
        if (
          !Array.isArray(data) ||
          !data.every(
            (post) =>
              typeof post.id === "string" && typeof post.markdown === "string",
          )
        ) {
          throw new Error("글 파일 형식을 확인하십시오.");
        }
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
    const close = () => {
      setRoute(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);

  useEffect(() => {
    const id = route.match(/^#\/post\/([^/?#]+)/)?.[1];
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
  }, [route, posts]);

  function edit(post: Post | null) {
    setEditing(post);
    window.scrollTo(0, 0);
  }

  return (
    <ErrorBoundary>
      {error ? (
        <div className="app-warning" role="alert">
          {error}
        </div>
      ) : null}
      {editing !== undefined ? (
        <Suspense
          fallback={<main className="app-state">편집기를 여는 중입니다.</main>}
        >
          <Editor
            key={editing?.id ?? "new"}
            post={editing}
            onClose={() => setEditing(undefined)}
            onSaved={(next) => setDrafts(next)}
          />
        </Suspense>
      ) : loaded ? (
        <Blog
          posts={[...drafts, ...posts]}
          onWrite={() => edit(null)}
          onEdit={edit}
        />
      ) : (
        <main className="app-state">기록을 불러오는 중입니다.</main>
      )}
    </ErrorBoundary>
  );
}
