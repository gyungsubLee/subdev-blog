import { useState } from "react";
import { PAGE_SIZE } from "./config";

export function usePostPagination() {
  const [limit, setLimit] = useState(PAGE_SIZE);

  function reset() {
    setLimit(PAGE_SIZE);
  }

  function showMore() {
    setLimit((value) => value + PAGE_SIZE);
  }

  return { limit, reset, showMore };
}
