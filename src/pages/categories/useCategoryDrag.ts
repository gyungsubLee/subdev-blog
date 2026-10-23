import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  categoryDescendants,
  projectCategoryDrop,
  type CategoryDrop,
  type CategoryNode,
} from "../../features/post-category/hierarchy";

type DragState = {
  id: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  depth: number;
  active: boolean;
  destination: CategoryDrop | null;
  frame: number;
};

export function useCategoryDrag(
  nodes: CategoryNode[],
  disabled: boolean,
  onMove: (id: string, destination: CategoryDrop) => void,
) {
  const pageRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const hintRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const moveRef = useRef(onMove);
  useEffect(() => {
    moveRef.current = onMove;
  }, [onMove]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    function finish(cancelled = false) {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      window.cancelAnimationFrame(current.frame);
      page!.classList.remove("dragging");
      page!.querySelector(".drag-source")?.classList.remove("drag-source");
      if (ghostRef.current) ghostRef.current.hidden = true;
      if (lineRef.current) lineRef.current.hidden = true;
      if (hintRef.current) hintRef.current.hidden = true;
      if (current.active && current.destination && !cancelled)
        moveRef.current(current.id, current.destination);
    }
    function preview() {
      const current = drag.current;
      const ghost = ghostRef.current;
      const line = lineRef.current;
      const hint = hintRef.current;
      const frame = page!.querySelector(".tree-frame")?.getBoundingClientRect();
      const root = page!.querySelector(".all-row")?.getBoundingClientRect();
      if (!current?.active || !ghost || !line || !hint || !frame || !root)
        return;
      const { x, y, id } = current;
      ghost.style.left = `${Math.min(x + 18, window.innerWidth - 310)}px`;
      ghost.style.top = `${y + 14}px`;
      const rows = [...page!.querySelectorAll<HTMLElement>(".category-row")];
      const target = rows.find((row) => {
        const rect = row.getBoundingClientRect();
        return y >= rect.top && y <= rect.bottom;
      });
      const indent = window.matchMedia("(max-width:600px)").matches ? 18 : 36;
      let destination: CategoryDrop | null = null;
      if (x >= frame.left && x <= frame.right) {
        if (y >= root.top && y <= root.bottom) {
          destination = {
            parentId: null,
            beforeId:
              nodes.find((node) => node.parentId === null && node.id !== id)
                ?.id ?? null,
            position: "before",
            depth: 0,
          };
        } else if (target) {
          const rect = target.getBoundingClientRect();
          destination = projectCategoryDrop(
            nodes,
            id,
            target.dataset.id!,
            y < rect.top + rect.height / 2 ? "before" : "after",
            current.depth + Math.round((x - current.startX) / indent),
          );
        }
      }
      current.destination = destination;
      line.hidden = hint.hidden = !destination;
      if (!destination) return;
      const branch = categoryDescendants(nodes, id);
      const remaining = rows.filter((row) => !branch.has(row.dataset.id!));
      let lineY = destination.beforeId
        ? remaining
            .find((row) => row.dataset.id === destination.beforeId)
            ?.getBoundingClientRect().top
        : undefined;
      if (lineY === undefined) {
        const parentBranch =
          destination.parentId === null
            ? new Set(remaining.map((row) => row.dataset.id!))
            : categoryDescendants(nodes, destination.parentId);
        lineY =
          remaining
            .filter((row) => parentBranch.has(row.dataset.id!))
            .at(-1)
            ?.getBoundingClientRect().bottom ?? root.bottom;
      }
      line.style.left = `${frame.left + 10 + destination.depth * indent}px`;
      line.style.width = `${Math.max(25, frame.width - 20 - destination.depth * indent)}px`;
      line.style.top = `${lineY - 1}px`;
      const parent = nodes.find((node) => node.id === destination.parentId);
      hint.textContent = `${destination.depth + 1}단계 · ${parent?.name ?? "최상위"}${destination.position === "inside" ? " 아래로 이동" : " · 순서 변경"}`;
      hint.style.left = `${Math.min(x + 18, window.innerWidth - 350)}px`;
      hint.style.top = `${Math.min(y + 65, window.innerHeight - 40)}px`;
    }
    function scroll() {
      const current = drag.current;
      if (!current?.active) return;
      if (current.y > window.innerHeight - 65) window.scrollBy(0, 13);
      else if (current.y < 65) window.scrollBy(0, -13);
      preview();
      current.frame = window.requestAnimationFrame(scroll);
    }
    function pointerMove(event: PointerEvent) {
      const current = drag.current;
      if (!current) return;
      current.x = event.clientX;
      current.y = event.clientY;
      if (
        !current.active &&
        Math.hypot(current.x - current.startX, current.y - current.startY) > 5
      ) {
        current.active = true;
        page!.classList.add("dragging");
        [...page!.querySelectorAll<HTMLElement>(".category-row")]
          .find((row) => row.dataset.id === current.id)
          ?.classList.add("drag-source");
        if (ghostRef.current) {
          ghostRef.current.textContent = `≡　${nodes.find((node) => node.id === current.id)?.name}`;
          ghostRef.current.hidden = false;
        }
        scroll();
      }
      preview();
    }
    const pointerUp = () => finish();
    const cancel = () => finish(true);
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("pointermove", pointerMove);
    document.addEventListener("pointerup", pointerUp);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      document.removeEventListener("pointermove", pointerMove);
      document.removeEventListener("pointerup", pointerUp);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
    };
  }, [nodes]);

  function start(
    event: ReactPointerEvent<HTMLButtonElement>,
    node: CategoryNode,
    depth: number,
  ) {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    drag.current = {
      id: node.id,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      depth,
      active: false,
      destination: null,
      frame: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  return { pageRef, ghostRef, lineRef, hintRef, start };
}
