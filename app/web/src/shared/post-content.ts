import type { Post } from "./post";

const dateFormat = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "날짜 없음" : dateFormat.format(date);
}

export function getBody(post: Post) {
  const body = post.markdown;
  const firstHeading = body.match(/^\s*# ([^\n]+)\r?\n/);
  return firstHeading?.[1].trim() === post.title.trim()
    ? body.replace(firstHeading[0], "")
    : body;
}
