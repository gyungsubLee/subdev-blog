import {
  Children,
  isValidElement,
  useRef,
  useState,
  type ReactNode,
} from "react";

export default function MarkdownCodeBlock({ children }: { children?: ReactNode }) {
  const pre = useRef<HTMLPreElement>(null);
  const [message, setMessage] = useState("복사");
  const code = Children.toArray(children).find((child) =>
    isValidElement(child),
  );
  const language = isValidElement<{ className?: string }>(code)
    ? code.props.className?.replace("language-", "") || "코드"
    : "코드";
  async function copy() {
    try {
      await navigator.clipboard.writeText(pre.current?.textContent || "");
      setMessage("복사함");
    } catch {
      setMessage("복사 실패");
    }
    window.setTimeout(() => setMessage("복사"), 2000);
  }
  return (
    <figure className="article-code">
      <figcaption>
        <span>{language}</span>
        <button type="button" onClick={copy} aria-live="polite">
          {message}
        </button>
      </figcaption>
      <pre ref={pre}>{children}</pre>
    </figure>
  );
}
