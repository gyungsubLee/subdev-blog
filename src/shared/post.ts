export type Post = {
  id: string;
  title: string;
  parentId: string | null;
  category: string;
  createdAt: string;
  updatedAt: string;
  markdown: string;
  path: string;
  url: string;
  excerpt: string;
  cover?: string | null;
  draft?: boolean;
  bodyLoaded?: boolean;
};
