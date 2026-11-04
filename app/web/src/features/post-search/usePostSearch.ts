import { useEffect, useRef, useState } from "react";
import type { Post } from "../../shared/post";

export function usePostSearch(enabled = true) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const words = query.toLocaleLowerCase().trim();

  useEffect(() => {
    if (!enabled) return;
    function keyboard(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        target.isContentEditable ||
        /INPUT|TEXTAREA|SELECT/.test(target.tagName)
      )
        return;
      if (event.key === "/") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [enabled]);

  function matches(post: Post) {
    return (
      !words ||
      (post.title + " " + post.excerpt + " " + post.markdown)
        .toLocaleLowerCase()
        .includes(words)
    );
  }

  return { query, words, inputRef, setQuery, matches };
}
