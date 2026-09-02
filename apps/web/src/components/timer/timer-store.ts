"use client";

// Timer Tool global store — design.md §3.3.2, development.md §7.3. Zustand, not
// React context: the floating pill, step chips, and tab badges all subscribe
// from different subtrees, and the store must work outside React (the shake
// hook's auto-start). One 1s interval drives every instance, started lazily on
// the first timer and shared for the session.
import { create } from "zustand";

export interface ActiveTimer {
  /** Step block id — one timer per step, unique across recipes. */
  stepId: string;
  recipeId: string;
  recipeTitle: string;
  stepNumber: number;
  snippet: string;
  totalSeconds: number;
  remainingSeconds: number;
  running: boolean;
  completed: boolean;
}

interface TimerState {
  timers: ActiveTimer[];
  start: (t: Omit<ActiveTimer, "remainingSeconds" | "running" | "completed">) => void;
  toggle: (stepId: string) => void;
  stop: (stepId: string) => void;
  get: (stepId: string) => ActiveTimer | undefined;
}

export const useTimerStore = create<TimerState>((set, get) => ({
  timers: [],
  start: (t) => {
    ensureTicker();
    set((s) => ({
      timers: [
        ...s.timers.filter((x) => x.stepId !== t.stepId),
        { ...t, remainingSeconds: t.totalSeconds, running: true, completed: false },
      ],
    }));
  },
  toggle: (stepId) =>
    set((s) => ({
      timers: s.timers.map((t) =>
        t.stepId === stepId && !t.completed ? { ...t, running: !t.running } : t,
      ),
    })),
  stop: (stepId) =>
    set((s) => ({ timers: s.timers.filter((t) => t.stepId !== stepId) })),
  get: (stepId) => get().timers.find((t) => t.stepId === stepId),
}));

export function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── completion alert (§3.3.2: pulse + sound/vibration; §7.3: device alert) ──
// Three short WebAudio beeps (no asset fetch — development.md §0) + vibration
// where available. A system Notification fires only if the browser already
// granted permission — the timer never prompts on its own.

function alertDone(finished: ActiveTimer[]) {
  try {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      for (let i = 0; i < 3; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.type = "sine";
        const t0 = ctx.currentTime + i * 0.35;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
        osc.start(t0);
        osc.stop(t0 + 0.3);
      }
    }
  } catch {
    // audio blocked — the visual pulse still signals completion
  }
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // vibration unsupported
  }
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const t of finished) {
        new Notification("Timer done", {
          body: `${t.recipeTitle || "Recipe"} · step ${t.stepNumber} — ${formatClock(t.totalSeconds)}`,
          tag: t.stepId, // collapse re-fires for the same step
        });
      }
    }
  } catch {
    // Notification constructor can throw (e.g. insecure context) — ignore
  }
}

// ── the single ticker (development.md §7.3: one interval for ALL instances) ──
// Exported for tests — the interval itself only runs in a browser.

export function tick() {
  const { timers } = useTimerStore.getState();
  if (!timers.some((t) => t.running && !t.completed)) return;
  const finished: ActiveTimer[] = [];
  useTimerStore.setState({
    timers: timers.map((t) => {
      if (!t.running || t.completed) return t;
      if (t.remainingSeconds <= 1) {
        finished.push(t);
        return { ...t, remainingSeconds: 0, running: false, completed: true };
      }
      return { ...t, remainingSeconds: t.remainingSeconds - 1 };
    }),
  });
  if (finished.length > 0) alertDone(finished);
}

const TICKER_KEY = "__cookbookTimerTicker";

function ensureTicker() {
  if (typeof window === "undefined") return;
  const g = globalThis as { [TICKER_KEY]?: ReturnType<typeof setInterval> };
  if (g[TICKER_KEY]) return;
  g[TICKER_KEY] = setInterval(tick, 1000);
}
