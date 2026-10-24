import { useEffect, useState } from "react";
import type { Post, PublicCategory } from "../../shared/post";
import { validatePublicCategories, type CategoryNode } from "../post-category/hierarchy";
import CategoriesPage from "../../pages/categories/CategoriesPage";
import { downloadFile } from "../../shared/download-file.mjs";
import { requestApi, sendApi } from "./api";
import PublishStatus from "./PublishStatus";
import type { CanonicalCategory, ManagementSession, Publication } from "./types";
import "./management.css";

type CategoryDraft = {
  categories: CanonicalCategory[];
  revision: string;
  contentCommit: string;
  requestId: string;
  publication?: Publication;
};

const draftKey = "second-brain:canonical-categories";

function categoryNodes(categories: CanonicalCategory[]): CategoryNode[] {
  if (!Array.isArray(categories)) throw new Error("원본 카테고리 형식을 확인하십시오.");
  const projected = categories.map((category) => category && ({
    ...category,
    parentId: category.parent_id,
  }));
  if (!validatePublicCategories(projected)) {
    throw new Error("원본 카테고리 형식을 확인하십시오.");
  }
  return [...projected]
    .sort((left, right) => left.order - right.order)
    .map((category) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      sources: [...category.sources],
    }));
}

export default function ManagedCategories({ session, posts = [] }: {
  categories: PublicCategory[];
  session: ManagementSession;
  posts?: Post[];
}) {
  const [source, setSource] = useState<{ categories: CanonicalCategory[]; revision: string; contentCommit: string }>();
  const [draft, setDraft] = useState<CategoryDraft>();
  const [history, setHistory] = useState<CanonicalCategory[][]>([]);
  const [publication, setPublication] = useState<Publication>();
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generation, setGeneration] = useState(0);
  const ready = session.state === "ready";
  const accepted = publication && !["failed", "unchanged"].includes(publication.state);
  const busy = saving || Boolean(accepted);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    requestApi<{ categories: CanonicalCategory[]; revision: string; contentCommit: string }>("/api/content?kind=categories", { signal: controller.signal })
      .then((data) => {
        categoryNodes(data.categories);
        setSource(data);
        let initial: CategoryDraft = { ...data, requestId: crypto.randomUUID() };
        try {
          const bytes = localStorage.getItem(draftKey);
          if (bytes) {
            const saved = JSON.parse(bytes);
            if (!Array.isArray(saved.categories) || typeof saved.revision !== "string" ||
                typeof saved.contentCommit !== "string" || typeof saved.requestId !== "string") {
              throw new Error("Invalid draft");
            }
            categoryNodes(saved.categories);
            initial = saved;
            setPublication(saved.publication);
            if (saved.revision !== data.revision) {
              setError("원본이 바뀌었습니다. 보관한 편집 내용을 대조하십시오.");
            }
          }
        } catch {
          setDraftError("보관한 편집 내용을 읽지 못했습니다. 기존 데이터를 유지합니다.");
        }
        setDraft(initial);
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") {
          setNeedsLogin(reason.status === 401);
          setError(reason.message);
        }
      });
    return () => controller.abort();
  }, [ready, generation]);

  useEffect(() => {
    if (!draft || draftError) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ...draft, publication }));
    } catch {
      setDraftError("편집 내용을 보관하지 못했습니다. 화면을 닫기 전에 내용을 복사하십시오.");
    }
  }, [draft, publication, draftError]);

  function stageNodes(nodes: CategoryNode[]) {
    if (!draft || busy) return;
    const originals = new Map(draft.categories.map((category) => [category.id, category]));
    const siblingOrder = new Map<string | null, number>();
    const categories = nodes.map((node) => {
      const order = siblingOrder.get(node.parentId) ?? 0;
      siblingOrder.set(node.parentId, order + 1);
      const original = originals.get(node.id);
      return {
        ...(original ?? { id: node.id, sources: [] }),
        name: node.name,
        parent_id: node.parentId,
        order,
      };
    });
    setHistory((previous) => [...previous, draft.categories]);
    setDraft({ ...draft, categories, requestId: crypto.randomUUID() });
    setPublication(undefined);
  }

  function undo() {
    if (!draft || busy || history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(history.slice(0, -1));
    setDraft({ ...draft, categories: previous, requestId: crypto.randomUUID() });
    setPublication(undefined);
  }

  async function save() {
    if (!source || !draft || !ready) return;
    setSaving(true);
    setError("");
    try {
      const next = await sendApi<Publication>("/api/content", {
        requestId: draft.requestId,
        baseCommit: draft.contentCommit,
        operation: { type: "categories.save", baseRevision: draft.revision, categories: draft.categories },
      }, session.csrfToken ?? "");
      setPublication(next);
    } catch (reason) {
      setNeedsLogin(reason instanceof Error && "status" in reason && reason.status === 401);
      setError(reason instanceof Error ? reason.message : "분류를 저장하지 못했습니다. 편집 내용은 유지합니다.");
    } finally {
      setSaving(false);
    }
  }

  function reopenSource() {
    if (!["published", "superseded", "unchanged"].includes(publication?.state ?? "") &&
        !window.confirm("보관한 편집 내용을 지우고 최신 원본을 엽니다. 필요한 내용은 먼저 JSON으로 내보내십시오.")) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      setDraftError("보관한 편집 내용을 지우지 못했습니다. JSON으로 내보내십시오.");
      return;
    }
    setHistory([]);
    setDraft(undefined);
    setPublication(undefined);
    setError("");
    setDraftError("");
    setGeneration((current) => current + 1);
  }

  if (!ready) return null;

  const footer = (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {draftError ? <p role="alert">{draftError}</p> : null}
      {needsLogin ? <a href="/api/auth/github">GitHub 다시 로그인</a> : null}
      {draft ? (
        <div className="management-toolbar">
          <button className="quiet-button" type="button" onClick={() => {
            downloadFile("categories.json", JSON.stringify(draft.categories, null, 2) + "\n", "application/json");
          }}>JSON 내보내기</button>
        </div>
      ) : null}
      {publication ? <PublishStatus publication={publication} csrfToken={session.csrfToken ?? ""} onChange={setPublication} /> : null}
      {draft && !saving && (error || ["published", "superseded", "unchanged"].includes(publication?.state ?? "")) ? (
        <button className="outline-button" type="button" onClick={reopenSource}>최신 원본으로 다시 시작</button>
      ) : null}
    </>
  );

  if (!source || !draft) {
    return <main className="categories-page" id="main-content" tabIndex={-1}>
      <h1>카테고리 관리</h1>
      <p>원본 카테고리를 불러옵니다.</p>
      {footer}
    </main>;
  }

  const nodes = categoryNodes(draft.categories);

  function deleteError(node: CategoryNode) {
    if (node.id === "group:unclassified") return "미분류는 삭제할 수 없습니다.";
    if (nodes.some((category) => category.parentId === node.id)) {
      return "하위 분류를 먼저 이동하십시오.";
    }
    const assigned = posts.some((post) => {
      if (post.draft) return false;
      const category = post.categoryId ?? post.category;
      return category === node.id || node.sources.includes(category);
    });
    return assigned ? "배정한 글을 먼저 이동하십시오." : null;
  }

  return <CategoriesPage
    posts={posts}
    canonical
    busy={busy}
    note="원본 카테고리를 수정합니다. 저장 후 게시 검증을 시작합니다."
    footer={footer}
    deleteError={deleteError}
    catalog={{
      draftNodes: nodes,
      stage: stageNodes,
      undo,
      canUndo: history.length > 0,
      dirty: JSON.stringify(draft.categories) !== JSON.stringify(source.categories),
      error: "",
      saveNodes: () => {
        void save();
        return false;
      },
    }}
  />;
}
