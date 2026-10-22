import { postIdFromHash } from "../shared/routes";
import { useEffect, useState } from "react";

export function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    function change() {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    }

    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);

  return { hash, postId: postIdFromHash(hash) };
}
