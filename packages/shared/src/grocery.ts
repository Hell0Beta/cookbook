// Grocery list aggregation — development.md §8.2 "Grocery List Aggregation",
// rendered by design.md §3.6. Pure function: scaled ingredient occurrences in,
// de-duplicated, unit-converted, category-grouped items out. Persistence and
// ownership checks live in apps/api; this module must stay side-effect-free.
import convert from "convert-units";
import { z } from "zod";
import { formatQuantity } from "./scaling.js";
import { GroceryCategory, Unit, type RoleTag } from "./entities.js";

// ── unit families (development.md §8.2 #3) ──────────────────────────────────

type Family = "volume" | "weight" | "count";

const UNIT_FAMILY: Partial<Record<Unit, Family>> = {
  tsp: "volume",
  tbsp: "volume",
  cup: "volume",
  ml: "volume",
  l: "volume",
  g: "weight",
  kg: "weight",
  oz: "weight",
  lb: "weight",
  piece: "count",
  // pinch / to_taste never sum (§8.2 #4 — non-summed lines)
};

const FAMILY_BASE: Record<Exclude<Family, "count">, Unit> = { volume: "ml", weight: "g" };

// convert-units' own Unit type doesn't overlap our Unit union cleanly; widen
// at the boundary so our enum flows through. v2 also spells tablespoon "Tbs".
const convertQty = convert as unknown as (
  q: number,
) => { from: (u: string) => { to: (u: string) => number } };

const CONVERT_UNIT_NAME: Partial<Record<Unit, string>> = { tbsp: "Tbs" };
const cu = (u: Unit): string => CONVERT_UNIT_NAME[u] ?? u;

/** Kill float noise from unit round-trips (2 cup + 1 cup → 3, not 3.0000000004). */
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

export const CATEGORY_ORDER: readonly GroceryCategory[] = [
  "produce", "dairy", "meat", "pantry", "spice", "frozen", "bakery", "other",
];

// ── input ────────────────────────────────────────────────────────────────────

export interface GroceryEntry {
  /** Master-table match; null → free-text, grouped by normalized name instead. */
  ingredient_id: string | null;
  /** Canonical name if matched, else raw text (best available until Phase 3 parsing). */
  display_name: string;
  /** Exact scaled quantity (target/base servings), un-rounded — rounding happens once after summing. */
  quantity: number | null;
  unit: Unit | null;
  category: GroceryCategory;
  role_tag: RoleTag;
  source_recipe_id: string;
  recipe_title: string;
}

// ── output ───────────────────────────────────────────────────────────────────

export interface AggregatedGroceryItem {
  /** "loose" = to_taste / unquantified / non-summable — never summed (§8.2 #4). */
  kind: "aggregated" | "loose";
  ingredient_id: string | null;
  label: string;
  quantity: number | null;
  unit: Unit | null;
  /** Formatted quantity ("1½ cups", "~2–3"); empty for merged loose lines. */
  display: string;
  approximate: boolean;
  category: GroceryCategory;
  source_recipe_ids: string[];
  recipe_count: number;
}

export interface GroceryCategoryGroup {
  category: GroceryCategory;
  items: AggregatedGroceryItem[];
}

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function distinctRecipes(entries: GroceryEntry[]): string[] {
  return [...new Set(entries.map((e) => e.source_recipe_id))];
}

/**
 * Pick the unit a summed family value is displayed in:
 * single unit → keep it; all-US-customary volumes → cups; otherwise the
 * metric base, stepping to the next magnitude at 1000 (1200 g → 1.2 kg).
 */
function chooseDisplayUnit(
  units: Unit[],
  family: Exclude<Family, "count">,
  baseValue: number,
): Unit {
  const distinct = [...new Set(units)];
  if (distinct.length === 1) return distinct[0]!;
  if (family === "volume" && distinct.every((u) => u === "tsp" || u === "tbsp" || u === "cup")) {
    return "cup";
  }
  return baseValue >= 1000 ? (family === "volume" ? "l" : "kg") : FAMILY_BASE[family];
}

// ── aggregation (development.md §8.2 #1–5) ──────────────────────────────────

