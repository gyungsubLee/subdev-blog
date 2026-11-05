import Button from "../../components/button/Button";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import "./CategorySelectionDialog.css";

export type SelectableCategory = {
  id: string;
  name: string;
  parentId?: string | null;
  count?: number;
};

// Mount only while open so hidden trees do no work during editing or paging.
export default function CategorySelectionDialog({
  id,
  categories,
  value,
  allowEmpty = true,
  emptyLabel = "분류 없음",
  onConfirm,
  onClose,
}: {
  id: string;
  categories: readonly SelectableCategory[];
  value: string;
  allowEmpty?: boolean;
  emptyLabel?: string;
  onConfirm: (categoryId: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(value);
  const [expandedIds, setExpandedIds] = useState(() => new Set<string>());

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    // Native dialogs leave the top layer on removal. Effect cleanup must not
    // close the dialog during StrictMode's setup/cleanup/setup cycle.
  }, []);

  function cancel() {
    // Close before unmounting so the browser restores the trigger's focus.
    dialog.current?.close();
    onClose();
  }

  function confirmSelection(categoryId: string) {
    dialog.current?.close();
    onConfirm(categoryId);
  }

  function categoryRows(parentId: string | null, depth = 0): ReactNode {
    return categories
      .filter((category) => (category.parentId ?? null) === parentId)
      .map((category) => {
        const hasChildren = categories.some(
          (child) => child.parentId === category.id,
        );
        const expanded = expandedIds.has(category.id);
        return (
          <div className="category-branch" key={category.id}>
            <div
              className={
                "category-row" + (pending === category.id ? " selected" : "")
              }
              data-id={category.id}
              onDoubleClick={(event) => {
                if (
                  event.target instanceof Element &&
                  event.target.closest("button.expander")
                )
                  return;
                confirmSelection(category.id);
              }}
              style={{ "--depth": depth } as CSSProperties}
            >
              <Button
                type="button"
                className="expander"
                disabled={!hasChildren}
                aria-expanded={hasChildren ? expanded : undefined}
                aria-label={category.name + (expanded ? " 접기" : " 펼치기")}
                onClick={() =>
                  setExpandedIds((previous) => {
                    const next = new Set(previous);
                    if (next.has(category.id)) next.delete(category.id);
                    else next.add(category.id);
                    return next;
                  })
                }
              >
                {hasChildren ? (expanded ? "⌄" : "›") : "·"}
              </Button>
              <span className="grip" aria-hidden="true">
                ≡
              </span>
              <Button
                type="button"
                className="row-name"
                aria-pressed={pending === category.id}
                onClick={() => setPending(category.id)}
              >
                {category.name}
                <span className="inline-count">
                  ({(category.count ?? 0).toLocaleString()})
                </span>
              </Button>
            </div>
            {hasChildren && expanded && categoryRows(category.id, depth + 1)}
          </div>
        );
      });
  }

  return (
    <dialog
      id={id}
      ref={dialog}
      className="category-selection-dialog"
      aria-label="분류 선택"
      onCancel={(event) => {
        event.preventDefault();
        cancel();
      }}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          confirmSelection(pending);
        }}
      >
        <h2>분류 선택</h2>
        <div
          className="category-selection-tree"
          role="group"
          aria-label="글 분류"
        >
          {allowEmpty ? (
            <div
              className={"category-row" + (!pending ? " selected" : "")}
              style={{ "--depth": 0 } as CSSProperties}
              data-id=""
              onDoubleClick={() => confirmSelection("")}
            >
              <span className="expander" aria-hidden="true">
                ·
              </span>
              <span className="grip" aria-hidden="true">
                ≡
              </span>
              <Button
                type="button"
                className="row-name"
                aria-pressed={!pending}
                onClick={() => setPending("")}
              >
                {emptyLabel}
              </Button>
            </div>
          ) : null}
          {categoryRows(null)}
        </div>
        <div className="category-selection-actions">
          <Button type="button" onClick={cancel}>
            취소
          </Button>
          <Button type="submit">선택 완료</Button>
        </div>
      </form>
    </dialog>
  );
}
