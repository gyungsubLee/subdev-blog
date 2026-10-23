import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import "../../styles/notebook.css";
import type { Post } from "../../shared/post";
import MarkdownCodeBlock from "./MarkdownCodeBlock";
import { pageLink, scrollToFragment } from "./page-links";

const markdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), "u", "section"],
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    section: [["dataIvoryNotebook", "true"]],
  },
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
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeRaw,
        // Sanitize authored HTML before KaTeX generates MathML and inline styles.
        [rehypeSanitize, markdownSchema],
        [rehypeKatex, { trust: false, strict: "error" }],
      ]}
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
        section: ({ node, children }) =>
          node?.properties.dataIvoryNotebook === "true" ? (
            <section className="ivory-notebook" data-ivory-notebook="true">
              <span className="notebook-holes" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <div className="ivory-notebook-content">{children}</div>
            </section>
          ) : (
            <section>{children}</section>
          ),
        blockquote: ({ node, children, ...props }) => {
          let firstParagraph = "";
          let hasNestedQuote = false;
          const listLinks: string[] = [];

          function readContent(
            element: NonNullable<typeof node>,
            inList = false,
          ): string {
            if (element.tagName === "blockquote" && element !== node)
              hasNestedQuote = true;
            const text = element.children
              .map((child) => {
                if (child.type === "text") return child.value;
                if (child.type !== "element") return "";
                return readContent(
                  child,
                  inList || element.tagName === "ul" || element.tagName === "ol",
                );
              })
              .join("");

            if (element.tagName === "p" && !firstParagraph)
              firstParagraph = text.trim();
            if (
              inList &&
              element.tagName === "a" &&
              typeof element.properties.href === "string"
            )
              listLinks.push(element.properties.href);
            return text;
          }

          if (node) readContent(node);
          // ponytail: match the existing export format; other TOC formats need explicit metadata.
          const isToc =
            firstParagraph === "목차" &&
            !hasNestedQuote &&
            listLinks.length > 0 &&
            listLinks.every(
              (href) =>
                href.startsWith("#") &&
                !href.startsWith("#/") &&
                href.length > 1,
            );
          return (
            <blockquote {...props} className={isToc ? "article-toc" : undefined}>
              {children}
            </blockquote>
          );
        },
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
