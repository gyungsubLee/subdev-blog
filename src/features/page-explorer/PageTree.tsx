import { postHref } from "../../shared/routes";
import { useState, type ReactNode } from "react";
import type { Post } from "../../shared/post";
import "./page-explorer.css";

export default function PageTree({ posts, onClose }: { posts: Post[]; onClose: () => void }) {
  const orderedPosts = [...posts].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id),
  );
  const ids = new Set(posts.map((post) => post.id));
  const roots = orderedPosts.filter(
    (post) => !post.parentId || !ids.has(post.parentId),
  );
  const childrenByParent = new Map<string | null, Post[]>();
  for (const post of orderedPosts) {
    const children = childrenByParent.get(post.parentId) || [];
    children.push(post);
    childrenByParent.set(post.parentId, children);
  }
  const [openIds, setOpenIds] = useState(
    () => new Set(roots.map((post) => post.id)),
  );

  function branch(post: Post, ancestors: Set<string>): ReactNode {
    if (ancestors.has(post.id)) return null;
    const children = childrenByParent.get(post.id) || [];
    const next = new Set([...ancestors, post.id]);
    const link = (
      <a href={postHref(post.id)} onClick={onClose}>
        <span aria-hidden="true">{children.length ? "▧" : "▤"}</span>
        {post.title}
        {post.draft ? <small>초안</small> : null}
      </a>
    );
    if (!children.length) return <li key={post.id}>{link}</li>;
    const isOpen = openIds.has(post.id);
    return (
      <li key={post.id}>
        <details
          open={isOpen}
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setOpenIds((current) => {
              if (current.has(post.id) === open) return current;
              const updated = new Set(current);
              if (open) updated.add(post.id);
              else updated.delete(post.id);
              return updated;
            });
          }}
        >
          <summary>{link}</summary>
          {isOpen ? (
            <ul>{children.map((child) => branch(child, next))}</ul>
          ) : null}
        </details>
      </li>
    );
  }
  return (
    <ul className="page-tree">
      {roots.map((post) => branch(post, new Set()))}
    </ul>
  );
}
