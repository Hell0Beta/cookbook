// TheMealDB client — development.md §4: default public-API provider (free,
// no key). Called for user-initiated imports and, per §0's amended allowlist,
// for Discover image resolution at refresh time (≤6 batched lookups per user
// per day). Spoonacular lands behind config.spoonacular.enabled when its
// features are needed; until then this file is the whole provider surface.
import { ttlCache } from "./cache.js";
import { ApiError } from "../middleware/error.js";
import type { ImportSearchResult } from "@cookbook/shared";

const BASE = "https://www.themealdb.com/api/json/v1/1";

// §0: no Redis — a warm in-process cache also keeps repeated searches/imports
// from hammering the free tier.
const searchCache = ttlCache<ImportSearchResult[]>(10 * 60_000);
const lookupCache = ttlCache<MealDbMeal | null>(60 * 60_000);

export interface MealDbMeal {
  idMeal: string;
  strMeal: string;
  strCategory: string | null;
  strArea: string | null;
  strInstructions: string | null;
  strMealThumb: string | null;
  strTags: string | null; // comma-separated
  strSource: string | null;
  strYoutube: string | null;
  [key: `strIngredient${number}`]: string | null;
  [key: `strMeasure${number}`]: string | null;
}

/** Meal type guess from the MealDB category (→ system tag meal_type). */
const MEAL_TYPE_BY_CATEGORY: Record<string, string> = {
  Breakfast: "Breakfast",
  Dessert: "Dessert",
  Snack: "Snack",
  Starter: "Snack",
  Side: "Snack",
  Beverage: "Drink",
};

export function mealDbMealType(category: string | null): string | null {
  if (!category) return null;
  return MEAL_TYPE_BY_CATEGORY[category] ?? null;
}

async function mealDbFetch<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch {
    throw new ApiError(502, "provider_unreachable", "Could not reach TheMealDB");
  }
  if (!res.ok) throw new ApiError(502, "provider_error", `TheMealDB returned ${res.status}`);
  return (await res.json()) as T;
}

/** Search by name — GET /recipes/import/public-api/search?q= */
export async function searchMealDb(query: string): Promise<ImportSearchResult[]> {
  const key = `s=${query}`;
  const cached = searchCache.get(key);
  if (cached) return cached;
  const { meals } = await mealDbFetch<{ meals: MealDbMeal[] | null }>(`/search.php?s=${encodeURIComponent(query)}`);
  const results: ImportSearchResult[] = (meals ?? []).map((m) => ({
    provider_recipe_id: m.idMeal,
    title: m.strMeal,
    thumbnail_url: m.strMealThumb,
    category: m.strCategory,
    area: m.strArea,
  }));
  searchCache.set(key, results);
  return results;
}

export async function lookupMealDbMeal(id: string): Promise<MealDbMeal> {
  const cached = lookupCache.get(`i=${id}`);
  if (cached !== undefined) {
    if (cached === null) throw new ApiError(404, "provider_recipe_not_found");
    return cached;
  }
  const { meals } = await mealDbFetch<{ meals: MealDbMeal[] | null }>(`/lookup.php?i=${encodeURIComponent(id)}`);
  const meal = meals?.[0] ?? null;
  lookupCache.set(`i=${id}`, meal);
  if (!meal) throw new ApiError(404, "provider_recipe_not_found");
  return meal;
}

// Discover image resolution (§10/§0 as amended): meal-list responses of the
// ingredient filter, cached so repeated refreshes don't re-fetch.
interface MealDbListItem {
  idMeal: string;
  strMeal: string;
  strMealThumb: string | null;
}
const filterCache = ttlCache<MealDbListItem[]>(24 * 60 * 60 * 1000);

async function mealDbFilter(term: string): Promise<MealDbListItem[] | null> {
  const cached = filterCache.get(term);
  if (cached) return cached;
  try {
    const { meals } = await mealDbFetch<{ meals: MealDbListItem[] | null }>(
      `/filter.php?i=${encodeURIComponent(term)}`,
    );
    filterCache.set(term, meals ?? []);
    return meals ?? [];
  } catch {
    return null; // provider unreachable — render image-less, don't block
  }
}

// Connectors and generic cooking adjectives: matching on "spicy" or "with"
// would tie unrelated dishes. Stemmed (trailing "s" dropped) so "chickpeas"
// scores against "chickpea".
const SCORING_STOPWORDS = new Set([
  "and", "with", "the", "for", "from", "of", "in", "over",
  "spicy", "creamy", "easy", "quick", "homemade", "style", "fried", "fresh",
]);

function contentWords(s: string): Set<string> {
  const words = s
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2 && !SCORING_STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
  return new Set(words);
}

/**
 * Find a representative thumbnail for a Discover suggestion: filter
 * TheMealDB by the suggestion's main ingredient, then pick the meal whose
 * name overlaps the suggestion title most (stemmed, stopword-free). Returns
 * null when the filter yields nothing with any word overlap — a wrong-dish
 * image is worse than none. Never throws (image resolution must not fail
 * the Discover refresh).
 */
export async function findMealDbThumb(
  searchTerm: string,
  title: string,
): Promise<string | null> {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return null;
  let candidates = (await mealDbFilter(term)) ?? [];
  if (candidates.length === 0) {
    // MealDB ingredient names are inconsistent about plurals — the model's
    // "chickpea" needs to become "chickpeas" (and vice versa).
    const alt = term.endsWith("s") ? term.slice(0, -1) : `${term}s`;
    candidates = (await mealDbFilter(alt)) ?? [];
  }
  if (candidates.length === 0) return null;

  const titleWords = contentWords(title);
  let best: { thumb: string; score: number } | null = null;
  for (const meal of candidates) {
    if (!meal.strMealThumb) continue;
    let score = 0;
    for (const word of contentWords(meal.strMeal)) if (titleWords.has(word)) score += 1;
    if (score > (best?.score ?? 0)) best = { thumb: meal.strMealThumb, score };
  }
  return best && best.score > 0 ? best.thumb : null;
}

/** TheMealDB pairs strIngredientN with strMeasureN (1..20, empty slots null). */
export function mealDbIngredients(meal: MealDbMeal): { name: string; measure: string }[] {
  const out: { name: string; measure: string }[] = [];
  for (let n = 1; n <= 20; n++) {
    const name = meal[`strIngredient${n}`];
    if (!name?.trim()) continue;
    out.push({ name: name.trim(), measure: (meal[`strMeasure${n}`] ?? "").trim() });
  }
  return out;
}
