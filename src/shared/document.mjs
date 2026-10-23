import { isAlias, isMap, isScalar, parseDocument, stringify, visit } from "yaml";

function readString(value, label) {
  if (typeof value !== "string")
    throw new Error(label + "은 문자열이어야 합니다.");
  return value;
}

export function parseBlockBackup(text) {
  const data = JSON.parse(text);
  if (
    !data ||
    typeof data !== "object" ||
    !Array.isArray(data.blocks) ||
    !data.blocks.length
  ) {
    throw new Error("블록 문서 형식을 확인하십시오.");
  }
  const title = readString(data.title, "제목");
  const category =
    data.category === undefined ? "기록" : readString(data.category, "분류");
  const sourceId =
    data.sourceId === undefined
      ? undefined
      : readString(data.sourceId, "원본 ID");
  const createdAt =
    data.createdAt === undefined
      ? undefined
      : readString(data.createdAt, "작성일");
  return { title, category, blocks: data.blocks, sourceId, createdAt };
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

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const revisionPattern = /^[a-f0-9]{64}$/;
const metadataKeyPattern = /^(?:schema_version|document_mode|base_revision|id|source_id|title|category|parent_id|category_id|created|updated|tags|summary|aliases|kind|order|review_status|related_ids|source_ids|source_url|cover|icon|legacy_path|legacy_category):/m;
const forbiddenKeys = new Set(["__proto__", "constructor", "prototype"]);

function readUuid(value, label) {
  if (typeof value !== "string" || !uuidPattern.test(value))
    throw new Error(label + "은 UUID여야 합니다.");
  return value.toLowerCase();
}

function readRevision(value) {
  if (typeof value !== "string" || !revisionPattern.test(value))
    throw new Error("base_revision은 SHA-256이어야 합니다.");
  return value;
}

function validateJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item);
    return;
  }
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key))
        throw new Error("허용하지 않는 메타데이터 키입니다: " + key);
      validateJson(item);
    }
    return;
  }
  throw new Error("메타데이터는 JSON 호환 값이어야 합니다.");
}

function validateKnownFields(metadata) {
  for (const key of [
    "title", "category", "category_id", "summary", "legacy_path", "legacy_category",
  ]) {
    if (Object.hasOwn(metadata, key)) readString(metadata[key], key);
  }
  for (const key of ["cover", "icon"]) {
    if (Object.hasOwn(metadata, key) && metadata[key] !== null)
      readString(metadata[key], key);
  }
  if (Object.hasOwn(metadata, "id")) metadata.id = readUuid(metadata.id, "id");
  if (Object.hasOwn(metadata, "parent_id") && metadata.parent_id !== null)
    metadata.parent_id = readUuid(metadata.parent_id, "parent_id");
  for (const key of ["tags", "aliases", "related_ids", "source_ids"]) {
    if (!Object.hasOwn(metadata, key)) continue;
    if (!Array.isArray(metadata[key]))
      throw new Error(key + "은 배열이어야 합니다.");
    metadata[key] = metadata[key].map((value) =>
      key.endsWith("_ids") ? readUuid(value, key) : readString(value, key),
    );
  }
  if (
    Object.hasOwn(metadata, "order") &&
    (!Number.isSafeInteger(metadata.order) || metadata.order < 0)
  )
    throw new Error("order는 0 이상의 정수여야 합니다.");
  for (const [key, values] of [
    ["kind", ["article", "troubleshooting", "concept", "reference", "synthesis"]],
    ["review_status", ["unreviewed", "reviewed", "needs_review"]],
  ]) {
    if (Object.hasOwn(metadata, key) && !values.includes(metadata[key]))
      throw new Error(key + " 값을 확인하십시오.");
  }
  for (const key of ["created", "updated"]) {
    if (
      Object.hasOwn(metadata, key) &&
      (
        typeof metadata[key] !== "string" ||
        !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(metadata[key]) ||
        !Number.isFinite(Date.parse(metadata[key]))
      )
    )
      throw new Error(key + "은 ISO 날짜·시간이어야 합니다.");
  }
  if (Object.hasOwn(metadata, "source_url")) {
    const url = new URL(readString(metadata.source_url, "source_url"));
    if (url.protocol !== "https:" && url.protocol !== "http:")
      throw new Error("source_url은 HTTP·HTTPS 주소여야 합니다.");
  }
}

