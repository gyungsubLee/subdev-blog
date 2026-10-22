import { HOME_HREF } from "../../shared/routes";
import Wordmark from "./Wordmark";
import "./layout.css";

type SiteHeaderProps = {
  isHome: boolean;
  onExplore: () => void;
  onAbout: () => void;
  onWrite: () => void;
};

export default function SiteHeader({
  isHome,
  onExplore,
  onAbout,
  onWrite,
}: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Wordmark />
      <nav className="header-navigation" aria-label="주 메뉴">
        <a href={HOME_HREF} aria-current={isHome ? "page" : undefined}>
          기록
        </a>
        <button type="button" onClick={onExplore}>
          페이지 탐색
        </button>
        <button type="button" onClick={onAbout}>
          소개
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
