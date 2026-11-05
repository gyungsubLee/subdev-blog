import Button from "../../components/button/Button";
import { useEffect, useState } from "react";
import { requestApi, sendApi } from "./api";
import type { Publication } from "./types";

const labels: Record<Publication["state"], string> = {
  validating: "저장 확인 중",
  saved: "원본 저장 완료",
  pending: "저장 확인 필요",
  published: "게시 완료",
  failed: "저장 실패",
  superseded: "더 새 변경에 포함된 요청입니다.",
  unchanged: "변경사항이 없습니다.",
};

export default function PublishStatus({
  publication,
  csrfToken,
  onChange,
  onRetry,
}: {
  publication: Publication;
  csrfToken: string;
  onChange: (next: Publication) => void;
  onRetry?: () => Promise<unknown>;
}) {
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const { requestId, candidateCommit, state } = publication;

  useEffect(() => {
    if (publication.background || !["validating", "saved"].includes(state) || !candidateCommit) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const params = new URLSearchParams({ requestId, candidateCommit: candidateCommit! });
        const next = await requestApi<Partial<Publication>>("/api/publish?" + params);
        if (active) {
          setError("");
          setNeedsLogin(false);
          onChange({ ...publication, error: undefined, ...next });
        }
      } catch (reason) {
        if (active) {
          setNeedsLogin(reason instanceof Error && "status" in reason && reason.status === 401);
          setError("저장 결과를 확인하지 못했습니다. 같은 요청을 다시 확인하십시오.");
        }
      }
      if (active) timer = setTimeout(poll, 30000);
    }
    timer = setTimeout(poll, 1500);
    return () => { active = false; clearTimeout(timer); };
  }, [requestId, candidateCommit, state, publication.background, onChange]);

  async function retry() {
    try {
      setError("");
      if (publication.background && onRetry) { await onRetry(); return; }
      const next = await sendApi<Partial<Publication>>("/api/publish", { requestId, candidateCommit }, csrfToken);
      setNeedsLogin(false);
      onChange({ ...publication, error: undefined, ...next, state: next.state ?? "pending" });
    } catch (reason) {
      setNeedsLogin(reason instanceof Error && "status" in reason && reason.status === 401);
      setError(reason instanceof Error ? reason.message : "저장을 다시 확인하지 못했습니다.");
    }
  }

  return (
    <section className="publish-status" aria-label="게시 상태">
      <p role="status">{labels[state] ?? "게시 상태 확인 중"}</p>
      {publication.error ? <p role="alert">{publication.error}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {needsLogin ? <a href="/api/auth/github">GitHub 다시 로그인</a> : null}
      {publication.commitUrl?.startsWith("https://github.com/gyungsubLee/subdev-blog-content/commit/") ? <a href={publication.commitUrl} target="_blank" rel="noreferrer">원본 커밋</a> : null}
      {["pending", "failed"].includes(state) || error ? (
        <Button className="outline-button" type="button" onClick={retry}>저장 재시도</Button>
      ) : null}
    </section>
  );
}
