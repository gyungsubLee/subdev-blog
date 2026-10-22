import type { RecordsView } from "../../features/post-category/useRecordsBrowser";

export default function RecordViewIcon({ view }: { view: RecordsView }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {view === "sidebar" ? (
        <>
          <rect x="3" y="3" width="18" height="18" />
          <path d="M9 3v18M5.5 7h1M5.5 11h1M5.5 15h1" />
        </>
      ) : view === "tabs" ? (
        <>
          <rect x="3" y="3" width="18" height="18" />
          <path d="M3 9h18M9 9v12M15 9v12" />
        </>
      ) : (
        <>
          <path d="m3 4 2 2-2 2M9 6h12m-18 5 2 2-2 2m6-2h12m-18 5 2 2-2 2m6-2h12" />
        </>
      )}
    </svg>
  );
}
