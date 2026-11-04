import "./post-pagination.css";

export default function PostResultCount({
  query,
  count,
}: {
  query: string;
  count: number;
}) {
  return (
    <p className="result-count" role="status">
      {query.trim() ? "“" + query + "” 검색 결과 " : ""}
      {count}개의 기록
    </p>
  );
}
