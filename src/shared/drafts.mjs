import { parseBlockBackup } from "./document.mjs";
import { rewriteContentLinks } from "./content-links.mjs";

export const DRAFT_KEY = "second-brain:drafts:v1";

export function isDraft(value) {
  const legacyShape = Boolean(
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
  if (!legacyShape) return false;
  try {
    parseBlockBackup(JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
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

/** Resolve only selected bytes or same-origin assets with a known document owner. */
export function draftAssetUrl(draft, url) {
  // A newly allocated legacy draft ID does not identify an original asset owner.
  const owner = draft.documentMode === "legacy" ? draft.sourceId : draft.documentId ?? draft.sourceId;
  const knownOwner = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(owner ?? "");
  const legacy = url.match(/^\/notion\/assets\/([^/?#]+)([?#].*)?$/);
  const owned = url.match(/^\/content\/assets\/([^/]+)\/([^/?#]+)([?#].*)?$/);
  const relative = url.match(/^(?:\.\/)?([^/?#]+)([?#].*)?$/);
  if (owned && (!knownOwner || owned[1].toLowerCase() !== owner.toLowerCase())) return url;
  const encodedName = legacy?.[1] ?? owned?.[2] ?? relative?.[1];
  if (!encodedName) return url;
  let name;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    return url;
  }
  if (/[\\/\u0000-\u001f\u007f]/.test(name) || name === "." || name === "..") return url;
  const selected = draft.attachments?.find((item) => item.name === name);
  if (selected && /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/.test(selected.dataUrl)) return selected.dataUrl;
  if (legacy && knownOwner)
    return "/content/assets/" + owner.toLowerCase() + "/" + encodeURIComponent(name) + (legacy[2] ?? "");
  return url;
}

/** A transient display projection; callers keep the raw draft for editing and backup. */
export function draftDisplayMarkdown(draft) {
  return rewriteContentLinks(draft.markdown, (url) => draftAssetUrl(draft, url));
}
