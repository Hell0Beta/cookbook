# Phase 5 — Meal Planning Core

From development.md §12, Build Phase 5. Implements: MealPlanEntry model, Quick Add modal + endpoint, Dashboard "Upcoming"/"Meals planned for the day" wiring, multi-recipe tabs in the Reader (development.md §7 "Quick Add to Meal"; design.md §3.4, §4.1, §3.3.1).

## Data model (development.md §3, MealPlan/MealPlanEntry)
- [x] MealPlanEntry Prisma model: `date`, `meal_slot` (breakfast/lunch/dinner/snack/custom), `recipe_id`, `servings_planned` *(backend)*
- [x] Nullable `scheduled_at` (custom-time path; `meal_slot` null in that case) *(backend)*
- [x] `is_upcoming_pin` bool for Quick Add "Right now / #Upcoming" *(backend)*
- [x] Multiple rows per `(date, meal_slot)` occasion — no Meal grouping entity *(backend)*

## Quick Add (development.md §7.2; design.md §3.4, §4.2)
- [x] `POST /meal-plans/quick-add` — `{ recipe_id, mode: "now" | "slot" | "custom_minutes", slot?, minutes?, date? }` *(backend)*
- [x] `mode: "now"` → `is_upcoming_pin = true`, `date = today` *(backend)*
- [x] `mode: "slot"` → next-occurrence resolution as a pure function in `packages/shared` (today if not passed, else tomorrow) *(backend)*
- [x] `mode: "custom_minutes"` → `scheduled_at = now + minutes`, `meal_slot = null` *(backend)*
- [x] Quick Add modal: Right now / Breakfast / Lunch / Dinner / "In next [X] minutes" / "Open full planner →" *(frontend)*
- [x] Same modal component triggered from Recipe Reader AND Search result cells, parameterized by `recipe_id` *(frontend)*
- [x] Slot preview text ("adds to: Today's Dinner") using the shared resolution function *(frontend)*

## Dashboard wiring (design.md §3.1, §4.1)
- [x] `GET /meal-plans/upcoming` — resolves the "Upcoming Recipe" occurrence by `is_upcoming_pin`; may return >1 recipe *(backend)*
- [x] "Upcoming Recipe" cell → opens Reader scoped to that meal occurrence *(frontend)*
- [x] "Meals planned for the day" — 3 small square cells (breakfast/lunch/dinner), each → Reader for that slot *(frontend)*

## Multi-recipe tabs (design.md §3.3.1)
- [x] `GET /meal-plans/for-slot?date=&slot=` — all recipes for an occasion *(backend)*
- [x] Tab strip under app bar when >1 recipe; hidden for single-dish meals *(frontend)*
- [x] Tab switch swaps block stack below; only one recipe visible at a time *(frontend)*
- [x] Per-tab timer scoping with background-timer indicator dot on other tabs *(frontend)*
- [x] `GET /meal-plans?date=` / `?week=` base queries *(backend)*