function canonicalMetadata(value) {
  validateJson(value);
  const metadata = structuredClone(value);
  if (metadata.schema_version !== 1)
    throw new Error("schema_version은 1이어야 합니다.");
  for (const key of ["id", "title", "parent_id", "created", "updated"]) {
    if (!Object.hasOwn(metadata, key))
      throw new Error("필수 메타데이터가 없습니다: " + key);
  }
  validateKnownFields(metadata);
  if (
    Object.hasOwn(metadata, "source_id") &&
    readUuid(metadata.source_id, "source_id") !== metadata.id
  )
    throw new Error("id와 source_id가 다릅니다.");
  delete metadata.document_mode;
  delete metadata.base_revision;
  return {
    order: 0,
    kind: "article",
    summary: "",
    tags: [],
    aliases: [],
    related_ids: [],
    source_ids: [],
    review_status: "unreviewed",
    ...metadata,
  };
}

function parseHeader(header) {
  const document = parseDocument(header, { version: "1.2", uniqueKeys: true });
  if (!isMap(document.contents)) {
    if (metadataKeyPattern.test(header))
      throw new Error("메타데이터는 YAML 매핑이어야 합니다.");
    return undefined;
  }
  if (document.errors.length)
    throw new Error("메타데이터 YAML을 확인하십시오: " + document.errors[0].message);
  visit(document, {
    Node(key, node) {
      if (isAlias(node) || node.tag)
        throw new Error("YAML 별칭과 태그는 허용하지 않습니다.");
      if (isMap(node)) {
        for (const pair of node.items) {
          if (!isScalar(pair.key) || typeof pair.key.value !== "string")
            throw new Error("메타데이터 키는 문자열이어야 합니다.");
          if (forbiddenKeys.has(pair.key.value))
            throw new Error("허용하지 않는 메타데이터 키입니다.");
        }
      }
    },
  });
  const metadata = document.toJS({ maxAliasCount: 0 });
  validateJson(metadata);
  return metadata;
}

/**
 * Parse transport fields separately; flat fields adapt existing callers.
 * @returns {import("./post").ParsedDocument & {
 *   title?: string, category?: string, id?: string, sourceId?: string,
 *   createdAt?: string, updatedAt?: string, markdown: string
 * }}
 */
export function parseMarkdownDocument(text) {
  let markdown = readString(text, "문서").replace(/^\uFEFF/, "");
  let metadata = {};
  if (/^---\r?\n/.test(markdown)) {
    const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)^---[ \t]*(?:\r?\n|$)/m);
    if (frontmatter) {
      const parsed = parseHeader(frontmatter[1]);
      if (parsed) {
        metadata = parsed;
        markdown = markdown.slice(frontmatter[0].length);
      }
    } else {
      const header = markdown.slice(markdown.indexOf("\n") + 1);
      if (metadataKeyPattern.test(header) || isMap(parseDocument(header).contents))
        throw new Error("메타데이터 헤더를 닫으십시오.");
    }
  }
  const baseRevision = Object.hasOwn(metadata, "base_revision")
    ? readRevision(metadata.base_revision)
    : undefined;
  const documentMode = metadata.document_mode;
  delete metadata.base_revision;
  delete metadata.document_mode;
  if (
    documentMode !== undefined &&
    documentMode !== "full" &&
    documentMode !== "patch"
  )
    throw new Error("document_mode 값을 확인하십시오.");
  if (Object.hasOwn(metadata, "schema_version") && metadata.schema_version !== 1)
    throw new Error("schema_version은 1이어야 합니다.");

  if (documentMode === "patch") {
    if (metadata.schema_version !== 1)
      throw new Error("수정본에는 schema_version이 필요합니다.");
    validateKnownFields(metadata);
    const patch = validatePatch({
      id: metadata.id,
      baseRevision,
      changes: {
        ...(Object.hasOwn(metadata, "title") ? { title: metadata.title } : {}),
        ...(Object.hasOwn(metadata, "category_id")
          ? { category_id: metadata.category_id }
          : {}),
      },
      markdown,
    });
    return {
      documentMode: "patch", patch,
      ...legacyFields(metadata, markdown, patch.id),
    };
  }
  if (metadata.schema_version === 1) {
    metadata = canonicalMetadata(metadata);
    return {
      documentMode: "full", metadata, baseRevision,
      ...legacyFields(metadata, markdown, metadata.id),
    };
  }
  if (documentMode === "full")
    throw new Error("전체 문서에는 schema_version이 필요합니다.");
  // Legacy exports treated id as a draft alias when a valid source_id existed.
  const sourceId =
    typeof metadata.source_id === "string" && uuidPattern.test(metadata.source_id)
      ? metadata.source_id.toLowerCase()
      : undefined;
  const fields = { ...metadata };
  if (metadata.id !== undefined) readString(metadata.id, "id");
  if (sourceId || !uuidPattern.test(fields.id)) delete fields.id;
  validateKnownFields(fields);
  if (metadata.source_id !== undefined)
    readString(metadata.source_id, "source_id");
  const id = sourceId ?? fields.id;
  const heading = markdown.match(/^\s*# ([^\r\n]+)(?:\r?\n|$)/);
  const title = metadata.title || heading?.[1].trim();
  if (heading && heading[1].trim() === title)
    markdown = markdown.slice(heading[0].length);
  return {
    documentMode: "legacy", metadata,
    ...legacyFields({ ...metadata, title }, markdown, id),
  };
}

