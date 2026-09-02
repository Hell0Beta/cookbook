// Recommendation engine — development.md §10. Tier 1 (deterministic internal)
// and Tier 2 (LLM "Discover") share this module so backend, API client, and UI
// never drift. Tier 1's ranking is a pure function here (testable headless);
// the API service fetches rows and feeds it.
import { z } from "zod";
import { normalizeIngredientName } from "./tagging.js";

// ── DietProfile (development.md §3) ──────────────────────────────────────────

export const DietType = z.enum([
  "vegan", "vegetarian", "keto", "paleo", "gluten_free", "dairy_free", "none",
]);
export type DietType = z.infer<typeof DietType>;

export const DIET_TYPE_LABELS: Record<DietType, string> = {
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  keto: "Keto",
  paleo: "Paleo",
  gluten_free: "Gluten-free",
  dairy_free: "Dairy-free",
  none: "No restrictions",
};

export const DietProfileInput = z.object({
  diet_types: z.array(DietType).max(10),
  // Free text, but the API normalizes against KNOWN_ALLERGENS before storing
  // (development.md §3: "normalized against a known allergen list").
  allergies: z.array(z.string().min(1).max(60)).max(40),
  excluded_ingredients: z.array(z.string().min(1).max(80)).max(100),
  preferred_cuisines: z.array(z.string().min(1).max(60)).max(30),
});
export type DietProfileInput = z.infer<typeof DietProfileInput>;

export const DietProfileOut = DietProfileInput;
export type DietProfileOut = z.infer<typeof DietProfileOut>;

// Known allergen list (development.md §3) — the big-9 kitchen allergens.
// Free-text input is normalized onto these; unmatched text passes through
// lowercased so unusual allergies ("sunflower seeds") still work.
export const KNOWN_ALLERGENS = [
  "milk", "egg", "peanut", "tree nut", "soy", "wheat", "fish", "shellfish", "sesame",
] as const;
export type KnownAllergen = (typeof KNOWN_ALLERGENS)[number];

/** Synonyms/kitchen aliases per allergen — "lactose" → "milk", "tahini" → "sesame". */
const ALLERGEN_SYNONYMS: Record<KnownAllergen, readonly string[]> = {
  milk: ["milk", "dairy", "lactose", "cream", "butter", "cheese", "yogurt", "yoghurt", "whey", "casein", "ghee"],
  egg: ["egg", "albumin", "mayonnaise", "mayo", "meringue"],
  peanut: ["peanut", "groundnut", "arachis"],
  "tree nut": ["tree nut", "treenut", "almond", "hazelnut", "walnut", "cashew", "pistachio", "pecan", "macadamia", "brazil nut", "pine nut", "chestnut"],
  soy: ["soy", "soya", "soybean", "edamame", "tofu", "miso", "tamari"],
  wheat: ["wheat", "gluten", "flour", "barley", "rye", "spelt", "semolina", "couscous", "malt", "farro"],
  fish: ["fish", "anchov", "tuna", "salmon", "cod", "tilapia", "sardine", "mackerel", "trout", "basa", "haddock"],
  shellfish: ["shellfish", "shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "squid", "octopus", "crawfish"],
  sesame: ["sesame", "tahini"],
};

/** Normalize one free-text allergy onto KNOWN_ALLERGENS (exact synonym first, then substring). */
export function normalizeAllergen(raw: string): string {
  const text = raw.trim().toLowerCase();
  if (!text) return text;
  for (const allergen of KNOWN_ALLERGENS) {
    if (ALLERGEN_SYNONYMS[allergen].includes(text)) return allergen;
  }
  for (const allergen of KNOWN_ALLERGENS) {
    if (ALLERGEN_SYNONYMS[allergen].some((s) => text.includes(s))) return allergen;
  }
  return text;
}

/** Normalize a whole allergies array (dedupes after collapsing synonyms). */
export function normalizeAllergenList(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const item of raw) {
    const normalized = normalizeAllergen(item);
    if (normalized) seen.add(normalized);
  }
  return [...seen];
}

// Preferred-cuisine picker options (Profile screen, design.md §3.7) — the
// common head of the Tag system's cuisine set; users can also type their own.
export const CUISINE_OPTIONS = [
  "Italian", "Mexican", "Indian", "Chinese", "Japanese", "Thai", "Korean",
  "Vietnamese", "French", "Mediterranean", "Greek", "Spanish", "Middle Eastern",
  "Turkish", "American", "Southern", "Caribbean", "Brazilian", "African",
  "British", "German",
] as const;