export function aggregateGroceryList(entries: readonly GroceryEntry[]): AggregatedGroceryItem[] {
  const resolvable: GroceryEntry[] = [];
  const loose: GroceryEntry[] = [];
  for (const e of entries) {
    const summable = e.quantity !== null && e.unit !== null && UNIT_FAMILY[e.unit] !== undefined;
    (summable ? resolvable : loose).push(e);
  }

  const items: AggregatedGroceryItem[] = [];

  // Summable entries: group by ingredient identity, then sub-group by unit
  // family — incompatible families stay as separate per-family lines (§8.2 #3/#4).
  const groups = new Map<string, GroceryEntry[]>();
  for (const e of resolvable) {
    const key = e.ingredient_id ?? `name:${normalizeName(e.display_name)}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(e);
    else groups.set(key, [e]);
  }

  for (const group of groups.values()) {
    const byFamily = new Map<Family, GroceryEntry[]>();
    for (const e of group) {
      const family = UNIT_FAMILY[e.unit!]!;
      const bucket = byFamily.get(family);
      if (bucket) bucket.push(e);
      else byFamily.set(family, [e]);
    }

    for (const [family, sub] of byFamily) {
      const recipeIds = distinctRecipes(sub);
      const first = sub[0]!;
      let quantity: number;
      let unit: Unit;

      if (family === "count") {
        // Whole items sum as counts (unit is always "piece").
        unit = "piece";
        quantity = sub.reduce((sum, e) => sum + e.quantity!, 0);
      } else {
        const base = round6(
          sub.reduce((sum, e) => sum + convertQty(e.quantity!).from(cu(e.unit!)).to(FAMILY_BASE[family]), 0),
        );
        unit = chooseDisplayUnit(sub.map((e) => e.unit!), family, base);
        quantity = round6(
          unit === FAMILY_BASE[family]
            ? base
            : convertQty(base).from(FAMILY_BASE[family]).to(cu(unit)),
        );
      }

      const formatted = formatQuantity(quantity, unit);
      items.push({
        kind: "aggregated",
        ingredient_id: first.ingredient_id,
        label: first.display_name,
        quantity,
        unit,
        display: formatted.display,
        approximate: formatted.approximate,
        category: first.category,
        source_recipe_ids: recipeIds,
        recipe_count: recipeIds.length,
      });
    }
  }

  // Loose entries (to_taste / unquantified / pinch): never summed — identical
  // items merge into one annotated line ("salt to taste (from 2 recipes)", §8.2 #4).
  const looseGroups = new Map<string, GroceryEntry[]>();
  for (const e of loose) {
    const key = `loose:${normalizeName(e.display_name)}`;
    const bucket = looseGroups.get(key);
    if (bucket) bucket.push(e);
    else looseGroups.set(key, [e]);
  }
  for (const sub of looseGroups.values()) {
    const recipeIds = distinctRecipes(sub);
    const first = sub[0]!;
    // A single loose entry can still carry a quantity ("1 pinch salt");
    // merged entries drop theirs rather than summing.
    const quantity = sub.length === 1 ? first.quantity : null;
    const unit = sub.length === 1 ? first.unit : null;
    items.push({
      kind: "loose",
      ingredient_id: first.ingredient_id,
      label: first.display_name,
      quantity,
      unit,
      display: quantity !== null ? formatQuantity(quantity, unit).display : "",
      approximate: false,
      category: first.category,
      source_recipe_ids: recipeIds,
      recipe_count: recipeIds.length,
    });
  }

  // Stable order: grocery-store aisle order, then label (§8.2 #5).
  const categoryIndex = (c: GroceryCategory) => CATEGORY_ORDER.indexOf(c);
  return items.sort(
    (a, b) => categoryIndex(a.category) - categoryIndex(b.category) || a.label.localeCompare(b.label),
  );
}

/** Group aggregated items into aisle-ordered category buckets (§8.2 #5). */
export function groupGroceryByCategory(items: readonly AggregatedGroceryItem[]): GroceryCategoryGroup[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: items
      .filter((i) => i.category === category)
      .sort((a, b) => a.label.localeCompare(b.label)),
  })).filter((g) => g.items.length > 0);
}

// ── API wire shapes (development.md §11) ────────────────────────────────────

export const CreateGroceryListInput = z.object({
  recipe_ids: z.array(z.string().min(1)).min(1),
  servings_overrides: z.record(z.string(), z.number().int().positive()).default({}),
  /**
   * replace = archive the active list and generate a fresh one (recipe browser
   * multi-select). append = merge into the active list, preserving purchased
   * state (Reader's "add to grocery list" — development.md §8.2, design.md §3.6).
   */
  mode: z.enum(["replace", "append"]).default("replace"),
});
export type CreateGroceryListInput = z.infer<typeof CreateGroceryListInput>;

export const GroceryItemPatchInput = z.object({
  is_purchased: z.boolean().optional(),
  quantity: z.number().min(0).nullable().optional(),
  unit: Unit.nullable().optional(),
  /**
   * Drag-to-recategorize (design.md §3.6): the rule-based lookup is a default,
   * not a verdict — the user's drop wins and is persisted to the Ingredient
   * master row so it survives regeneration (§6.4).
   */
  category: GroceryCategory.optional(),
});
export type GroceryItemPatchInput = z.infer<typeof GroceryItemPatchInput>;

export const ManualGroceryItemInput = z.object({
  label: z.string().min(1).max(120),
  quantity: z.number().min(0).nullable().optional(),
  unit: Unit.nullable().optional(),
  category: GroceryCategory.optional(),
});
export type ManualGroceryItemInput = z.infer<typeof ManualGroceryItemInput>;

export const GroceryListItemOut = z.object({
  id: z.string(),
  label: z.string(),
  ingredient_id: z.string().nullable(),
  quantity: z.number().nullable(),
  unit: Unit.nullable(),
  display: z.string(),
  approximate: z.boolean(),
  category: GroceryCategory,
  is_purchased: z.boolean(),
  source_recipe_ids: z.array(z.string()),
  recipe_count: z.number().int(),
});
export type GroceryListItemOut = z.infer<typeof GroceryListItemOut>;

export const GroceryListOut = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  created_at: z.string(),
  items: z.array(GroceryListItemOut),
});
export type GroceryListOut = z.infer<typeof GroceryListOut>;
