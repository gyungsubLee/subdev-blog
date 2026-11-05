import { useCallback, useRef, useState } from "react";
import type { Post } from "../../shared/post";
import { removePostDrafts } from "../../shared/drafts.mjs";
import { requestApi, sendApi } from "./api";
import type { ManagementSession, Publication, SourceDocument } from "./types";

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

async function deleteOriginal(post: Post, session: ManagementSession) {
  const key = "second-brain:post-deletion:" + post.id;
  try {
    const saved = localStorage.getItem(key);
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
          type: "post.delete", id: post.id, baseRevision: source.revision,
          baseEditorRevision: source.editorRevision ?? null,
        },
      };
      // Retain request identity when a successful write loses its response.
      localStorage.setItem(key, JSON.stringify(input));
    }
    let publication = await sendApi<Publication>("/api/content", input, session.csrfToken ?? "");
    const deadline = Date.now() + 300000;
    let delayMs = 1500;
    while (!["published", "superseded"].includes(publication.state)) {
      if (!["saved", "validating"].includes(publication.state) || !publication.candidateCommit) {
        throw new Error(publication.error ?? "글 삭제를 확인하지 못했습니다. 다시 시도하십시오.");
      }
      if (Date.now() >= deadline) throw new Error("삭제 결과 확인 시간이 초과되었습니다. 다시 확인하십시오.");
      await new Promise(resolve => setTimeout(resolve, delayMs));
      const params = new URLSearchParams({ requestId: input.requestId, candidateCommit: publication.candidateCommit });
      const next = await requestApi<Publication>("/api/publish?" + params, { signal: AbortSignal.timeout(30000) });
      publication = { ...publication, ...next };
      delayMs = 30000;
    }
    return publication.publicCommit ?? publication.contentCommit ?? publication.candidateCommit;
  } catch (reason) {
    if (reason instanceof Error && "status" in reason && reason.status === 409) localStorage.removeItem(key);
    throw reason;
  }
}

export function usePostDeletion(
  session: ManagementSession | undefined,
  onDeleted?: (contentCommit?: string) => void,
) {
  const [deletedIds, setDeletedIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState("");
  const pending = useRef(new Set<string>());
  const completed = useRef(onDeleted);
  completed.current = onDeleted;

  const remove = useCallback((post: Post) => {
    if (session?.state !== "ready" || pending.current.has(post.id)) return;
    pending.current.add(post.id);
    setError("");
    setDeletedIds(previous => new Set([...previous, post.id]));
    void (async () => {
      try {
        const commit = post.draft ? undefined : await deleteOriginal(post, session);
        removePostDrafts(localStorage, post.draft ? [] : [post.id], [post.recoveryKey ?? post.id]);
        localStorage.removeItem("second-brain:post-deletion:" + post.id);
        completed.current?.(commit);
      } catch (reason) {
        setDeletedIds(previous => {
          const restored = new Set(previous);
          restored.delete(post.id);
          return restored;
        });
        const message = reason instanceof Error ? reason.message : "글을 삭제하지 못했습니다.";
        setError(`「${post.title || "제목 없음"}」 삭제를 완료하지 못해 목록에 복원했습니다. ${message}`);
      } finally {
        pending.current.delete(post.id);
      }
    })();
  }, [session]);

  return { deletedIds, error, remove };
}

export type PostDeletion = ReturnType<typeof usePostDeletion>;
