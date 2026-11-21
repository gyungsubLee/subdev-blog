import { useEffect, useRef } from 'react';
import Button from '../../components/button/Button';
import './delete-dialog.css';

export default function PostTitleDialog({ title, onClose }: { title: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  function close() {
    dialog.current?.close();
    onClose();
  }
  return <dialog ref={dialog} className="content-delete-dialog" aria-labelledby="post-title-heading"
    onCancel={event => { event.preventDefault(); close(); }}>
    <div className="modal-body">
      <h2 id="post-title-heading">원본 제목</h2>
      <p>{title || '제목 없음'}</p>
    </div>
    <div className="modal-footer">
      <Button type="button" className="outline-button" autoFocus onClick={close}>닫기</Button>
    </div>
  </dialog>;
}
