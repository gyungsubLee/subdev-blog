import { lazy, Suspense, useState } from "react";
import type { Post, PublicCategory } from "../shared/post";
import BlogView from "./BlogView";
import ErrorBoundary from "./ErrorBoundary";
import { useHashRoute } from "./useHashRoute";
import { usePosts } from "./usePosts";
import "./app.css";
import { CONTENT_HREF } from "../shared/routes";
import { useManagement } from "../features/content-management/useManagement";

const ManagedPostEditor = lazy(() => import("../features/content-management/ManagedPostEditor"));

export default function App() {
  const { hash, postId } = useHashRoute();
  const { posts, categories, contentCommit, drafts, error, loaded, reload } = usePosts(postId);
  const [editing, setEditing] = useState<Post | null | undefined>(undefined);
  const [pendingCategories, setPendingCategories] = useState<PublicCategory[]>([]);
  const [draftVersion, setDraftVersion] = useState(0);
  const management = useManagement();

  function edit(
    post: Post | null,
    categoryId?: string,
    pending: PublicCategory[] = [],
  ) {
    if (management.session.state !== "ready") return;
    setPendingCategories(pending);
    setEditing(post ?? {
      id: "draft-" + crypto.randomUUID(), draft: true, title: "", markdown: "",
      parentId: null, category: categoryId ?? "", categoryId, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), path: "", url: "", excerpt: "",
    });
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
          <ManagedPostEditor
            key={editing?.id ?? "new"}
            post={editing}
            posts={posts}
            newPostContext={{
              categories: [...categories, ...pendingCategories],
              contentCommit,
              pendingCategories,
            }}
            session={management.session}
            onSaved={reload}
            onDraftSaved={() => setDraftVersion((current) => current + 1)}
            onClose={() => {
              setEditing(undefined);
              window.location.hash = CONTENT_HREF;
            }}
          />
        </Suspense>
      ) : loaded ? (
        <BlogView
          posts={management.session.state === "ready" ? [...drafts, ...posts] : posts}
          categories={categories}
          hash={hash}
          onWrite={(categoryId, pending) => edit(null, categoryId, pending)}
          onEdit={edit}
          management={management}
          onContentSaved={reload}
          draftVersion={draftVersion}
        />
      ) : (
        <main className="app-state">기록을 불러오는 중입니다.</main>
      )}
    </ErrorBoundary>
  );
}
