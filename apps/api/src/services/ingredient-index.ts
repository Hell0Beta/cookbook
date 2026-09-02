// Inverted index for ingredient-based search (development.md §9 step 1):
// ingredient_id → recipe_ids, plus a normalized-name map covering manual
// recipes whose RecipeIngredient rows link no master Ingredient. In-memory
// Map rebuilt lazily on first use and dropped on every recipe write — no new
// table, no daemon, sized for ≤5 users (development.md §0). Write paths
// invalidate via persist.writeBlocks and the recipe DELETE route.
import { normalizeIngredientName } from "@cookbook/shared";
import { prisma } from "../db.js";

export interface IngredientIndex {
  byIngredientId: Map<string, Set<string>>;
  byName: Map<string, Set<string>>;
}

let index: IngredientIndex | null = null;
let building: Promise<IngredientIndex> | null = null;

async function buildIndex(): Promise<IngredientIndex> {
  const byIngredientId = new Map<string, Set<string>>();
  const byName = new Map<string, Set<string>>();
  const rows = await prisma.recipeIngredient.findMany({
    select: { recipeId: true, ingredientId: true, rawText: true },
  });
  for (const row of rows) {
    if (row.ingredientId) {
      addTo(byIngredientId, row.ingredientId, row.recipeId);
    } else {
      const name = normalizeIngredientName(row.rawText);
      if (name) addTo(byName, name, row.recipeId);
    }
  }
  return { byIngredientId, byName };
}

function addTo(map: Map<string, Set<string>>, key: string, recipeId: string) {
  const set = map.get(key);
  if (set) set.add(recipeId);
  else map.set(key, new Set([recipeId]));
}

/** Lazily-built singleton; concurrent first callers share one rebuild. */
export function getIngredientIndex(): Promise<IngredientIndex> {
  if (index) return Promise.resolve(index);
  if (!building) {
    building = buildIndex()
      .catch((err) => {
        building = null; // failed builds retry on the next call
        throw err;
      })
      .then((built) => {
        index = built;
        return built;
      });
  }
  return building;
}

/** Drop the cached index — the next search rebuilds it from current rows. */
export function invalidateIngredientIndex(): void {
  index = null;
}

/**
 * Candidate recipe ids for the given pantry: union of the master-id postings
 * and the normalized-name postings. Visibility (own + shared imports) is the
 * caller's concern — the index is global by design.
 */
export async function candidateRecipeIds(
  ingredientIds: Iterable<string>,
  names: Iterable<string>,
): Promise<Set<string>> {
  const idx = await getIngredientIndex();
  const out = new Set<string>();
  for (const id of ingredientIds) {
    for (const recipeId of idx.byIngredientId.get(id) ?? []) out.add(recipeId);
  }
  for (const raw of names) {
    const name = normalizeIngredientName(raw);
    if (!name) continue;
    for (const recipeId of idx.byName.get(name) ?? []) out.add(recipeId);
  }
  return out;
}
