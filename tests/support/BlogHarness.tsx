import type { ComponentProps } from "react";
import BlogView from "../../src/app/BlogView";
import { useHashRoute } from "../../src/app/useHashRoute";

export default function BlogHarness(
  props: Omit<ComponentProps<typeof BlogView>, "hash">,
) {
  const { hash } = useHashRoute();
  return <BlogView {...props} hash={hash} />;
}
