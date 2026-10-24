import { lazy, Suspense, useState } from "react";
import type { Post } from "../shared/post";
import BlogView from "./BlogView";
import ErrorBoundary from "./ErrorBoundary";
import { useHashRoute } from "./useHashRoute";
import { usePosts } from "./usePosts";
import "./app.css";
import { useManagement } from "../features/content-management/useManagement";

const WritePage = lazy(() => import("../pages/write/WritePage"));
const ManagedPostEditor = lazy(() => import("../features/content-management/ManagedPostEditor"));

export default function App() {
  const { hash, postId } = useHashRoute();
  const { posts, categories, drafts, error, loaded, setDrafts } = usePosts(postId);
  const [editing, setEditing] = useState<Post | null | undefined>(undefined);
  const management = useManagement();

  function edit(post: Post | null) {
    if (management.session.state !== "ready") return;
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
      {editing !== undefined && management.session.state === "ready" ? (
        <Suspense
          fallback={<main className="app-state">편집기를 여는 중입니다.</main>}
        >
          {editing?.draft ? (
            <WritePage
              key={editing.id}
              post={editing}
              onClose={() => setEditing(undefined)}
              onSaved={setDrafts}
            />
          ) : (
            <ManagedPostEditor
              key={editing?.id ?? "new"}
              post={editing}
              session={management.session}
              onClose={() => setEditing(undefined)}
            />
          )}
        </Suspense>
      ) : loaded ? (
        <BlogView
          posts={management.session.state === "ready" ? [...drafts, ...posts] : posts}
          categories={categories}
          hash={hash}
          onWrite={() => edit(null)}
          onEdit={edit}
          management={management}
        />
      ) : (
        <main className="app-state">기록을 불러오는 중입니다.</main>
      )}
    </ErrorBoundary>
  );
}
