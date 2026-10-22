export const DRAFT_KEY = "second-brain:drafts:v1";

export function isDraft(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    value.id.startsWith("draft-") &&
    typeof value.title === "string" &&
    typeof value.markdown === "string" &&
    typeof value.category === "string" &&
    typeof value.updatedAt === "string" &&
    Array.isArray(value.blocks),
  );
}

export function readDrafts(storage) {
  const raw = storage.getItem(DRAFT_KEY);
  if (!raw) return [];
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || !value.every(isDraft)) {
    throw new Error(
      "저장된 초안 형식을 읽을 수 없습니다. 기존 데이터는 유지했습니다.",
    );
  }
  return value;
}

export function saveDraft(storage, draft) {
  if (!isDraft(draft)) throw new Error("초안 형식을 확인하십시오.");
  const current = readDrafts(storage);
  const next = [draft, ...current.filter((item) => item.id !== draft.id)];
  storage.setItem(DRAFT_KEY, JSON.stringify(next));
  return next;
}

export function downloadFile(
  name,
  contents,
  mime = "text/markdown;charset=utf-8",
) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(new Blob([contents], { type: mime }));
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, "-");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function markdownDocument(draft) {
  return [
    "---",
    "id: " + JSON.stringify(draft.id.replace(/^draft-/, "")),
    ...(draft.sourceId ? ["source_id: " + JSON.stringify(draft.sourceId)] : []),
    "title: " + JSON.stringify(draft.title),
    "category: " + JSON.stringify(draft.category),
    "created: " + JSON.stringify(draft.createdAt),
    "updated: " + JSON.stringify(draft.updatedAt),
    "---",
    "",
    "# " + draft.title,
    "",
    draft.markdown,
    "",
  ].join("\n");
}
