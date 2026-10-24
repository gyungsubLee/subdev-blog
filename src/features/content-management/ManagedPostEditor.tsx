import { useEffect, useState } from "react";
import type { Post } from "../../shared/post";
import { downloadFile } from "../../shared/download-file.mjs";
import { requestApi, sendApi, uploadAttachment } from "./api";
import PublishStatus from "./PublishStatus";
import type { ManagementSession, Publication, SourceDocument } from "./types";
import "./management.css";

type SourceDraft = {
  revision: string | null;
  title: string;
  markdown: string;
  category: string;
  assets: SourceDocument["assets"];
  requestId: string;
  operation: "save" | "delete";
  sourceDocument?: SourceDocument;
  publication?: Publication;
};

export default function ManagedPostEditor({
  post,
  session,
  onClose,
}: {
  post: Post | null;
  session: ManagementSession;
  onClose: () => void;
}) {
  const [source, setSource] = useState<SourceDocument | null>(null);
  const [draft, setDraft] = useState<SourceDraft | null>(null);
  const [publication, setPublication] = useState<Publication>();
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [generation, setGeneration] = useState(0);
  const draftKey = "second-brain:canonical-draft:" + (post?.id ?? "new");
  const csrfToken = session.csrfToken ?? "";
  const accepted = publication && !["failed", "unchanged"].includes(publication.state);
  const busy = saving || uploading || Boolean(accepted);

  useEffect(() => {
    const controller = new AbortController();
    let saved: SourceDraft | undefined;
    try {
      const bytes = localStorage.getItem(draftKey);
      if (bytes) {
        const value = JSON.parse(bytes);
        const original = value.sourceDocument;
        if (typeof value.title !== "string" || typeof value.markdown !== "string" ||
            typeof value.category !== "string" || typeof value.requestId !== "string" ||
            !Array.isArray(value.assets) || !original?.document?.metadata?.id ||
            typeof original.document.markdown !== "string" ||
            (post && original.document.metadata.id !== post.id) ||
            value.revision !== original.revision) {
          throw new Error("Invalid draft");
        }
        saved = value;
        setSource(original);
        setDraft(value);
        setPublication(value.publication);
      }
    } catch {
      setDraftError("보관한 초안을 읽지 못했습니다. 기존 데이터를 유지합니다.");
    }

    const query = post ? "kind=post&id=" + encodeURIComponent(post.id) : "kind=new";
    requestApi<SourceDocument>("/api/content?" + query, { signal: controller.signal })
      .then((data) => {
        if (saved) {
          if (post && saved.revision !== data.revision) {
            setError("원본이 바뀌었습니다. 같은 요청의 결과를 다시 확인하거나, 초안을 내보내고 최신 원본으로 다시 시작하십시오.");
          }
          return;
        }
        setSource(data);
        setDraft({
          revision: data.revision,
          title: data.document.metadata.title,
          markdown: data.document.markdown,
          category: data.document.metadata.category_id ?? "",
          assets: [],
          requestId: crypto.randomUUID(),
          operation: "save",
          sourceDocument: data,
        });
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") {
          setNeedsLogin(reason.status === 401);
          setError(reason.message ?? "원본을 읽지 못했습니다. 다시 여십시오.");
        }
      });
    return () => controller.abort();
  }, [post?.id, draftKey, generation]);

  useEffect(() => {
    if (!draft || draftError) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ...draft, publication }));
    } catch {
      setDraftError("초안을 저장하지 못했습니다. Markdown으로 내보내십시오.");
    }
  }, [draft, publication, draftKey, draftError]);

  function change(values: Partial<SourceDraft>) {
    setDraft((current) => current ? { ...current, ...values, operation: "save", requestId: crypto.randomUUID() } : null);
    setPublication(undefined);
  }

  async function publish(remove = false) {
    if (!draft || !source || session.state !== "ready") return;
    setSaving(true);
    setError("");
    try {
      if (draft.revision !== source.revision) throw new Error("원본과 초안의 버전이 다릅니다. 초안을 내보내고 원본을 다시 여십시오.");
      const operationName = remove ? "delete" : "save";
      const requestId = draft.operation === operationName ? draft.requestId : crypto.randomUUID();
      setDraft({ ...draft, operation: operationName, requestId });
      const operation = remove
        ? { type: "post.delete", id: source.document.metadata.id, baseRevision: source.revision }
        : post
          ? {
            type: "post.update",
            id: source.document.metadata.id,
            baseRevision: source.revision,
            changes: { title: draft.title, ...(draft.category ? { category_id: draft.category } : {}) },
            markdown: draft.markdown,
            assets: draft.assets,
          }
          : {
            type: "post.create",
            document: {
              metadata: { ...source.document.metadata, title: draft.title, ...(draft.category ? { category_id: draft.category } : {}) },
              markdown: draft.markdown,
            },
            assets: draft.assets,
          };
      const next = await sendApi<Publication>("/api/content", {
        requestId,
        baseCommit: source.contentCommit,
        operation,
      }, csrfToken);
      setPublication(next);
      setConfirmDelete(false);
    } catch (reason) {
      setNeedsLogin(reason instanceof Error && "status" in reason && reason.status === 401);
      setError(reason instanceof Error ? reason.message : "저장하지 못했습니다. 초안은 유지합니다.");
    } finally {
      setSaving(false);
    }
  }

  function reopenSource() {
    if (!["published", "superseded", "unchanged"].includes(publication?.state ?? "") &&
        !window.confirm("보관한 초안을 지우고 최신 원본을 엽니다. 필요한 내용은 먼저 Markdown으로 내보내십시오.")) return;
    try {
      localStorage.removeItem(draftKey);
    } catch {
      setDraftError("보관한 초안을 지우지 못했습니다. Markdown으로 내보내십시오.");
      return;
    }
    setSource(null);
    setDraft(null);
    setPublication(undefined);
    setError("");
    setDraftError("");
    setGeneration((current) => current + 1);
  }

  async function attach(file: File | undefined) {
    if (!file || !draft) return;
    setUploading(true);
    setError("");
    try {
      if ([...(source?.assets ?? []), ...draft.assets].some((asset) => asset.name === file.name)) {
        throw new Error("같은 이름의 첨부가 있습니다. 파일명을 바꾸십시오.");
      }
      const asset = await uploadAttachment(file, csrfToken);
      const label = file.name.replace(/[\\[\]]/g, "\\$&");
      const prefix = file.type.startsWith("image/") ? "!" : "";
      const destination = encodeURIComponent(file.name).replace(/[()]/g, (character) =>
        "%" + character.charCodeAt(0).toString(16).toUpperCase(),
      );
      change({
        assets: [...draft.assets, asset],
        markdown: draft.markdown + `\n\n${prefix}[${label}](./${destination})\n`,
      });
    } catch (reason) {
      setNeedsLogin(reason instanceof Error && "status" in reason && reason.status === 401);
      setError(reason instanceof Error ? reason.message : "첨부를 저장하지 못했습니다.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="managed-editor" id="main-content">
      <div className="management-toolbar">
        <button className="quiet-button" type="button" onClick={onClose}>← 기록으로</button>
        <h1>{post ? "원본 수정" : "새 글 작성"}</h1>
        <button className="quiet-button" type="button" disabled={!draft} onClick={() => {
          if (draft) downloadFile(draft.title + ".md", draft.markdown, "text/markdown;charset=utf-8");
        }}>Markdown 내보내기</button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {needsLogin ? <a href="/api/auth/github">GitHub 다시 로그인</a> : null}
      {draftError ? <p role="alert">{draftError}</p> : null}
      {!draft ? <p>원본을 불러오는 중입니다.</p> : (
        <form onSubmit={(event) => { event.preventDefault(); void publish(); }}>
          <fieldset disabled={busy || session.state !== "ready"}>
            <label>제목<input aria-label="글 제목" value={draft.title} required onChange={(event) => change({ title: event.target.value })} /></label>
            <label>분류<select value={draft.category} onChange={(event) => change({ category: event.target.value })}>
              <option value="" disabled={Boolean(post && source?.document.metadata.category_id)}>상위 글에서 상속</option>
              {source?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select></label>
            <label>본문 Markdown<textarea aria-label="본문 Markdown" value={draft.markdown} rows={22} spellCheck={false} onChange={(event) => change({ markdown: event.target.value })} /></label>
            <label>첨부 추가<input type="file" onChange={(event) => { void attach(event.target.files?.[0]); event.target.value = ""; }} /></label>
            <p>입력한 내용은 이 브라우저에 초안으로 저장합니다. 원본 저장을 누르면 게시 검증을 시작합니다.</p>
            <button className="dark-button" type="submit">{saving ? "저장 요청 중" : "원본 저장"}</button>
            {post ? <button className="quiet-button" type="button" onClick={() => setConfirmDelete(true)}>글 삭제</button> : null}
          </fieldset>
        </form>
      )}
      {confirmDelete ? (
        <section role="alertdialog" aria-label="글 삭제" className="publish-status">
          <p>「{draft?.title}」 원본과 첨부를 삭제합니다. 하위 글과 참조가 있으면 삭제를 거부합니다.</p>
          <button className="outline-button" type="button" disabled={busy} onClick={() => void publish(true)}>삭제 확정</button>
          <button className="quiet-button" type="button" onClick={() => setConfirmDelete(false)}>글 유지</button>
        </section>
      ) : null}
      {publication ? <PublishStatus publication={publication} csrfToken={csrfToken} onChange={setPublication} /> : null}
      {draft && !saving && (error || ["published", "superseded", "unchanged"].includes(publication?.state ?? "")) ? (
        <button className="outline-button" type="button" onClick={reopenSource}>
          {post ? "최신 원본으로 다시 시작" : "다음 글 작성"}
        </button>
      ) : null}
    </main>
  );
}
