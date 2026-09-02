"use client";

// Persistent floating timer control — design.md §3.3.2. Bottom-docked
// turmeric pill, survives navigation, expands to every running timer, returns
// to the step on tap. Mounted once at the app root next to <Providers>.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pause, Play, Square, Timer, ChevronUp } from "lucide-react";
import { formatClock, useTimerStore, type ActiveTimer } from "./timer-store";
import { cn } from "@/lib/utils";

export function FloatingTimerPill() {
  const timers = useTimerStore((s) => s.timers);
  const toggle = useTimerStore((s) => s.toggle);
  const stop = useTimerStore((s) => s.stop);
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  if (timers.length === 0) return null;
  const done = timers.filter((t) => t.completed);
  const running = timers.some((t) => t.running && !t.completed);

  const openStep = (t: ActiveTimer) => {
    router.push(`/recipes/${t.recipeId}#step-${t.stepId}`);
    setExpanded(false);
  };

  return (
    <div
      className="fixed inset-x-(--spacing-margin) bottom-24 z-30 mx-auto flex max-w-3xl flex-col gap-2"
      role="timer"
      aria-label="Cooking timers"
    >
      {expanded ? (
        <div className="flex flex-col gap-2 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)">
          {timers.map((t) => (
            <TimerRow key={t.stepId} timer={t} onToggle={() => toggle(t.stepId)} onStop={() => stop(t.stepId)} onOpen={() => openStep(t)} />
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={cn(
            "flex items-center justify-between gap-3 self-start rounded-(--radius-bento) px-4 py-2.5 font-medium",
            done.length > 0
              ? "animate-pulse border border-(--color-turmeric) bg-(--color-turmeric) text-(--color-text-primary)"
              : "bg-(--color-turmeric) text-(--color-text-primary)",
          )}
        >
          <span className="flex items-center gap-2">
            <Timer className="size-4" strokeWidth={1.5} />
            {done.length > 0 ? (
              `${done.length} timer${done.length === 1 ? "" : "s"} done!`
            ) : (
              formatClock(timers.find((t) => t.running)?.remainingSeconds ?? timers[0]!.remainingSeconds)
            )}
          </span>
          <span className="flex items-center gap-1.5 text-[length:var(--text-meta)]">
            {timers.length > 1 && <span>{timers.length}</span>}
            {running && <span>cooking</span>}
            <ChevronUp className="size-3.5" strokeWidth={1.5} />
          </span>
        </button>
      )}
    </div>
  );
}

function TimerRow({
  timer: t,
  onToggle,
  onStop,
  onOpen,
}: {
  timer: ActiveTimer;
  onToggle: () => void;
  onStop: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 text-left"
        title={`Back to step ${t.stepNumber}`}
      >
        <div className="truncate text-[length:var(--text-meta)] text-(--color-text-secondary)">
          {t.recipeTitle} · step {t.stepNumber}
        </div>
        <div className="truncate font-[family-name:var(--font-mono)]">
          {t.completed ? "done" : formatClock(t.remainingSeconds)}
        </div>
      </button>
      {!t.completed && (
        <button
          type="button"
          aria-label={t.running ? "Pause timer" : "Resume timer"}
          onClick={onToggle}
          className="flex size-8 items-center justify-center rounded-(--radius-sm) border border-(--color-border) hover:bg-(--color-surface-container)"
        >
          {t.running ? <Pause className="size-4" strokeWidth={1.5} /> : <Play className="size-4" strokeWidth={1.5} />}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss timer"
        onClick={onStop}
        className="flex size-8 items-center justify-center rounded-(--radius-sm) border border-(--color-border) hover:bg-(--color-surface-container)"
      >
        <Square className="size-3.5" strokeWidth={1.5} />
      </button>
    </div>
  );
}
