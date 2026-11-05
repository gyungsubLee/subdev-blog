import Button from "../../components/button/Button";
import { useEffect, useRef } from "react";
import type { Post } from "../../shared/post";
import "./delete-dialog.css";

export default function PostDeleteDialog({ post, onClose, onConfirm }: {
  post: Post;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmed = useRef(false);

  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);

  function close() {
    dialog.current?.close();
    onClose();
  }

  function remove() {
    if (confirmed.current) return;
    confirmed.current = true;
    dialog.current?.close();
    onConfirm();
  }

  return (
    <dialog
      className="content-delete-dialog"
      ref={dialog}
      aria-labelledby="post-delete-title"
      aria-describedby="post-delete-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-body">
        <h2 id="post-delete-title">글 삭제</h2>
        <p>「{post.title || "제목 없음"}」 글을 삭제하시겠습니까?</p>
        <p id="post-delete-description">
          {post.draft
            ? "이 브라우저에 저장한 초안을 삭제합니다. 앱에서 되돌릴 수 없습니다."
            : "원본 글과 첨부 파일, 이 브라우저의 초안을 삭제합니다. 앱에서 되돌릴 수 없습니다."}
        </p>
      </div>
      <div className="modal-footer">
        <Button type="button" className="outline-button" onClick={close} autoFocus>취소</Button>
        <Button
          type="button"
          id="confirm-post-delete"
          className="dark-button"
          onClick={remove}
        >
          삭제 확정
        </Button>
      </div>
    </dialog>
  );
}
