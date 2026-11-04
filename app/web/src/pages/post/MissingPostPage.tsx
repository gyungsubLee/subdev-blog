import { HOME_HREF } from "../../shared/routes";
import Arrow from "../../components/icons/Arrow";
import "./PostPage.css";

export default function MissingPostPage() {
  return (
    <main id="main-content" className="missing-page" tabIndex={-1}>
      <span className="eyebrow">PAGE NOT FOUND</span>
      <h1>글을 찾지 못했습니다.</h1>
      <p>주소를 확인하거나 전체 글에서 다시 선택하십시오.</p>
      <a className="dark-button" href={HOME_HREF}>
        전체 글 보기 <Arrow />
      </a>
    </main>
  );
}