function legacyFields(metadata, markdown, id) {
  return {
    title: metadata.title,
    category: metadata.category ?? metadata.legacy_category,
    id,
    sourceId: id,
    createdAt: metadata.created,
    updatedAt: metadata.updated,
    markdown,
  };
}

function serializeHeader(metadata, markdown) {
  return (
    "---\n" + stringify(metadata, {
      version: "1.2",
      lineWidth: 0,
      aliasDuplicateObjects: false,
    }) +
    "---\n" + readString(markdown, "본문")
  );
}

/** @param {import("./post").ContentDocument} document */
export function serializeMarkdownDocument(document, options = {}) {
  const metadata = canonicalMetadata(document.metadata);
  if (options.baseRevision !== undefined)
    metadata.base_revision = readRevision(options.baseRevision);
  return serializeHeader(metadata, document.markdown);
}

function validatePatch(patch) {
  validateJson(patch.changes);
  const changes = {};
  for (const key of ["title", "category_id"]) {
    if (Object.hasOwn(patch.changes, key))
      changes[key] = readString(patch.changes[key], key);
  }
  return {
    id: readUuid(patch.id, "id"),
    baseRevision: readRevision(patch.baseRevision),
    changes,
    markdown: readString(patch.markdown, "본문"),
  };
}

/** @param {import("./post").DocumentPatch} value */
export function serializeDocumentPatch(value) {
  const patch = validatePatch(value);
  return serializeHeader({
    schema_version: 1,
    document_mode: "patch",
    id: patch.id,
    base_revision: patch.baseRevision,
    ...patch.changes,
  }, patch.markdown);
}

/**
 * @param {import("./post").ContentDocument} original
 * @param {import("./post").DocumentPatch} value
 * @returns {import("./post").ContentDocument}
 */
export function mergeDocumentPatch(original, value, currentRevision) {
  const metadata = canonicalMetadata(original.metadata);
  const patch = validatePatch(value);
  if (metadata.id !== patch.id) throw new Error("수정본의 원본 ID가 다릅니다.");
  if (patch.baseRevision !== readRevision(currentRevision))
    throw new Error("원본 revision이 바뀌었습니다.");
  const bodyChanged = original.markdown !== patch.markdown;
  const metadataChanged = Object.entries(patch.changes).some(
    ([key, value]) => metadata[key] !== value,
  );
  return {
    metadata: {
      ...metadata,
      ...patch.changes,
      ...(bodyChanged ? { review_status: "needs_review" } : {}),
      ...(bodyChanged || metadataChanged
        ? { updated: new Date().toISOString() }
        : {}),
    },
    markdown: patch.markdown,
  };
}

export function canonicalFilename(title) {
  let stem = readString(title, "제목")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f-\u009f]/g, "_")
    .replace(/[. ]+$/, "");
  if (!stem) stem = "제목 없음";
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem))
    stem = "_" + stem;
  const encoder = new TextEncoder();
  let filename = "";
  let bytes = 3; // The .md extension counts toward the portable filename limit.
  for (const point of stem) {
    const size = encoder.encode(point).length;
    if (bytes + size > 200) break;
    filename += point;
    bytes += size;
  }
  return filename.replace(/[. ]+$/, "") + ".md";
}
