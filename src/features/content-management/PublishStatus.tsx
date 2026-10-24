import { useEffect, useState } from "react";
import { requestApi, sendApi } from "./api";
import type { Publication } from "./types";

const labels: Record<Publication["state"], string> = {
  validating: "검증 중",
  saved: "원본 저장 완료",
  pending: "원본 저장 완료 · 게시 대기",
  published: "게시 완료",
  failed: "게시 실패",
  superseded: "더 새 변경에 포함된 요청입니다.",
  unchanged: "변경사항이 없습니다.",
};

export default function PublishStatus({
  publication,
  csrfToken,
  onChange,
}: {
  publication: Publication;
  csrfToken: string;
  onChange: (next: Publication) => void;
}) {
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const { requestId, candidateCommit, runId, state } = publication;

  useEffect(() => {
    if (!["validating", "saved"].includes(state) || !candidateCommit || !runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const params = new URLSearchParams({ requestId, candidateCommit: candidateCommit!, runId: String(runId) });
        const next = await requestApi<Partial<Publication>>("/api/publish?" + params);
        if (active) {
          setError("");
          onChange({ ...publication, error: undefined, ...next });
        }
      } catch (reason) {
        if (active) {
          setNeedsLogin(reason instanceof Error && "status" in reason && reason.status === 401);
          setError("진행 상태를 확인하지 못했습니다. Actions 실행을 확인하십시오.");
        }
      }
      if (active) timer = setTimeout(poll, 5000);
    }
    timer = setTimeout(poll, 1500);
    return () => { active = false; clearTimeout(timer); };
  }, [requestId, candidateCommit, runId, state, onChange]);

  async function retry() {
    try {
      setError("");
      const next = await sendApi<Partial<Publication>>("/api/publish", { requestId, candidateCommit }, csrfToken);
      onChange({ ...publication, error: undefined, ...next, state: next.state ?? "validating" });
    } catch (reason) {
      setNeedsLogin(reason instanceof Error && "status" in reason && reason.status === 401);
      setError(reason instanceof Error ? reason.message : "게시를 다시 시작하지 못했습니다.");
    }
  }

  return (
    <section className="publish-status" aria-label="게시 상태">
      <p role="status">{labels[state] ?? "게시 상태 확인 중"}</p>
      {publication.error ? <p role="alert">{publication.error}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {needsLogin ? <a href="/api/auth/github">GitHub 다시 로그인</a> : null}
      {publication.commitUrl?.startsWith("https://github.com/gyungsubLee/subdev-blog-content/commit/") ? <a href={publication.commitUrl} target="_blank" rel="noreferrer">원본 커밋</a> : null}
      {publication.runUrl?.startsWith("https://github.com/gyungsubLee/subdev-blog/actions/runs/") ? <a href={publication.runUrl} target="_blank" rel="noreferrer">Actions 실행</a> : null}
      {["pending", "failed"].includes(state) ? (
        <button className="outline-button" type="button" onClick={retry}>게시 재시도</button>
      ) : null}
    </section>
  );
}
