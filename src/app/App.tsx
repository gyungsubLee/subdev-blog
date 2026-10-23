import { lazy, Suspense, useState } from "react";
import type { Post } from "../shared/post";
import BlogView from "./BlogView";
import ErrorBoundary from "./ErrorBoundary";
import { useHashRoute } from "./useHashRoute";
import { usePosts } from "./usePosts";
import "./app.css";

const WritePage = lazy(() => import("../pages/write/WritePage"));

export default function App() {
  const { hash, postId } = useHashRoute();
  const { posts, categories, drafts, error, loaded, setDrafts } = usePosts(postId);
  const [editing, setEditing] = useState<Post | null | undefined>(undefined);

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
          <WritePage
            key={editing?.id ?? "new"}
            post={editing}
            categories={categories}
            onClose={() => setEditing(undefined)}
            onSaved={setDrafts}
          />
        </Suspense>
      ) : loaded ? (
        <BlogView
          posts={[...drafts, ...posts]}
          categories={categories}
          hash={hash}
          onWrite={() => edit(null)}
          onEdit={edit}
        />
      ) : (
        <main className="app-state">기록을 불러오는 중입니다.</main>
      )}
    </ErrorBoundary>
  );
}
