import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Post } from "../../shared/post";
import MarkdownCodeBlock from "./MarkdownCodeBlock";
import { pageLink, scrollToFragment } from "./page-links";

const markdownSchema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, src: ["http", "https", "data"] },
};

export default function MarkdownContent({
  body,
  post,
  posts,
}: {
  body: string;
  post: Post;
  posts: Post[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSchema]]}
      urlTransform={(url, key, node) =>
        key === "src" &&
        node.tagName === "img" &&
        /^data:image\/(?:png|jpeg|gif|webp|avif);base64,[a-z\d+/=]+$/i.test(
          url,
        )
          ? url
          : defaultUrlTransform(url)
      }
      components={{
        h1: ({ node, children }) => (
          <h1 id={"heading-" + node?.position?.start.line}>
            {children}
          </h1>
        ),
        h2: ({ node, children }) => (
          <h2 id={"heading-" + node?.position?.start.line}>
            {children}
          </h2>
        ),
        h3: ({ node, children }) => (
          <h3 id={"heading-" + node?.position?.start.line}>
            {children}
          </h3>
        ),
        pre: ({ children }) => <MarkdownCodeBlock>{children}</MarkdownCodeBlock>,
        a: ({ href, id, children }) => {
          if (!href) return <a id={id}>{children}</a>;
          const url = pageLink(href || "", post, posts);
          if (url.startsWith("#") && !url.startsWith("#/")) {
            return (
              <a
                href={url}
                onClick={(event) => {
                  event.preventDefault();
                  scrollToFragment(url.slice(1));
                }}
              >
                {children}
              </a>
            );
          }
          return (
            <a
              href={url}
              target={/^https?:/.test(url) ? "_blank" : undefined}
              rel={/^https?:/.test(url) ? "noreferrer" : undefined}
            >
              {children}
            </a>
          );
        },
        img: ({ src, alt }) =>
          src ? (
            <img src={src} alt={alt || ""} loading="lazy" />
          ) : alt ? (
            <span className="missing-image">{alt}</span>
          ) : null,
        table: ({ children }) => (
          <div className="table-scroll">
            <table>{children}</table>
          </div>
        ),
      }}
    >
      {body}
    </ReactMarkdown>
  );
}
