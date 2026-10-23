export type Post = {
  id: string;
  title: string;
  parentId: string | null;
  category: string;
  categoryId?: string;
  createdAt: string;
  updatedAt: string;
  markdown: string;
  path: string;
  url: string;
  excerpt: string;
  cover?: string | null;
  icon?: string | null;
  order?: number;
  revision?: string;
  draft?: boolean;
  bodyLoaded?: boolean;
};

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type PublicCategory = {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  sources: string[];
};

export type CanonicalDocumentId = string;
export type LocalDraftId = `draft-${string}`;

export type ContentMetadata = {
  [key: string]: JsonValue | undefined;
  schema_version: 1;
  id: CanonicalDocumentId;
  title: string;
  parent_id: CanonicalDocumentId | null;
  category_id?: string;
  order: number;
  kind: "article" | "troubleshooting" | "concept" | "reference" | "synthesis";
  summary: string;
  tags: string[];
  aliases: string[];
  related_ids: CanonicalDocumentId[];
  source_ids: CanonicalDocumentId[];
  source_url?: string;
  review_status: "unreviewed" | "reviewed" | "needs_review";
  created: string;
  updated: string;
  cover?: string | null;
  icon?: string | null;
  legacy_path?: string;
  legacy_category?: string;
};

export type LegacyMetadata = { [key: string]: JsonValue };

export type ContentDocument = {
  metadata: ContentMetadata;
  markdown: string;
};

export type DocumentPatch = {
  id: CanonicalDocumentId;
  baseRevision: string;
  changes: { title?: string; category_id?: string };
  markdown: string;
};

export type ParsedDocument =
  | (ContentDocument & { documentMode: "full"; baseRevision?: string })
  | { documentMode: "patch"; patch: DocumentPatch }
  | { documentMode: "legacy"; metadata: LegacyMetadata; markdown: string };

// The local storage key and canonical identity have different lifetimes.
export type DraftDocumentIdentity = {
  id: LocalDraftId;
  documentId: CanonicalDocumentId;
};
