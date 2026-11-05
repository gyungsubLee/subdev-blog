import Button from "../../components/button/Button";
import { useEffect, useRef, useState } from "react";
import type { Post, PublicCategory } from "../../shared/post";
import { validatePublicCategories, type CategoryNode } from "../post-category/hierarchy";
import CategoriesPage from "../post-category/CategoryManager";
import { removePostDrafts } from "../../shared/drafts.mjs";
import { downloadFile } from "../../shared/download-file.mjs";
import { requestApi, sendApi } from "./api";
import PublishStatus from "./PublishStatus";
import { categorySourceKey, enqueueContentSync, retryContentSync, discardContentConflict, SYNC_EVENT, syncScope } from "./background-sync.mjs";
import type { CanonicalCategory, ManagementSession, Publication } from "./types";
import "./management.css";

type CategoryDraft = {
  syncVersion?: number;
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

type CategorySource = { syncVersion?: number; categories: CanonicalCategory[]; revision: string; contentCommit: string };
function restoreCategories(key: string): {source?:CategorySource;draft?:CategoryDraft;publication?:Publication;error?:string} {
  let source: CategorySource;
  try {
    source = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!source || !/^[a-f0-9]{64}$/.test(source.revision) || !/^[a-f0-9]{40}$/.test(source.contentCommit)) return {};
    categoryNodes(source.categories);
  } catch { return {}; }
  const draft = {...source,requestId:crypto.randomUUID()};
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
    if (!saved) return {source,draft};
    if(typeof saved.revision !== "string" || typeof saved.contentCommit !== "string" || typeof saved.requestId !== "string") throw Error();
    categoryNodes(saved.categories);
    return {source,draft:saved,publication:saved.publication};
  } catch { return {source,draft,error:"보관한 편집 내용을 읽지 못했습니다. 기존 데이터를 유지합니다."}; }
}

