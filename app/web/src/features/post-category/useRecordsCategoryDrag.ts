import { useEffect, useRef, useState, type RefObject } from "react";
import {
  moveCategoryNode,
  projectCategoryDrop,
  type CategoryDrop,
  type CategoryNode,
} from "./hierarchy";

type Preview = { nodes: CategoryNode[]; id: string; parentId: string | null };
type Drag = {
  id: string;
  pointerId: number;
  nav: HTMLElement;
  tags: boolean;
  x: number;
  y: number;
  active: boolean;
  moved: boolean;
  timer: number;
  frame: number;
  destination: CategoryDrop | null;
  cached: CategoryDrop | null;
  anchor: { left: number; right: number; top: number; bottom: number } | null;
  ghost: HTMLElement | null;
};

// Records use projected placement; the explicit-save manager keeps its existing drag contract.
export function useRecordsCategoryDrag(
  root: RefObject<HTMLDivElement | null>,
  nodes: CategoryNode[],
  onMove: (id: string, destination: CategoryDrop) => boolean,
) {
  const latest = useRef({ nodes, onMove });
  latest.current = { nodes, onMove };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropped, setDropped] = useState<string | null>(null);
  const suppressClick = useRef(false);
  const cancelRef = useRef(() => {});

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let drag: Drag | null = null;
    let feedbackTimer = 0;
    let clickTimer = 0;
    function finish(cancelled = true) {
      const current = drag;
      if (!current) return;
      drag = null;
      window.clearTimeout(current.timer);
      window.cancelAnimationFrame(current.frame);
      current.ghost?.remove();
      element!.classList.remove("category-moving");
      setPreview(null);
      setActiveId(null);
      if (!current.active) return;
      suppressClick.current = true;
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => {
        suppressClick.current = false;
      }, 350);
      if (
        !cancelled &&
        current.destination &&
        latest.current.onMove(current.id, current.destination) &&
        !current.tags
      ) {
        setDropped(current.id);
        window.clearTimeout(feedbackTimer);
        feedbackTimer = window.setTimeout(() => setDropped(null), 700);
      }
    }
    cancelRef.current = () => finish();
    function down(event: PointerEvent) {
      if (event.button !== 0 || event.isPrimary === false) return;
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>("[data-record-category]")
          : null;
      const nav = target?.closest<HTMLElement>(".records-category-nav");
      const id = target?.dataset.recordCategory;
      if (!id || !nav || !element!.contains(nav)) {
        finish();
        return;
      }
      if (drag?.active && drag.id === id) {
        drag.pointerId = event.pointerId;
        drag.x = event.clientX;
        drag.y = event.clientY;
        drag.moved = false;
        event.preventDefault();
        return;
      }
      finish();
      const current: Drag = {
        id,
        nav,
        tags: nav.dataset.view === "tags",
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        active: false,
        moved: false,
        timer: 0,
        frame: 0,
        destination: null,
        cached: null,
        anchor: null,
        ghost: null,
      };
      drag = current;
      current.timer = window.setTimeout(() => {
        if (drag !== current) return;
        current.active = true;
        setActiveId(current.id);
        suppressClick.current = true;
        element!.classList.add("category-moving");
        if (!current.tags) {
          current.ghost = document.createElement("div");
          current.ghost.className = "records-drag-ghost";
          const label = document.createElement("span");
          label.textContent =
            latest.current.nodes.find((node) => node.id === id)?.name ?? "";
          const count = document.createElement("span");
          count.textContent =
            target?.querySelector(".records-count")?.textContent ?? "0";
          current.ghost.append(label, count);
          current.ghost.setAttribute("aria-hidden", "true");
          nav.append(current.ghost);
          positionGhost(current, current.x, current.y);
        }
      }, 600);
    }
    function positionGhost(current: Drag, x: number, y: number) {
      if (!current.ghost) return;
      window.cancelAnimationFrame(current.frame);
      current.frame = window.requestAnimationFrame(() => {
        if (!current.ghost) return;
        const left = Math.max(
          8,
          Math.min(x + 16, window.innerWidth - current.ghost.offsetWidth - 8),
        );
        const top = Math.max(
          8,
          Math.min(y + 8, window.innerHeight - current.ghost.offsetHeight - 8),
        );
        current.ghost.style.transform = `translate(${left}px, ${top}px)`;
      });
    }
    function move(event: PointerEvent) {
      const current = drag;
      if (!current || current.pointerId !== event.pointerId) return;
      const { clientX: x, clientY: y } = event;
      const distance = Math.hypot(x - current.x, y - current.y);
      if (!current.active) {
        if (distance > 6) finish();
        return;
      }
      event.preventDefault();
      positionGhost(current, x, y);
      if (distance > 6) current.moved = true;
      if (!current.moved) return;
      const hit = document.elementFromPoint(x, y);
      const target = hit?.closest<HTMLElement>(
        "[data-record-category], [data-record-all]",
      );
      const inNav = hit?.closest(".records-category-nav") === current.nav;
      if (!target && current.tags && current.cached && inNav) {
        // Retain the same projected DOM across tag gaps; a gap never permits a drop.
        current.destination = null;
        current.anchor = null;
        return;
      }
      if (!target || !inNav) {
        current.destination = current.cached = null;
        current.anchor = null;
        setPreview(null);
        return;
      }
      if (target.dataset.recordCategory === current.id && current.cached) {
        current.destination = current.cached;
        return;
      }
      const anchor = current.anchor;
      if (
        anchor &&
        x >= anchor.left &&
        x <= anchor.right &&
        y >= anchor.top &&
        y <= anchor.bottom
      ) {
        current.destination = current.cached;
        return;
      }
      const original = latest.current.nodes;
      const rect = target.getBoundingClientRect();
      const ratio = current.tags
        ? (x - rect.left) / rect.width
        : (y - rect.top) / rect.height;
      const position =
        ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "inside";
      let destination: CategoryDrop | null;
      if (target.hasAttribute("data-record-all")) {
        destination = {
          parentId: null,
          beforeId: null,
          position: "after",
          depth: 0,
        };
      } else {
        const targetId = target.dataset.recordCategory!;
        let depth = 0;
        let parent = original.find((node) => node.id === targetId)?.parentId;
        while (parent) {
          depth++;
          parent = original.find((node) => node.id === parent)?.parentId;
        }
        destination = projectCategoryDrop(
          original,
          current.id,
          targetId,
          position === "before" ? "before" : "after",
          depth + (position === "inside" ? 1 : 0),
        );
      }
      if (!destination) {
        current.destination = current.cached = null;
        current.anchor = null;
        setPreview(null);
        return;
      }
      const same =
        current.cached?.parentId === destination.parentId &&
        current.cached?.beforeId === destination.beforeId;
      current.destination = destination;
      if (same) return;
      try {
        const projected = moveCategoryNode(
          original,
          current.id,
          destination.parentId,
          destination.beforeId,
        );
        current.cached = destination;
        const start =
          position === "before" ? 0 : position === "inside" ? 0.25 : 0.75;
        const end =
          position === "before" ? 0.25 : position === "inside" ? 0.75 : 1;
        current.anchor = {
          left: rect.left + (current.tags ? rect.width * start : 0),
          right: current.tags ? rect.left + rect.width * end : rect.right,
          top: rect.top + (current.tags ? 0 : rect.height * start),
          bottom: current.tags ? rect.bottom : rect.top + rect.height * end,
        };
        setPreview({
          nodes: projected,
          id: current.id,
          parentId: destination.parentId,
        });
      } catch {
        current.destination = current.cached = null;
        current.anchor = null;
        setPreview(null);
      }
    }
    function up(event: PointerEvent) {
      if (!drag || drag.pointerId !== event.pointerId) return;
      // A completed hold can remain armed for the subsequent drag, as in the approved mock.
      if (drag.active && !drag.moved) return;
      finish(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (drag?.active) {
          event.preventDefault();
          event.stopPropagation();
        }
        finish();
      }
    }
    function click(event: MouseEvent) {
      if (
        suppressClick.current &&
        event.target instanceof Element &&
        event.target.closest("[data-record-category]")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    function preventNativeDrag(event: DragEvent) {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-record-category]")
      ) {
        event.preventDefault();
      }
    }
    const cancel = () => finish();
    document.addEventListener("pointerdown", down);
    element.addEventListener("click", click, true);
    element.addEventListener("dragstart", preventNativeDrag);
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("blur", cancel);
    return () => {
      finish();
      window.clearTimeout(feedbackTimer);
      window.clearTimeout(clickTimer);
      suppressClick.current = false;
      document.removeEventListener("pointerdown", down);
      element.removeEventListener("click", click, true);
      element.removeEventListener("dragstart", preventNativeDrag);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("blur", cancel);
    };
  }, [root]);
  return { preview, activeId, dropped, cancel: () => cancelRef.current() };
}
