export const HOME_HREF = "#/";
export const RECORDS_HREF = "#/records";
export const CATEGORIES_HREF = "#/categories";

export function postHref(id: string, fragment?: string) {
  return "#/post/" + id + (fragment ? "#" + fragment : "");
}

export function postIdFromHash(hash: string) {
  return hash.match(/^#\/post\/([^/?#]+)/)?.[1];
}
