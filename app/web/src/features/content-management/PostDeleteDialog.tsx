import Button from "../../components/button/Button";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Post } from "../../shared/post";
import { removePostDrafts } from "../../shared/drafts.mjs";
import { requestApi, sendApi } from "./api";
import PublishStatus from "./PublishStatus";
import type { ManagementSession, Publication, SourceDocument } from "./types";
import "./delete-dialog.css";

type DeleteRequest = {
  requestId: string;
  baseCommit: string;
  operation: {
    type: "post.delete";
    id: string;
    baseRevision: string | null;
    baseEditorRevision: string | null;
  };
};

export default function PostDeleteDialog({
  post,
  session,
  onClose,
  onDeleted,
}: {
  post: Post;
  session: ManagementSession;
  onClose: () => void;
  onDeleted: (contentCommit?: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [publication, setPublication] = useState<Publication>();
  const requestKey = "second-brain:post-deletion:" + post.id;

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  function close() {
    if (inFlight.current) return;
    dialog.current?.close();
    onClose();
  }

  const finish = useCallback((contentCommit?: string) => {
    removePostDrafts(
      localStorage,
      post.draft ? [] : [post.id],
      [post.recoveryKey ?? post.id],
    );
    localStorage.removeItem(requestKey);
    dialog.current?.close();
    onDeleted(contentCommit);
  }, [post, onDeleted, requestKey]);

  const updatePublication = useCallback((next: Publication) => {
    setPublication(next);
    if (["published", "superseded"].includes(next.state)) {
      try {
        finish(next.contentCommit ?? next.candidateCommit);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "초안을 지우지 못했습니다.");
      }
    }
  }, [finish]);

  async function remove() {
    if (inFlight.current || session.state !== "ready") return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (publication && ["published", "superseded"].includes(publication.state)) {
        finish(publication.contentCommit ?? publication.candidateCommit);
        return;
      }
      if (post.draft) {
        finish();
        return;
      }
      const saved = localStorage.getItem(requestKey);
      let input: DeleteRequest;
      if (saved) {
        input = JSON.parse(saved);
        if (input.operation?.type !== "post.delete" || input.operation.id !== post.id ||
            typeof input.requestId !== "string" || typeof input.baseCommit !== "string") {
          throw new Error("보관한 삭제 요청을 확인하십시오.");
        }
      } else {
        const source = await requestApi<SourceDocument>(
          "/api/content?" + new URLSearchParams({ kind: "post", id: post.id }),
          { signal: AbortSignal.timeout(30000) },
        );
        input = {
          requestId: crypto.randomUUID(),
          baseCommit: source.contentCommit,
          operation: {
            type: "post.delete",
            id: post.id,
            baseRevision: source.revision,
            baseEditorRevision: source.editorRevision ?? null,
          },
        };
        // Persist before sending: an accepted request may lose its response.
        localStorage.setItem(requestKey, JSON.stringify(input));
      }
      const next = await sendApi<Publication>(
        "/api/content", input, session.csrfToken ?? "",
      );
      setPublication(next);
      if (["published", "superseded"].includes(next.state)) {
        finish(next.contentCommit ?? next.candidateCommit);
      }
    } catch (reason) {
      if (reason instanceof Error && "status" in reason && reason.status === 409) {
        localStorage.removeItem(requestKey);
      }
      setError(reason instanceof Error ? reason.message : "글을 삭제하지 못했습니다.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      className="content-delete-dialog"
      ref={dialog}
      aria-labelledby="post-delete-title"
      aria-describedby="post-delete-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-body">
        <h2 id="post-delete-title">글 삭제</h2>
        <p>「{post.title || "제목 없음"}」 글을 삭제하시겠습니까?</p>
        <p id="post-delete-description">
          {post.draft
            ? "이 브라우저에 저장한 초안을 삭제합니다. 앱에서 되돌릴 수 없습니다."
            : "원본 글과 첨부 파일, 이 브라우저의 초안을 삭제합니다. 앱에서 되돌릴 수 없습니다. 하위 글이나 참조가 있으면 삭제할 수 없습니다."}
        </p>
        {error ? <p role="alert">{error}</p> : null}
        {publication ? (
          <PublishStatus
            publication={publication}
            csrfToken={session.csrfToken ?? ""}
            onChange={updatePublication}
          />
        ) : null}
      </div>
      <div className="modal-footer">
        <Button type="button" className="outline-button" disabled={busy} onClick={close} autoFocus>취소</Button>
        <Button
          type="button"
          id="confirm-post-delete"
          className="dark-button"
          disabled={busy || Boolean(publication && !["published", "superseded"].includes(publication.state))}
          onClick={() => void remove()}
        >
          {busy ? "삭제 중…" : "삭제 확정"}
        </Button>
      </div>
    </dialog>
  );
}
