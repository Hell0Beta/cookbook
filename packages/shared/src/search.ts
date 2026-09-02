// Ingredient-based search — development.md §9 "What can I make with what I
// have". Match scoring is a pure function shared by web + api (same pattern as
// resolveQuickAddTarget); the inverted index and routes live in apps/api.
import { z } from "zod";
import { GroceryCategory, RoleTag } from "./entities.js";
import { normalizeIngredientName } from "./tagging.js";

// ── Match scoring (development.md §9 step 3) ─────────────────────────────────

/** One recipe line item reduced to what matching needs. */
export interface IngredientMatchRow {
  ingredient_id: string | null;
  /** Master canonical name when linked, else the raw line text. */
  name: string;
  role_tag: RoleTag;
}

/** What the user says they have: master ids and/or free-text names. */
export interface HaveIngredients {
  ingredient_ids: Iterable<string>;
  names: Iterable<string>;
}

export const MissingIngredient = z.object({
  ingredient_id: z.string().nullable(),
  name: z.string(),
});
export type MissingIngredient = z.infer<typeof MissingIngredient>;

export interface IngredientMatchResult {
  /** matched_main / total_main; 0 when the recipe has no main ingredients. */
  match_score: number;
  matched_main: number;
  total_main: number;
  /** Unmatched main ingredients in recipe order ("what you'd still need"). */
  missing: MissingIngredient[];
}

/**
 * Score one recipe against the user's pantry. Swap-tagged rows are excluded
 * from the denominator entirely (development.md §9 step 3's primary option —
 * the user can substitute those, so they neither help nor hurt the score) and
 * never surface as missing. A row matches when its master id is provided OR
 * its normalized name is among the provided names (manual recipes link no
 * master rows, so name matching keeps them searchable).
 */
export function scoreIngredientMatch(
  rows: readonly IngredientMatchRow[],
  have: HaveIngredients,
): IngredientMatchResult {
  const haveIds = new Set(have.ingredient_ids);
  const haveNames = new Set(
    [...have.names].map((n) => normalizeIngredientName(n)).filter(Boolean),
  );
  let matchedMain = 0;
  let totalMain = 0;
  const missing: MissingIngredient[] = [];
  for (const row of rows) {
    if (row.role_tag !== "main") continue;
    totalMain++;
    const matched =
      (row.ingredient_id !== null && haveIds.has(row.ingredient_id)) ||
      haveNames.has(normalizeIngredientName(row.name));
    if (matched) matchedMain++;
    else missing.push({ ingredient_id: row.ingredient_id, name: row.name });
  }
  return {
    match_score: totalMain > 0 ? matchedMain / totalMain : 0,
    matched_main: matchedMain,
    total_main: totalMain,
    missing,
  };
}

// ── API shapes (development.md §9, §11 `GET /recipes?tags=&q=&ingredients=`) ─

export const IngredientOption = z.object({
  id: z.string(),
  canonical_name: z.string(),
  category: GroceryCategory,
});
export type IngredientOption = z.infer<typeof IngredientOption>;

/** GET /recipes list item; the match fields appear only when ?ingredients= is set. */
export const RecipeSearchResult = z.object({
  id: z.string(),
  title: z.string(),
  hero_image_url: z.string().nullable(),
  base_servings: z.number().int().positive(),
  total_time_minutes: z.number().int().nullable(),
  source_type: z.string(),
  match_score: z.number().min(0).max(1).optional(),
  matched_main: z.number().int().min(0).optional(),
  total_main: z.number().int().min(0).optional(),
  missing_ingredients: z.array(MissingIngredient).optional(),
});
export type RecipeSearchResult = z.infer<typeof RecipeSearchResult>;
