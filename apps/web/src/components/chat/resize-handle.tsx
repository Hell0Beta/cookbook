"use client";

// Tap-vs-drag resize control — design.md §3.3.4 "assistant bar / sheet
// resizing". One pointer surface does both: a press that moves less than
// TAP_SLOP_PX is a tap (cycles sizes), anything further is a drag that
// resizes the sheet continuously (the drag target is the pointer's height
// from the viewport bottom, clamped). Pointer capture keeps the drag alive
// outside the element; touch-none keeps touch drags from scrolling the
// reader behind the sheet.
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const TAP_SLOP_PX = 8;

export const SHEET_HEIGHT_MIN_VH = 30;
export const SHEET_HEIGHT_MAX_VH = 90;

/** Viewport height (%) a sheet should occupy to put its top edge at clientY. */
export function heightVhFromClientY(clientY: number): number {
  const vh = ((window.innerHeight - clientY) / window.innerHeight) * 100;
  return Math.min(SHEET_HEIGHT_MAX_VH, Math.max(SHEET_HEIGHT_MIN_VH, vh));
}

export function ResizeHandle({
  onTap,
  onResize,
  ariaLabel,
  title,
  className,
  children,
}: {
  onTap: () => void;
  onResize: (vh: number) => void;
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
    }
    onResize(heightVhFromClientY(e.clientY));
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
