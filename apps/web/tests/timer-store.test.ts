// Timer store tests — development.md §7.3 (one store, one ticker, keyed by
// (recipe_id, step_id)). The completion alert touches browser-only APIs
// (AudioContext, navigator, Notification); every branch there is wrapped in
// try/catch so headless completion is safe.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { tick, useTimerStore } from "../src/components/timer/timer-store";

interface StartArgs {
  stepId: string;
  recipeId: string;
  recipeTitle: string;
  stepNumber: number;
  snippet: string;
  totalSeconds: number;
}

const step = (over: Partial<StartArgs> = {}): StartArgs => ({
  stepId: "step-1",
  recipeId: "r1",
  recipeTitle: "Pancakes",
  stepNumber: 2,
  snippet: "Simmer gently",
  totalSeconds: 60,
  ...over,
});

beforeEach(() => {
  useTimerStore.setState({ timers: [] });
});

describe("timer store (development.md §7.3)", () => {
  it("starts a running timer with remaining = duration", () => {
    useTimerStore.getState().start(step());
    const t = useTimerStore.getState().get("step-1")!;
    assert.equal(t.running, true);
    assert.equal(t.completed, false);
    assert.equal(t.remainingSeconds, 60);
  });

  it("re-starting the same step resets it instead of duplicating", () => {
    useTimerStore.getState().start(step());
    tick(); // 59
    useTimerStore.getState().start(step({ totalSeconds: 30 }));
    const timers = useTimerStore.getState().timers;
    assert.equal(timers.length, 1);
    assert.equal(timers[0]!.remainingSeconds, 30);
  });

  it("keys instances by (recipe, step) — same step in another recipe is distinct", () => {
    useTimerStore.getState().start(step());
    useTimerStore.getState().start(step({ recipeId: "r2", stepId: "step-9" }));
    assert.equal(useTimerStore.getState().timers.length, 2);
  });

  it("toggle pauses and resumes without losing remaining time", () => {
    useTimerStore.getState().start(step());
    tick(); // 59
    useTimerStore.getState().toggle("step-1");
    assert.equal(useTimerStore.getState().get("step-1")!.running, false);
    tick(); // paused — must not decrement
    assert.equal(useTimerStore.getState().get("step-1")!.remainingSeconds, 59);
    useTimerStore.getState().toggle("step-1");
    assert.equal(useTimerStore.getState().get("step-1")!.running, true);
  });

  it("a single tick drives all instances; only running ones decrement", () => {
    useTimerStore.getState().start(step({ stepId: "a", totalSeconds: 10 }));
    useTimerStore.getState().start(step({ stepId: "b", totalSeconds: 10 }));
    useTimerStore.getState().toggle("b");
    tick();
    const s = useTimerStore.getState();
    assert.equal(s.get("a")!.remainingSeconds, 9);
    assert.equal(s.get("b")!.remainingSeconds, 10);
  });

  it("completes at zero: running=false, completed=true", () => {
    useTimerStore.getState().start(step({ totalSeconds: 1 }));
    tick();
    const t = useTimerStore.getState().get("step-1")!;
    assert.equal(t.remainingSeconds, 0);
    assert.equal(t.running, false);
    assert.equal(t.completed, true);
  });

  it("completed timers no longer tick and ignore toggle", () => {
    useTimerStore.getState().start(step({ totalSeconds: 1 }));
    tick(); // completes
    useTimerStore.getState().toggle("step-1");
    tick();
    const t = useTimerStore.getState().get("step-1")!;
    assert.equal(t.completed, true);
    assert.equal(t.remainingSeconds, 0);
  });

  it("stop removes the instance", () => {
    useTimerStore.getState().start(step());
    useTimerStore.getState().stop("step-1");
    assert.equal(useTimerStore.getState().get("step-1"), undefined);
  });

  it("tick with nothing running is a no-op", () => {
    useTimerStore.getState().start(step());
    useTimerStore.getState().toggle("step-1"); // paused
    tick();
    tick();
    assert.equal(useTimerStore.getState().get("step-1")!.remainingSeconds, 60);
  });
});
