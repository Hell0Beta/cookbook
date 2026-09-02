
# Phase 7 — Cooking-Mode Features

From development.md §12, Build Phase 7. Implements: Timer tool (global store, floating control) and shake-to-advance gesture (development.md §7 "Timer Tool" / "Shake-to-Advance"; design.md §3.3.2, §3.3.3).

## Timer tool (development.md §7.3; design.md §3.3.2)
- [x] Zustand global store for timer state — not per-component *(frontend)*
- [x] Timer instances keyed by `(recipe_id, step_id)`: `duration_seconds`, `remaining_seconds`, `status` (running/paused/done), `started_at` *(frontend)*
- [x] Single `setInterval`/`requestAnimationFrame` tick driving all instances *(frontend)*
- [x] Step blocks with `duration_minutes` render tappable timer chips ("Simmer — 12 min") *(frontend)*
- [x] Persistent floating timer pill (turmeric yellow, docks bottom-of-screen); tap returns to that step *(frontend)*
- [x] Multiple concurrent timers: stack/count on floating control, expandable to see all *(frontend)*
- [x] Per-tab scoping with badge dot on tabs with a running background timer *(frontend)*
- [x] Completion: visual pulse + `Notification`/vibration API where available *(frontend)*

## Shake-to-advance (development.md §7.4; design.md §3.3.3)
- [x] `DeviceMotionEvent` listener with acceleration-magnitude spike thresholding *(frontend)*
- [x] iOS Safari permission prompt via `DeviceMotionEvent.requestPermission()` from a user gesture *(frontend)*
- [x] Scope: only active when Reader is foregrounded AND in read (cooking) mode; disabled in edit mode / backgrounded / toggled off *(frontend)*
- [x] On trigger: advance active tab's step, scroll into view, auto-start timer if the step has a duration *(frontend)*
- [x] Toggleable on/off affordance in the reader *(frontend)*
