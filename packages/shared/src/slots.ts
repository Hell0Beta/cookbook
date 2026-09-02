// Meal-slot date resolution — development.md §7.2 "Quick Add to Meal".
// Pure functions so the frontend can preview "adds to: Today's Dinner"
// before confirming (same logic the backend applies on POST /meal-plans/quick-add).
import type { MealSlot } from "./entities.js";

/** Nominal clock times for each slot; used to decide "today if not yet passed". */
export const SLOT_TIMES: Record<MealSlot, { hour: number; minute: number }> = {
  breakfast: { hour: 8, minute: 0 },
  lunch: { hour: 12, minute: 30 },
  dinner: { hour: 18, minute: 30 },
  snack: { hour: 15, minute: 0 },
};

export interface ResolvedSlot {
  /** ISO date (yyyy-mm-dd) the entry lands on. */
  date: string;
  slot: MealSlot;
  /** Human preview: "Today's Dinner" / "Tomorrow's Lunch". */
  label: string;
}

const DAY_MS = 86_400_000;

/** Local-time ISO date (yyyy-mm-dd). */
export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Resolve the next occurrence of a meal slot: today if the slot's nominal time
 * hasn't passed yet, otherwise tomorrow (development.md §7.2).
 */
export function resolveNextSlot(slot: MealSlot, now: Date = new Date()): ResolvedSlot {
  const { hour, minute } = SLOT_TIMES[slot];
  const slotTime = new Date(now);
  slotTime.setHours(hour, minute, 0, 0);
  const target = now <= slotTime ? now : new Date(now.getTime() + DAY_MS);
  const day = now <= slotTime ? "Today" : "Tomorrow";
  const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1);
  return { date: toIsoDate(target), slot, label: `${day}'s ${slotLabel}` };
}

/** Parse an ISO date (yyyy-mm-dd) into a local Date at midnight. */
export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** Monday..Sunday of the week containing `iso` (local time). */
export function weekRange(iso: string): { from: string; to: string } {
  const d = parseIsoDate(iso);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: toIsoDate(monday), to: toIsoDate(sunday) };
}
