export enum PostStatus {
  Draft = "draft",
  Published = "published",
}

export const POST_STATUS_LABELS = {
  [PostStatus.Draft]: "초안 저장",
  [PostStatus.Published]: "공개됨",
} satisfies Record<PostStatus, string>;

// Legacy review records and unrecognized external values remain private drafts.
export function normalizePostStatus(value: unknown): PostStatus {
  return value === PostStatus.Published ? PostStatus.Published : PostStatus.Draft;
}

export function postStatusLabel(value: unknown): string {
  return POST_STATUS_LABELS[normalizePostStatus(value)];
}
