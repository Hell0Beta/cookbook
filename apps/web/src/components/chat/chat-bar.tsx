"use client";

// Collapsed assistant bar — design.md §3.3.4. Replaces the old round mic
// button: a rounded row docked bottom-right (sibling of the timer pill)
// carrying the expand/resize control (left), the live status or latest
// reply snippet (middle — tap opens the sheet, DRAG moves the bar anywhere
// on screen), the cancel (while a recording/transcription is in flight)
// and record buttons, and the settings gear. Recording works right here
// without expanding.
import { useRef } from "react";
import { ChevronUp, LoaderCircle, Mic, Square, X } from "lucide-react";
import { ChatSettingsButton } from "@/components/chat/chat-settings";
import { ResizeHandle } from "@/components/chat/resize-handle";
import { cn } from "@/lib/utils";

const TAP_SLOP_PX = 8;

export function ChatBar({
  listening,
  micBusy,
  transcribing,
  thinking,
  continuous,
  notice,
  lastReply,
  onCancel,
  onExpandTap,
  onBarGrow,
  onOpenSheet,
  onRecordToggle,
  position,
  onRelocate,
}: {
  listening: boolean;
  micBusy: boolean;
  transcribing: boolean;
  thinking: boolean;
  continuous: boolean;
  /** Transient inline message ("Didn't catch that") — tops the priority. */
  notice: string | null;
  lastReply: string | null;
  /** Discard the open recording / in-flight transcription. */
  onCancel: () => void;
  onExpandTap: () => void;
  /** Drag on the expand control: grow the sheet upward from the pointer
   *  (clientY) — the panel takes over because this bar unmounts as the
   *  sheet form appears. */
  onBarGrow: (clientY: number) => void;
  onOpenSheet: () => void;
  onRecordToggle: () => void;
  /** Dragged position (top-left px) — null = default bottom-right dock. */
  position: { x: number; y: number } | null;
  onRelocate: (x: number, y: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  // Middle: tap opens the sheet, drag moves the bar (same slop pattern as
  // resize-handle.tsx — under 8px of movement is a tap).
  const midDragRef = useRef<{ x: number; y: number; offX: number; offY: number; moved: boolean } | null>(
    null,
  );

  const clampToViewport = (x: number, y: number) => {
    const w = barRef.current?.offsetWidth ?? 0;
    const h = barRef.current?.offsetHeight ?? 0;
    return {
      x: Math.min(Math.max(8, x), window.innerWidth - w - 8),
      y: Math.min(Math.max(8, y), window.innerHeight - h - 8),
    };
  };

  const onMidPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect) return;
    midDragRef.current = {
      x: e.clientX,
      y: e.clientY,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMidPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = midDragRef.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < TAP_SLOP_PX) return;
      d.moved = true;
    }
    const p = clampToViewport(e.clientX - d.offX, e.clientY - d.offY);
    onRelocate(p.x, p.y);
  };

  const onMidPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // capture already released
    }
    const d = midDragRef.current;
    midDragRef.current = null;
    if (d && !d.moved) onOpenSheet();
  };

  return (
    <div
      ref={barRef}
      role="group"
      aria-label="Cooking assistant"
      className="fixed bottom-24 right-4 z-30 flex max-w-[min(80vw,26rem)] items-center gap-1 rounded-full border border-(--color-border) bg-(--color-surface) p-1"
      style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}
    >
      <ResizeHandle
        onTap={onExpandTap}
        onDragStart={onBarGrow}
        ariaLabel="Expand or resize the cooking assistant"
        title="Tap to expand · drag up to grow"
        className="flex size-9 items-center justify-center rounded-full text-(--color-text-secondary) transition-colors hover:bg-(--color-surface-container) hover:text-(--color-text-primary)"
      >
        <ChevronUp className="size-4" strokeWidth={1.5} />
      </ResizeHandle>

      {/* Middle: live status, else the latest reply as a glanceable snippet.
          Tap opens the sheet; drag relocates the bar anywhere on screen. */}
      <button
        type="button"
        aria-label="Open the cooking assistant (drag to move)"
        onPointerDown={onMidPointerDown}
        onPointerMove={onMidPointerMove}
        onPointerUp={onMidPointerUp}
        onPointerCancel={() => {
          midDragRef.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenSheet();
          }
        }}
        className="flex min-w-0 flex-1 cursor-grab touch-none select-none items-center gap-1.5 rounded-full px-2 py-1.5 text-left transition-colors hover:bg-(--color-surface-container) active:cursor-grabbing"
      >
        {listening ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[length:var(--text-meta)] text-(--color-accent)">
            <span className="flex shrink-0 items-end gap-0.5" aria-hidden>
              <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "6px" }} />
              <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "10px", animationDelay: "0.15s" }} />
              <span className="w-0.5 animate-pulse bg-(--color-accent)" style={{ height: "8px", animationDelay: "0.3s" }} />
            </span>
            <span className="truncate">
              Listening{continuous ? " — always-on" : " — tap the mic to stop"}
            </span>
          </span>
        ) : micBusy || transcribing || thinking ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[length:var(--text-meta)] text-(--color-text-secondary)">
            <LoaderCircle className="size-3 shrink-0 animate-spin" strokeWidth={1.5} />
            <span className="truncate">{transcribing ? "Transcribing…" : thinking ? "Thinking…" : "Loading the speech model…"}</span>
          </span>
        ) : notice ? (
          <span className="truncate text-[length:var(--text-meta)] text-(--color-text-secondary)">{notice}</span>
        ) : (
          <span className="truncate text-[length:var(--text-meta)] text-(--color-text-secondary)">
            {lastReply ?? "Ask about this recipe…"}
          </span>
        )}
      </button>

      {/* Cancel — discard the open recording / in-flight transcription.
          Always visible next to record (design.md §3.3.4), enabled whenever
          the pipeline has something in flight — including the initial
          "loading the speech model" window, which otherwise disables the
          mic with no way out. */}
      <button
        type="button"
        aria-label="Cancel recording"
        onClick={onCancel}
        disabled={!listening && !micBusy}
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-(--color-error)/50 bg-(--color-page) text-(--color-error) transition-colors hover:border-(--color-error) disabled:opacity-30"
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>

      <button
        type="button"
        aria-label={listening ? "Stop recording" : "Start talking"}
        onClick={onRecordToggle}
        disabled={micBusy}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full border disabled:opacity-50",
          listening
            ? "border-(--color-accent) bg-(--color-accent) text-white"
            : "border-(--color-border) bg-(--color-page) text-(--color-accent) hover:border-(--color-accent)",
        )}
      >
        {listening ? (
          <Square className="size-3.5" strokeWidth={1.5} />
        ) : (
          <Mic className="size-4" strokeWidth={1.5} />
        )}
      </button>

      <ChatSettingsButton className="flex size-9 items-center justify-center rounded-full hover:bg-(--color-surface-container)" />
    </div>
  );
}
