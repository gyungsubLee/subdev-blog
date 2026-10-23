import { CATEGORIES_HREF, RECORDS_HREF } from "../../shared/routes";
import Wordmark from "./Wordmark";
import "./layout.css";

type SiteHeaderProps = {
  activeHref?: string;
  onExplore: () => void;
  onWrite: () => void;
};

export default function SiteHeader({
  activeHref,
  onExplore,
  onWrite,
}: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Wordmark />
      <nav className="header-navigation" aria-label="주 메뉴">
        <a
          href={RECORDS_HREF}
          aria-current={activeHref === RECORDS_HREF ? "page" : undefined}
        >
          기록 관리
        </a>
        <a
          href={CATEGORIES_HREF}
          aria-current={activeHref === CATEGORIES_HREF ? "page" : undefined}
        >
          카테고리 관리
        </a>
        <button type="button" onClick={onExplore}>
          페이지 탐색
        </button>
      </nav>
      <button
        className="dark-button header-write"
        type="button"
        onClick={onWrite}
      >
        글 쓰기 <span aria-hidden="true">↗</span>
      </button>
    </header>
  );
}
