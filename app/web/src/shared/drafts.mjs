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

export function removePostDrafts(storage, postIds, draftIds = []) {
  const canonicalIds = new Set(postIds);
  const keys = new Set([...postIds, ...draftIds].map(id => "second-brain:canonical-draft:" + id));
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith("second-brain:canonical-draft:")) continue;
    try {
      const draft = JSON.parse(storage.getItem(key) ?? "null");
      if (canonicalIds.has(draft?.sourceDocument?.document?.metadata?.id)) keys.add(key);
    } catch {
      // Unrelated malformed recovery data must retain its original bytes.
    }
  }
  const removedIds = new Set([...keys].map(key => key.slice("second-brain:canonical-draft:".length)));
  if (storage.getItem(DRAFT_KEY)) {
    storage.setItem(DRAFT_KEY, JSON.stringify(readDrafts(storage).filter(draft => !removedIds.has(draft.id))));
  }
  for (const key of keys) storage.removeItem(key);
}
