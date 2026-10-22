import { useEffect, useRef, type ReactNode } from "react";
import "./SiteDialog.css";

type SiteDialogProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export default function SiteDialog({
  open,
  title,
  onClose,
  children,
}: SiteDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [open]);

  return (
    <dialog
      className="site-dialog"
      ref={dialogRef}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
    >
      <div className="dialog-topline">
        <h2>{title}</h2>
        <button type="button" aria-label="창 닫기" onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
