import { HOME_HREF } from "../../shared/routes";
import { site } from "../../config/site";
import "./layout.css";

export default function Wordmark() {
  return (
    <a href={HOME_HREF} className="wordmark" aria-label={site.name + " 홈"}>
      <svg
        width="30"
        height="30"
        viewBox="0 0 30 30"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 7c5-2 8 0 11 3 3-3 6-5 11-3v17c-5-2-8 0-11 3-3-3-6-5-11-3V7Z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M15 10v17M8 11l3 1m-3 4 3 1m8-5 3-1m-3 6 3-1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span>
        {site.name}
        <span className="brand-period">.</span>
      </span>
    </a>
  );
}
