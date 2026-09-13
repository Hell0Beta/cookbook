"use client";

// Chat voice settings — design.md §3.3.4 "Voice modes & settings". A tiny
// module-level store (not zustand — two booleans don't need it) mirrored to
// localStorage under the cookbook:* key convention, plus the popover the
// gear icon opens from the assistant bar / sheet header. Segmented controls
// over a modal: the choices are binary and meant to be flipped mid-cooking.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Settings, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatSettings {
  /** Mic behavior after a reply: sleep until tapped, or keep listening. */
  micMode: "standard" | "always-on";
  /** What a finished recording does: send straight away, or land in the
   * editable input for correction (the §3.3.4 editing affordance). */
  sendOnStop: "instant" | "edit";
}

const DEFAULTS: ChatSettings = { micMode: "standard", sendOnStop: "instant" };
const KEY = "cookbook:chatSettings";

let cached: ChatSettings | null = null;
const listeners = new Set<() => void>();

function read(): ChatSettings {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ChatSettings>;
      cached = {
        micMode: parsed.micMode === "always-on" ? "always-on" : "standard",
        sendOnStop: parsed.sendOnStop === "edit" ? "edit" : "instant",
      };
      return cached;
    }
  } catch {
    // private mode / corrupted value — defaults
  }
  cached = { ...DEFAULTS };
  return cached;
}

function update(patch: Partial<ChatSettings>) {
  cached = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // persistence is best-effort — the in-memory value still applies
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useChatSettings() {
  const settings = useSyncExternalStore(subscribe, read, () => DEFAULTS);
  return { settings, update };
}

// ── popover (opened by the gear on the bar's right end / sheet header) ──────

function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="flex items-center gap-1 rounded-(--radius-sm) border border-(--color-border) p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-(--radius-sm) px-2 py-1 text-[length:var(--text-meta)] font-medium transition-colors",
            value === o.value
              ? "bg-(--color-accent)/15 text-(--color-accent)"
              : "text-(--color-text-secondary) hover:text-(--color-text-primary)",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ChatSettingsPopover({ onClose }: { onClose: () => void }) {
  const { settings, update } = useChatSettings();
  const rootRef = useRef<HTMLDivElement>(null);

  // Outside click / Escape closes — a hand-rolled popover (no Radix dep).
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Voice assistant settings"
      className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) p-3"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[length:var(--text-body)] font-medium">Voice settings</p>
        <button
          type="button"
          aria-label="Close settings"
          onClick={onClose}
          className="text-(--color-text-secondary) hover:text-(--color-text-primary)"
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      </div>

      <p className="mb-1.5 text-[length:var(--text-meta)] font-medium text-(--color-text-secondary)">Microphone</p>
      <Segmented
        ariaLabel="Microphone mode"
        value={settings.micMode}
        onChange={(v) => update({ micMode: v })}
        options={[
          { value: "standard", label: "Standard" },
          { value: "always-on", label: "Always-on" },
        ]}
      />
      <p className="mb-3 mt-1 text-[length:var(--text-meta)] text-(--color-text-secondary)">
        {settings.micMode === "standard"
          ? "The mic sleeps after each reply — tap record for every turn."
          : "The mic keeps listening; a pause ends your turn and the reply is spoken back, then it keeps listening."}
      </p>

      <p className="mb-1.5 text-[length:var(--text-meta)] font-medium text-(--color-text-secondary)">After recording</p>
      <Segmented
        ariaLabel="Send behavior after recording"
        value={settings.sendOnStop}
        onChange={(v) => update({ sendOnStop: v })}
        options={[
          { value: "instant", label: "Send instantly" },
          { value: "edit", label: "Review first" },
        ]}
      />
      <p className="mt-1 text-[length:var(--text-meta)] text-(--color-text-secondary)">
        {settings.sendOnStop === "instant"
          ? "Stopping the recording sends it straight to the assistant."
          : "The transcript lands in the text field so you can fix it before sending."}
      </p>
    </div>
  );
}

/** Gear button + the popover anchored to it. Renders inside a relative
 *  wrapper; the popover opens above (bar docks low on screen). */
export function ChatSettingsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Voice settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn("text-(--color-text-secondary) hover:text-(--color-text-primary)", className)}
      >
        <Settings className="size-4" strokeWidth={1.5} />
      </button>
      {open && <ChatSettingsPopover onClose={() => setOpen(false)} />}
    </div>
  );
}
