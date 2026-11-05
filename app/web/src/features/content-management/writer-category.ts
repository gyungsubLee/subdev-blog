import { requestApi, sendApi } from "./api";
import type { CanonicalCategory, Publication } from "./types";

// Materialize only the selected new category path when the user publishes its first post.
export async function ensureWriterCategory(
  id: string,
  pending: CanonicalCategory[],
  csrfToken: string,
): Promise<string> {
  const key = "second-brain:writer-category:" + id;
  let request;
  const saved = localStorage.getItem(key);
  if (saved) {
    request = JSON.parse(saved);
    if (
      request.operation?.type !== "categories.save" ||
      typeof request.requestId !== "string" ||
      typeof request.baseCommit !== "string" ||
      !Array.isArray(request.operation.categories) ||
      !request.operation.categories.some(
        (category: CanonicalCategory) => category.id === id,
      )
    ) {
      throw Error("보관한 분류 저장 요청을 확인하십시오.");
    }
  } else {
    const source = await requestApi<{
      categories: CanonicalCategory[];
      revision: string;
      contentCommit: string;
    }>("/api/content?kind=categories", { signal: AbortSignal.timeout(30000) });
    if (source.categories.some((category) => category.id === id))
      return source.contentCommit;
    const additions: CanonicalCategory[] = [];
    const seen = new Set<string>();
    let current = pending.find((category) => category.id === id);
    while (
      current &&
      !source.categories.some((category) => category.id === current!.id)
    ) {
      if (seen.has(current.id)) throw Error("분류 경로를 확인하십시오.");
      seen.add(current.id);
      additions.unshift(current);
      const parentId = current.parent_id;
      current =
        parentId === null
          ? undefined
          : pending.find((category) => category.id === parentId);
      if (
        parentId &&
        !current &&
        !source.categories.some((category) => category.id === parentId)
      )
        throw Error("상위 분류를 찾지 못했습니다.");
    }
    if (!additions.some((category) => category.id === id))
      throw Error("글의 분류를 찾지 못했습니다.");
    request = {
      requestId: crypto.randomUUID(),
      baseCommit: source.contentCommit,
      operation: {
        type: "categories.save",
        baseRevision: source.revision,
        categories: [...source.categories, ...additions],
      },
    };
    // Retain this exact payload across an ambiguous response, as in the category manager.
    localStorage.setItem(key, JSON.stringify(request));
  }
  let result: Publication;
  try {
    result = await sendApi<Publication>(
      "/api/content",
      request,
      csrfToken,
    );
  } catch (reason) {
    if (reason instanceof Error && "status" in reason && reason.status === 409) {
      localStorage.removeItem(key);
    }
    throw reason;
  }
  if (!["published", "superseded", "unchanged"].includes(result.state))
    throw Error(result.error ?? "분류 저장 결과를 확인하지 못했습니다.");
  const commit = result.contentCommit ?? result.candidateCommit;
  if (!commit) throw Error("분류 저장 버전을 확인하지 못했습니다.");
  localStorage.removeItem(key);
  return commit;
}