// ── Tier 1 — internal recommendations (deterministic, §10) ───────────────────

/** A recipe as fetched for ranking — enough to filter and score, no block stack. */
export interface RecommendationCandidate {
  recipe_id: string;
  title: string;
  hero_image_url: string | null;
  cuisine: string | null;
  diet_tags: string[];
  ingredient_text: string[]; // rawText lines
  updated_at: string; // ISO
}

/** One cooked-history signal — a recipe opened in cooking mode. */
export interface CookedSignal {
  recipe_id: string;
  cooked_at: string; // ISO
  cuisine: string | null;
  ingredient_text: string[];
}

export const InternalRecommendation = z.object({
  recipe_id: z.string(),
  title: z.string(),
  hero_image_url: z.string().nullable(),
  score: z.number(),
  reasons: z.array(z.string()),
});
export type InternalRecommendation = z.infer<typeof InternalRecommendation>;

export const InternalRecommendationsResponse = z.object({
  recommendations: z.array(InternalRecommendation),
  // false when the user never touched the profile screen — the UI then frames
  // results as "recently added" rather than "matched to your profile".
  profile_configured: z.boolean(),
});
export type InternalRecommendationsResponse = z.infer<typeof InternalRecommendationsResponse>;

export type RankProfile = Pick<
  DietProfileInput,
  "diet_types" | "allergies" | "excluded_ingredients" | "preferred_cuisines"
> | null;

const DAY_MS = 86_400_000;
/** Cooked-history window: signals older than this stop influencing ranking. */
const COOKED_WINDOW_DAYS = 30;
/** Recipes cooked this recently get a penalty, not a boost — don't re-suggest. */
const JUST_COOKED_DAYS = 3;
const JUST_COOKED_PENALTY = 2;
const CUISINE_MATCH_SCORE = 3;
const NEW_RECIPE_DAYS = 14;
const NEW_RECIPE_SCORE = 0.5;

/**
 * Deterministic Tier-1 ranking (development.md §10) — zero LLM calls.
 * Filter: excluded ingredients (substring on normalized names), allergies
 * (synonym-expanded), and inferable diet types (vegan/vegetarian/gluten_free/
 * dairy_free reuse the Tagging Engine's positive diet_tags; keto/paleo aren't
 * inferable so they don't filter — recorded in docs/agents). Rank: preferred
 * cuisine match + similarity to recently cooked recipes (Jaccard over
 * normalized ingredient names, time-decayed) + new-to-cookbook bonus, minus a
 * penalty for anything cooked in the last 3 days.
 */
