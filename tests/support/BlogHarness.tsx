import type { ComponentProps } from "react";
import BlogView from "../../app/web/src/site/BlogView";
import { useHashRoute } from "../../app/web/src/site/useHashRoute";

export default function BlogHarness(
  props: Omit<ComponentProps<typeof BlogView>, "hash">,
) {
  const { hash } = useHashRoute();
  return <BlogView {...props} hash={hash} />;
}
