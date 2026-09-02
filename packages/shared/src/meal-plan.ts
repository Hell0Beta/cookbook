// Meal planning shapes + Quick Add resolution — development.md §3 (MealPlanEntry)
// and §7.2 "Quick Add to Meal". The resolution is a pure function so the backend
// persists exactly what the frontend previewed ("adds to: Today's Dinner").
import { z } from "zod";
import { MealSlot } from "./entities.js";
import { resolveNextSlot, toIsoDate } from "./slots.js";

// ── Quick Add (development.md §7.2, design.md §3.4) ──────────────────────────

export const QuickAddMode = z.enum(["now", "slot", "custom_minutes"]);
export type QuickAddMode = z.infer<typeof QuickAddMode>;

const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be yyyy-mm-dd");

export const QuickAddInput = z
  .object({
    recipe_id: z.string().min(1),
    mode: QuickAddMode,
    slot: MealSlot.optional(), // mode: "slot"
    minutes: z.number().int().positive().max(24 * 60).optional(), // mode: "custom_minutes"
    date: IsoDate.optional(), // explicit target day (slot/now modes); defaults to resolution
  })
  .superRefine((body, ctx) => {
    if (body.mode === "slot" && !body.slot) {
      ctx.addIssue({ code: "custom", path: ["slot"], message: "slot is required when mode is 'slot'" });
    }
    if (body.mode === "custom_minutes" && body.minutes === undefined) {
      ctx.addIssue({ code: "custom", path: ["minutes"], message: "minutes is required when mode is 'custom_minutes'" });
    }
  });
export type QuickAddInput = z.infer<typeof QuickAddInput>;

/** What POST /meal-plans/quick-add will persist — and what the modal previews. */
export interface QuickAddTarget {
  /** Calendar day the entry lands on (yyyy-mm-dd). */
  date: string;
  meal_slot: MealSlot | null;
  /** ISO timestamp — set only for the custom-time path. */
  scheduled_at: string | null;
  is_upcoming_pin: boolean;
  /** Human preview: "Right now — #Upcoming" / "Today's Dinner" / "in 30 min". */
  label: string;
}

/**
 * Resolve a Quick Add mode into the MealPlanEntry fields it produces
 * (development.md §7.2). Pure: the API calls it with server time, the modal
 * with client time, so both agree on "today if not passed, else tomorrow".
 */
export function resolveQuickAddTarget(
  mode: QuickAddMode,
  opts: { slot?: MealSlot; minutes?: number; date?: string } = {},
  now: Date = new Date(),
): QuickAddTarget {
  if (mode === "now") {
    return {
      date: opts.date ?? toIsoDate(now),
      meal_slot: null,
      scheduled_at: null,
      is_upcoming_pin: true,
      label: "Right now — #Upcoming",
    };
  }
  if (mode === "slot") {
    const resolved = resolveNextSlot(opts.slot ?? "dinner", now);
    const date = opts.date ?? resolved.date;
    const day = date === toIsoDate(now) ? "Today" : date === toIsoDate(new Date(now.getTime() + 86_400_000)) ? "Tomorrow" : date;
    const slotLabel = resolved.slot.charAt(0).toUpperCase() + resolved.slot.slice(1);
    return {
      date,
      meal_slot: resolved.slot,
      scheduled_at: null,
      is_upcoming_pin: false,
      label: `${day}'s ${slotLabel}`,
    };
  }
  const minutes = opts.minutes ?? 30;
  const scheduledAt = new Date(now.getTime() + minutes * 60_000);
  return {
    date: toIsoDate(scheduledAt),
    meal_slot: null,
    scheduled_at: scheduledAt.toISOString(),
    is_upcoming_pin: false,
    label: `in ${minutes} min`,
  };
}

// ── Direct assignment (development.md §11 POST /meal-plans — drag-and-drop) ──

export const MealPlanCreateInput = z.object({
  recipe_id: z.string().min(1),
  date: IsoDate,
  meal_slot: MealSlot.nullable().optional(),
  servings_planned: z.number().int().positive().max(100).optional(),
  is_upcoming_pin: z.boolean().optional(),
});
export type MealPlanCreateInput = z.infer<typeof MealPlanCreateInput>;

// PATCH /meal-plans/:id — reassignment (planner drag-and-drop) and servings
// adjustment. Supplying date or meal_slot means an explicit placement, so the
// entry stops being an "upcoming" pin / custom-time occasion.
export const MealPlanEntryUpdate = z
  .object({
    date: IsoDate.optional(),
    meal_slot: MealSlot.nullable().optional(),
    servings_planned: z.number().int().positive().max(100).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, "at least one field required");
export type MealPlanEntryUpdate = z.infer<typeof MealPlanEntryUpdate>;

// ── API output (snake_case, mirrors MealPlanEntry + a recipe summary) ─────────

export const MealPlanRecipeSummary = z.object({
  id: z.string(),
  title: z.string(),
  hero_image_url: z.string().nullable(),
  base_servings: z.number().int(),
  total_time_minutes: z.number().int().nullable(),
  source_type: z.string(),
});
export type MealPlanRecipeSummary = z.infer<typeof MealPlanRecipeSummary>;

export const MealPlanEntryOut = z.object({
  id: z.string(),
  user_id: z.string(),
  date: z.string(),
  meal_slot: MealSlot.nullable(),
  recipe_id: z.string(),
  servings_planned: z.number().int(),
  scheduled_at: z.string().nullable(),
  is_upcoming_pin: z.boolean(),
  created_at: z.string(),
  recipe: MealPlanRecipeSummary,
});
export type MealPlanEntryOut = z.infer<typeof MealPlanEntryOut>;