export function rankInternalRecommendations(
  candidates: readonly RecommendationCandidate[],
  profile: RankProfile,
  cooked: readonly CookedSignal[],
  limit = 8,
): InternalRecommendation[] {
  const excluded = (profile?.excluded_ingredients ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const allergens = normalizeAllergenList(profile?.allergies ?? []);
  const dietTypes = new Set((profile?.diet_types ?? []).filter((d) => d !== "none"));
  const cuisines = new Set((profile?.preferred_cuisines ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean));

  const now = Date.now();
  const recentCooked = cooked
    .filter((c) => now - Date.parse(c.cooked_at) < COOKED_WINDOW_DAYS * DAY_MS)
    .sort((a, b) => Date.parse(b.cooked_at) - Date.parse(a.cooked_at));

  const ranked: InternalRecommendation[] = [];
  for (const candidate of candidates) {
    // ── Filtering ──
    const names = candidate.ingredient_text.map(normalizeIngredientName);
    const haystack = ` ${candidate.ingredient_text.join(" ").toLowerCase()} `;
    if (excluded.some((term) => haystack.includes(term))) continue;
    if (allergens.some((a) => namesMatchAllergen(names, a))) continue;
    if (
      (dietTypes.has("vegan") && !candidate.diet_tags.includes("vegan")) ||
      (dietTypes.has("vegetarian") && !candidate.diet_tags.includes("vegetarian")) ||
      (dietTypes.has("gluten_free") && !candidate.diet_tags.includes("gluten_free")) ||
      (dietTypes.has("dairy_free") && !candidate.diet_tags.includes("dairy_free"))
    ) {
      continue;
    }

    // ── Scoring ──
    let score = 0;
    const reasons: string[] = [];

    if (candidate.cuisine && cuisines.has(candidate.cuisine.toLowerCase())) {
      score += CUISINE_MATCH_SCORE;
      reasons.push(`Matches your preferred cuisine (${candidate.cuisine})`);
    }

    let bestSimilarity = 0;
    const candidateNames = new Set(names.filter(Boolean));
    for (const signal of recentCooked) {
      if (signal.recipe_id === candidate.recipe_id) continue; // own-cooked handled below
      const signalNames = new Set(signal.ingredient_text.map(normalizeIngredientName).filter(Boolean));
      const jaccard = jaccardSimilarity(candidateNames, signalNames);
      if (jaccard === 0) continue;
      const ageDays = (now - Date.parse(signal.cooked_at)) / DAY_MS;
      const decay = 1 - (ageDays / COOKED_WINDOW_DAYS) * 0.8; // 1.0 → 0.2 over the window
      bestSimilarity = Math.max(bestSimilarity, jaccard * decay);
      score += jaccard * decay;
    }
    if (bestSimilarity > 0.15) reasons.push("Similar to what you cooked recently");

    const ownRecentCook = recentCooked.find((c) => c.recipe_id === candidate.recipe_id);
    if (ownRecentCook) {
      const ageDays = (now - Date.parse(ownRecentCook.cooked_at)) / DAY_MS;
      if (ageDays < JUST_COOKED_DAYS) {
        score -= JUST_COOKED_PENALTY;
        reasons.push("You cooked this recently");
      }
    }

    if (now - Date.parse(candidate.updated_at) < NEW_RECIPE_DAYS * DAY_MS) {
      score += NEW_RECIPE_SCORE;
      reasons.push("New in your cookbook");
    }

    ranked.push({
      recipe_id: candidate.recipe_id,
      title: candidate.title,
      hero_image_url: candidate.hero_image_url,
      score,
      reasons,
    });
  }

  ranked.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return ranked.slice(0, limit);
}

/**
 * Ingredient names are checked against the allergen's full synonym list, not
 * just the canonical string — "heavy cream" must trip a milk allergy. Custom
 * (non-known) allergens match their own text. One deliberate exception:
 * "butter" never matches the non-dairy compounds ("peanut butter").
 */
const NON_DAIRY_BUTTERS = ["peanut", "almond", "cashew", "nut", "cocoa", "shea", "apple", "sunflower"];

function namesMatchAllergen(names: readonly string[], allergen: string): boolean {
  const synonyms = (KNOWN_ALLERGENS as readonly string[]).includes(allergen)
    ? ALLERGEN_SYNONYMS[allergen as KnownAllergen]
    : [allergen]; // custom allergen: match the raw text
  for (const name of names) {
    if (!name) continue;
    for (const synonym of synonyms) {
      if (synonym === "butter" && NON_DAIRY_BUTTERS.some((q) => name.includes(q))) continue;
      if (name.includes(synonym) || synonym.includes(name)) return true;
    }
  }
  return false;
}

function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

// ── Tier 2 — "Discover" suggestions from the local dataset (§10) ─────────────

export const DiscoverSuggestionOut = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  why_recommended: z.string(),
  // The dataset recipe this suggestion points at — set on every suggestion
  // since the local-dataset switch. The card links to the full recipe.
  recipe_id: z.string().nullable(),
  // Local /images/... path — the recipe's hero (null when the dataset row
  // had no image).
  image_url: z.string().nullable(),
});
export type DiscoverSuggestionOut = z.infer<typeof DiscoverSuggestionOut>;

export const DiscoverResponse = z.object({
  suggestions: z.array(DiscoverSuggestionOut),
  // Retained for client compatibility — always false now (no LLM call in
  // the Discover path anymore); the §5 banner logic simply never fires.
  quota_exhausted: z.boolean(),
  refreshed_at: z.string().nullable(),
});
export type DiscoverResponse = z.infer<typeof DiscoverResponse>;

/** Discover refresh cadence (§10: ~24h, in-process, no Redis). */
export const DISCOVER_REFRESH_MS = 24 * 60 * 60 * 1000;

