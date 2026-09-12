"use client";

// Step navigation shared by shake-to-advance (design.md §3.3.3), the voice
// assistant's step_control intents (§14.2), and the chat panel's Steps tab —
// one place for the "current step" convention (last step at/above the
// viewport midpoint) and the "go to step" side effects (scroll + optional
// timer auto-start). The reader's scroll position stays the single source of
// truth; every navigation path resolves through it.
import type { StepBlock } from "@cookbook/shared";
import { useTimerStore } from "@/components/timer/timer-store";

/** Minimum px of horizontal travel that counts as a swipe, whatever the width. */
const SWIPE_MIN_PX = 48;
/** Horizontal must dominate by this ratio, or it's a (vertical) scroll. */
const SWIPE_DOMINANCE = 1.5;

/**
 * Classify a finished touch as a step swipe. Pure — unit-tested headlessly.
 * `dx`/`dy` are end-minus-start deltas in px; `width` is the container's.
 */
export function resolveSwipe(
  dx: number,
  dy: number,
  width: number,
): "next" | "previous" | null {
  const threshold = Math.max(SWIPE_MIN_PX, width * 0.25);
  const absDx = Math.abs(dx);
  if (absDx < threshold) return null;
  if (absDx <= Math.abs(dy) * SWIPE_DOMINANCE) return null;
  // Next content lives to the right; swiping left (dx < 0) reveals it.
  return dx < 0 ? "next" : "previous";
}

/**
 * "Current" step per the reader's convention: the last step whose block top
 * is at/above the viewport midpoint. Returns null when the reader is above
 * the first step.
 */
export function currentReaderStep(steps: StepBlock[]): StepBlock | null {
  const mid = window.innerHeight / 2;
  let current: StepBlock | null = null;
  for (const s of steps) {
    const el = document.getElementById(`step-${s.id}`);
    if (el && el.getBoundingClientRect().top <= mid) current = s;
  }
  return current;
}

/**
 * Scroll a step into view, starting its timer when `startTimer` (§3.3.3
 * shake semantics — swipe navigation passes false by decision; see
 * docs/agents/frontend.md).
 */
export function revealStep(
  step: StepBlock,
  opts: { recipeId: string; recipeTitle: string; startTimer: boolean },
): void {
  document
    .getElementById(`step-${step.id}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (
    opts.startTimer &&
    step.duration_minutes &&
    step.duration_minutes > 0 &&
    !useTimerStore.getState().get(step.id)
  ) {
    useTimerStore.getState().start({
      stepId: step.id,
      recipeId: opts.recipeId,
      recipeTitle: opts.recipeTitle,
      stepNumber: step.step_number,
      snippet: step.instruction_text.slice(0, 60),
      totalSeconds: step.duration_minutes * 60,
    });
  }
}
