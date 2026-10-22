import type { Post } from "../../shared/post";
import "./PostArt.css";

function NotebookArt({ variant = 0 }: { variant?: number }) {
  return (
    <svg
      className={"notebook-art art-" + variant}
      viewBox="0 0 600 360"
      fill="none"
      aria-hidden="true"
    >
      <path
        className="art-branch"
        d="M300 84v64M300 148H146v70M300 148h154v70M300 148v90"
      />
      <rect className="art-page" x="252" y="30" width="96" height="64" rx="5" />
      <rect
        className="art-page"
        x="92"
        y="215"
        width="108"
        height="90"
        rx="5"
        transform="rotate(-8 146 260)"
      />
      <rect
        className="art-page"
        x="246"
        y="231"
        width="108"
        height="90"
        rx="5"
        transform="rotate(5 300 276)"
      />
      <rect
        className="art-page"
        x="400"
        y="215"
        width="108"
        height="90"
        rx="5"
        transform="rotate(-4 454 260)"
      />
      <path
        className="art-rule"
        d="M273 52h40m-40 12h54m-54 12h30M113 240h52m-52 15h61m-61 15h41M268 256h51m-51 15h62m-62 15h40M422 240h51m-51 15h62m-62 15h40"
      />
      <circle className="art-dot" cx="300" cy="149" r="7" />
      <path
        className="art-spark"
        d="m493 62 9 20 21 5-21 8-9 21-7-21-21-8 21-5 7-20ZM79 105l5 12 13 4-13 5-5 13-4-13-12-5 12-4 4-12Z"
      />
    </svg>
  );
}

export default function PostArt({ post, variant = 0 }: { post: Post; variant?: number }) {
  const image =
    post.cover ||
    post.markdown.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/)?.[1];
  return (
    <div className={"post-art post-art-" + (variant % 3)}>
      {image ? (
        <img src={image} alt="" loading="lazy" />
      ) : (
        <NotebookArt variant={variant % 3} />
      )}
    </div>
  );
}
