import "./post-pagination.css";

export default function PostLoadMore({
  limit,
  total,
  onLoadMore,
}: {
  limit: number;
  total: number;
  onLoadMore: () => void;
}) {
  if (total <= limit) return null;
  return (
    <div className="load-more">
      <button className="outline-button" type="button" onClick={onLoadMore}>
        더 보기 <span aria-hidden="true">↓</span>
      </button>
      <span>
        {Math.min(limit, total)} / {total}
      </span>
    </div>
  );
}
