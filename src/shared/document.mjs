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

export function parseMarkdownDocument(text) {
  const metadata = {};
  let markdown = text.replace(/^\uFEFF/, "");
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (
    frontmatter &&
    /^(title|category|id|source_id|created|updated):/m.test(frontmatter[1])
  ) {
    for (const line of frontmatter[1].split(/\r?\n/)) {
      const field = line.match(
        /^(title|category|id|source_id|created|updated):\s*(.*)$/,
      );
      if (!field) continue;
      let value = field[2];
      try {
        value = JSON.parse(value);
      } catch {
        /* Plain scalar frontmatter is also accepted. */
      }
      metadata[field[1]] = readString(value, field[1]);
    }
    markdown = markdown.slice(frontmatter[0].length);
  }
  const heading = markdown.match(/^\s*# ([^\r\n]+)(?:\r?\n|$)/);
  const title = metadata.title || heading?.[1].trim();
  if (heading && heading[1].trim() === title)
    markdown = markdown.slice(heading[0].length);
  return {
    title,
    category: metadata.category,
    id: metadata.id,
    sourceId: metadata.source_id,
    createdAt: metadata.created,
    updatedAt: metadata.updated,
    markdown,
  };
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
