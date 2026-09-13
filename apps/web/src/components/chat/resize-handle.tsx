"use client";

// Tap-vs-drag resize control — design.md §3.3.4 "assistant bar / sheet
// resizing". One pointer surface does both: a press that moves less than
// TAP_SLOP_PX is a tap (cycles sizes); anything further is a drag.
//
// Two drag modes:
//  - self-managed (onResize): the handle stays mounted for the whole drag
//    (the sheet's top-edge strip) and streams the pointer's clientY.
//  - external takeover (onDragStart): fired once when the slop is crossed,
//    for handles whose element may UNMOUNT mid-drag — the bar's control
//    hands off to window-level listeners in the panel (the sheet form
//    replaces the bar), which own the rest of the gesture.
// Pointer capture keeps a self-managed drag alive outside the element;
// touch-none keeps touch drags from scrolling the reader behind the sheet.
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TAP_SLOP_PX = 8;

export const SHEET_HEIGHT_MIN_VH = 30;
export const SHEET_HEIGHT_MAX_VH = 90;

export function ResizeHandle({
  onTap,
  onResize,
  onDragStart,
  ariaLabel,
  title,
  className,
  children,
}: {
  onTap: () => void;
  /** Self-managed mode: continuous resize, receives the pointer's clientY. */
  onResize?: (clientY: number) => void;
  /** External-takeover mode: fired once at drag start (see header). */
  onDragStart?: (clientY: number) => void;
  ariaLabel: string;
  title?: string;
  className?: string;
  children?: ReactNode;
}) {
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const draggingRef = useRef(false);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    startRef.current = { x: e.clientX, y: e.clientY };
    draggingRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = startRef.current;
    if (!start) return;
    if (!draggingRef.current) {
      if (Math.abs(e.clientX - start.x) < TAP_SLOP_PX && Math.abs(e.clientY - start.y) < TAP_SLOP_PX) {
        return; // still within tap slop — not a drag yet
      }
      draggingRef.current = true;
      if (onDragStart) {
        onDragStart(e.clientY); // hand off — the panel owns the drag from here
        return;
      }
    }
    if (onDragStart) return; // already taken over
    onResize?.(e.clientY);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture already released
    }
    const wasDrag = draggingRef.current;
    draggingRef.current = false;
    startRef.current = null;
    if (!wasDrag) onTap();
  };

  const onPointerCancel = () => {
    draggingRef.current = false;
    startRef.current = null;
  };

  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onTap(); // keyboard path — no drag equivalent, tap cycles
        }
      }}
      className={cn("cursor-ns-resize touch-none select-none", className)}
    >
      {children}
    </button>
  );
}