export default function ManagedCategories({ session, posts = [], onSaved }: {
  categories: PublicCategory[];
  session: ManagementSession;
  posts?: Post[];
  onSaved?: (contentCommit?: string) => void;
}) {
  const savingRef = useRef(false);
  const sourceKey = categorySourceKey(session);
  const [initial] = useState(() => restoreCategories(sourceKey));
  const [source, setSource] = useState<CategorySource | undefined>(initial.source);
  const [draft, setDraft] = useState<CategoryDraft | undefined>(initial.draft);
  const [history, setHistory] = useState<CanonicalCategory[][]>([]);
  const [publication, setPublication] = useState<Publication | undefined>(initial.publication);
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState(initial.error ?? "");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generation, setGeneration] = useState(0);
  const ready = session.state === "ready";
  const busy = saving || Boolean(draftError);

  useEffect(() => {
    if (!ready || (generation === 0 && initial.source && initial.draft)) return;
    const controller = new AbortController();
    requestApi<{ categories: CanonicalCategory[]; revision: string; contentCommit: string }>(`/api/content?kind=categories${generation > 0 ? "&refresh=1" : ""}`, { signal: controller.signal })
      .then((data) => {
        categoryNodes(data.categories);
        setSource(data);
        try { localStorage.setItem(sourceKey, JSON.stringify(data)); } catch { /* The downloaded source remains usable. */ }
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

  useEffect(() => {
    if (publication && !publication.background && ["published", "superseded", "unchanged"].includes(publication.state)) {
      onSaved?.(publication.contentCommit ?? publication.candidateCommit);
    }
  }, [publication?.state, publication?.contentCommit, publication?.candidateCommit, onSaved]);

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

  useEffect(() => {
    function changed(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.scope !== syncScope(session) || !detail.batch?.items.some((item: {draftKey:string}) => item.draftKey === draftKey)) return;
      if (detail.state === "confirmed") {
        const next = detail.result as Publication & {categories?:CategorySource};
        const fresh = restoreCategories(sourceKey).source ?? next.categories;
        if(fresh) {
          setSource(fresh);
          setDraft(current => current ? {...current,revision:fresh.revision,contentCommit:fresh.contentCommit,syncVersion:fresh.syncVersion} : current);
        }
        const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
        if (detail.batch.items.some((item:{clientRequestId:string}) => item.clientRequestId === saved?.requestId)) {
          setPublication({...next,background:true});
          setError("");
        }
        if(next.state!=="saved"&&!next.publicationPending)onSaved?.(next.contentCommit);
      } else if(detail.state === "publication") {
        const saved = JSON.parse(localStorage.getItem(draftKey) ?? "null");
        if(detail.batch.items.some((item:{clientRequestId:string})=>item.clientRequestId===saved?.requestId))setPublication({...detail.result,background:true});
      } else if(detail.state === "failed") {
        setNeedsLogin(detail.error?.status === 401);
        setError(detail.error?.message ?? "분류를 저장하지 못했습니다. 편집 내용은 유지합니다.");
      }
    }
    window.addEventListener(SYNC_EVENT,changed);
    return () => window.removeEventListener(SYNC_EVENT,changed);
  }, [session.user?.id,sourceKey,onSaved]);

  async function save() {
    if (!source || !draft || !ready || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      localStorage.setItem(draftKey,JSON.stringify(draft));
      await enqueueContentSync({baseCommit:draft.contentCommit,
        operation:{type:"categories.save",baseRevision:draft.revision,categories:draft.categories}},session,draftKey,draft.requestId);
      setPublication({state:"validating",requestId:draft.requestId,background:true});
    } catch(reason) {
      setError(reason instanceof Error ? reason.message : "분류를 저장하지 못했습니다. 편집 내용은 유지합니다.");
    } finally { savingRef.current=false;setSaving(false); }
  }

  async function deleteCategory(id: string, mode: "move" | "delete"): Promise<boolean> {
    if (!source || !draft || !ready || savingRef.current || busy) return false;
    const node = categoryNodes(draft.categories).find((item) => item.id === id);
    if (!node || deleteError(node)) return false;
    const nextDraft = {
      ...draft,
      categories: draft.categories.filter((category) => category.id !== id),
      requestId: crypto.randomUUID(),
    };
    const requestKey = "second-brain:category-deletion:" + id + ":" + mode;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      // Keep the exact deletion payload for retry after a lost response or reload.
      const saved = localStorage.getItem(requestKey);
      const input = saved ? JSON.parse(saved) : {
        requestId: nextDraft.requestId,
        baseCommit: nextDraft.contentCommit,
        operation: { type: "category.delete", id, mode, baseRevision: nextDraft.revision },
      };
      if (input.operation?.type !== "category.delete" || input.operation.id !== id || input.operation.mode !== mode ||
          typeof input.requestId !== "string" || typeof input.baseCommit !== "string") {
        throw new Error("보관한 삭제 요청을 확인하십시오.");
      }
      localStorage.setItem(requestKey, JSON.stringify(input));
      const next = await sendApi<Publication>(
        "/api/content", input, session.csrfToken ?? "",
      );
      if (!["published", "superseded", "unchanged"].includes(next.state)) {
        setError(next.error ?? "삭제 결과를 확인하지 못했습니다. 같은 삭제 요청을 다시 확인하십시오.");
        return false;
      }
      if (mode === "delete") removePostDrafts(localStorage, next.deletedPostIds ?? []);
      setPublication(next);
      setDraft({ ...nextDraft, requestId: input.requestId });
      setHistory([]);
      localStorage.removeItem(requestKey);
      return true;
    } catch (reason) {
      if (reason instanceof Error && "status" in reason && reason.status === 409) {
        localStorage.removeItem(requestKey);
      }
      setNeedsLogin(reason instanceof Error && "status" in reason && reason.status === 401);
      setError(reason instanceof Error ? reason.message : "카테고리를 삭제하지 못했습니다.");
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function reopenSource() {
    if (!["published", "superseded", "unchanged"].includes(publication?.state ?? "") &&
        !window.confirm("보관한 편집 내용을 지우고 최신 원본을 엽니다. 필요한 내용은 먼저 JSON으로 내보내십시오.")) return;
    try {
      void discardContentConflict(session,"categories").catch(reason=>setError(reason.message));
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
          <Button className="quiet-button" type="button" onClick={() => {
            downloadFile("categories.json", JSON.stringify(draft.categories, null, 2) + "\n", "application/json");
          }}>JSON 내보내기</Button>
        </div>
      ) : null}
      {publication ? <PublishStatus publication={publication} csrfToken={session.csrfToken ?? ""} onChange={setPublication} onRetry={() => retryContentSync(session)} /> : null}
      {draft && !saving && (error || ["published", "superseded", "unchanged"].includes(publication?.state ?? "")) ? (
        <Button className="outline-button" type="button" onClick={reopenSource}>최신 원본으로 다시 시작</Button>
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
  const completed = ["published", "superseded", "unchanged"].includes(publication?.state ?? "");
  const dirty = !completed && JSON.stringify(draft.categories) !== JSON.stringify(source.categories);

  function deleteError(node: CategoryNode) {
    if (dirty || publication?.state === "validating") {
      return "편집 중인 변경사항을 먼저 저장하십시오.";
    }
    if (node.id === "group:unclassified") return "미분류는 삭제할 수 없습니다.";
    if (nodes.some((category) => category.parentId === node.id)) {
      return "하위 분류를 먼저 이동하십시오.";
    }
    return null;
  }

  return <CategoriesPage
    posts={posts}
    canonical
    busy={busy}
    note="원본 카테고리를 수정합니다. 저장하면 공개 화면에 적용합니다."
    footer={footer}
    deleteError={deleteError}
    onDelete={deleteCategory}
    deletionError={error}
    catalog={{
      draftNodes: nodes,
      stage: stageNodes,
      undo,
      canUndo: history.length > 0,
      dirty,
      error: "",
      saveNodes: () => {
        void save();
        return false;
      },
    }}
  />;
}
