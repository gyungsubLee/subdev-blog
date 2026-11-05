import Button from "../button/Button";
import { HOME_HREF } from "../../shared/routes";
import { site } from "../../config/site";
import "./layout.css";

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <a href={HOME_HREF} className="footer-wordmark">
        {site.name}.
      </a>
      <span>{site.footerDescription}</span>
      <Button
        type="button"
        onClick={() =>
          window.scrollTo({
            top: 0,
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
              .matches
              ? "instant"
              : "smooth",
          })
        }
      >
        맨 위로 ↑
      </Button>
    </footer>
  );
}
