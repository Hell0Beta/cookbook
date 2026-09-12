"use client";

// Collapsed assistant bar — design.md §3.3.4. Replaces the old round mic
// button: a rounded row docked bottom-right (sibling of the timer pill)
// carrying the expand/resize control (left), the live status or latest
// reply snippet (middle — tap opens the sheet), the record button, and the
// settings gear. Recording works right here without expanding.
import { ChevronUp, LoaderCircle, Mic, Square } from "lucide-react";
import { ChatSettingsButton } from "@/components/chat/chat-settings";
import { ResizeHandle } from "@/components/chat/resize-handle";
import { cn } from "@/lib/utils";

export function ChatBar({
  listening,
  micBusy,
  transcribing,
  thinking,
  continuous,
  notice,
  lastReply,
  onExpandTap,
  onResize,
  onOpenSheet,
  onRecordToggle,
}: {
  listening: boolean;
  micBusy: boolean;
  transcribing: boolean;
  thinking: boolean;
  continuous: boolean;
  /** Transient inline message ("Didn't catch that") — tops the priority. */
  notice: string | null;
  lastReply: string | null;
  onExpandTap: () => void;
  onResize: (vh: number) => void;
  onOpenSheet: () => void;
  onRecordToggle: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Cooking assistant"
      className="fixed bottom-24 right-4 z-30 flex max-w-[min(80vw,26rem)] items-center gap-1 rounded-full border border-(--color-border) bg-(--color-surface) p-1"
    >
      <ResizeHandle
        onTap={onExpandTap}
        onResize={onResize}
        ariaLabel="Expand or resize the cooking assistant"
        title="Tap to expand · drag to resize"
        className="flex size-9 items-center justify-center rounded-full text-(--color-text-secondary) transition-colors hover:bg-(--color-surface-container) hover:text-(--color-text-primary)"
      >
        <ChevronUp className="size-4" strokeWidth={1.5} />
      </ResizeHandle>

      {/* Middle: live status, else the latest reply as a glanceable snippet. */}
      <button
        type="button"
        onClick={onOpenSheet}
        aria-label="Open the cooking assistant"
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-2 py-1.5 text-left transition-colors hover:bg-(--color-surface-container)"
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
