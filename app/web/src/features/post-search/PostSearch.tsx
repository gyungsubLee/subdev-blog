import type { RefObject } from "react";
import "./post-search.css";

type PostSearchProps = {
  query: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (query: string) => void;
  onClear: () => void;
};

export default function PostSearch({
  query,
  inputRef,
  onChange,
  onClear,
}: PostSearchProps) {
  return (
    <label className="search-field">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          cx="10.5"
          cy="10.5"
          r="6.5"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="m16 16 4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">제목과 요약 검색</span>
      <input
        ref={inputRef}
        type="search"
        value={query}
        placeholder="기록 검색"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            onClear();
            inputRef.current?.blur();
          }
        }}
      />
      <kbd aria-hidden="true">/</kbd>
    </label>
  );
}
