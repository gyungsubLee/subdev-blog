import type { ContentDocument, EditorDocument, JsonValue } from "../../shared/post";

export type ManagementSession = {
  state: "signed_out" | "checking" | "ready" | "blocked";
  user?: { id: number; login: string };
  csrfToken?: string;
  error?: string;
  connection?: {
    repository: string;
    branch: string;
    contentCommit?: string;
    appContentCommit?: string;
    appCommit?: string;
  };
};

export type CanonicalCategory = {
  [key: string]: JsonValue | undefined;
  id: string;
  name: string;
  parent_id: string | null;
  order: number;
  sources: string[];
};

export type SourceDocument = {
  pendingCategories?: CanonicalCategory[];
  document: ContentDocument;
  editor?: EditorDocument | null;
  editorRevision?: string | null;
  editorError?: string;
  editorRaw?: string;
  filename?: string;
  revision: string | null;
  contentCommit: string;
  categories: CanonicalCategory[];
  assets: { name: string; sha: string; size: number }[];
};

export type Publication = {
  background?: boolean;
  publicationPending?: boolean;
  affectedPostIds?: string[];
  deletedPostIds?: string[];
  requestId: string;
  state: "validating" | "saved" | "pending" | "published" | "failed" | "superseded" | "unchanged";
  candidateCommit?: string;
  contentCommit?: string;
  publicCommit?: string;
  baseCommit?: string;
  runId?: number;
  runUrl?: string;
  commitUrl?: string;
  error?: string;
};
