// Discover Tier 2 — prompt shaping + output repair (development.md §10, §0).
// The api service (apps/api/src/services/discover.ts) is a thin host around
// these pure functions; keeping them here makes the one sanctioned LLM call
// per ~24h refresh testable headless.
// Tier 1 (rankInternalRecommendations) tests live here too — same module.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  rankInternalRecommendations,
  normalizeAllergen,
  normalizeAllergenList,
} from "../dist/recommendations.js";

const profile = {
  diet_types: ["vegan"],
  allergies: ["peanut"],
  excluded_ingredients: ["coriander"],
  preferred_cuisines: ["Thai", "Mexican"],
};

// ── Tier 1: rankInternalRecommendations (development.md §10) ─────────────────

const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

const recipe = (over = {}) => ({
  recipe_id: "r1",
  title: "Base",
  hero_image_url: null,
  cuisine: null,
  diet_tags: [],
  ingredient_text: ["2 cups rice", "1 chicken breast"],
  updated_at: iso(60),
  ...over,
});

test("normalizeAllergen collapses synonyms onto the canonical allergen", () => {
  assert.equal(normalizeAllergen("Lactose"), "milk");
  assert.equal(normalizeAllergen("Tahini"), "sesame");
  assert.equal(normalizeAllergen("  Shrimp  "), "shellfish");
  assert.equal(normalizeAllergen("sunflower seeds"), "sunflower seeds"); // unknown passes through
  assert.deepEqual(normalizeAllergenList(["lactose", "Milk", "tahini"]), ["milk", "sesame"]);
});

test("Tier 1 filters excluded ingredients by substring match", () => {
  const out = rankInternalRecommendations(
    [recipe({ recipe_id: "a", title: "Has cilantro", ingredient_text: ["1 bunch cilantro"] }),
     recipe({ recipe_id: "b", title: "Clean" })],
    { diet_types: [], allergies: [], excluded_ingredients: ["cilantro"], preferred_cuisines: [] },
    [],
  );
  assert.deepEqual(out.map((r) => r.recipe_id), ["b"]);
});

test("Tier 1 filters allergies through ingredient names", () => {
  const out = rankInternalRecommendations(
    [recipe({ recipe_id: "a", title: "Creamy", ingredient_text: ["1 cup heavy cream"] }),
     recipe({ recipe_id: "b", title: "Safe", ingredient_text: ["2 tomatoes"] })],
    { diet_types: [], allergies: ["milk"], excluded_ingredients: [], preferred_cuisines: [] },
    [],
  );
  assert.deepEqual(out.map((r) => r.recipe_id), ["b"]);
});

test("Tier 1 filters vegan/vegetarian via the tagging engine's positive diet_tags", () => {
  const out = rankInternalRecommendations(
    [recipe({ recipe_id: "a", title: "Meaty", diet_tags: [] }),
     recipe({ recipe_id: "b", title: "Veg", diet_tags: ["vegetarian", "vegan"] })],
    { diet_types: ["vegan"], allergies: [], excluded_ingredients: [], preferred_cuisines: [] },
    [],
  );
  assert.deepEqual(out.map((r) => r.recipe_id), ["b"]);
});

test("Tier 1 boosts preferred cuisine matches and says why", () => {
  const out = rankInternalRecommendations(
    [recipe({ recipe_id: "a", title: "A", cuisine: "Italian" }),
     recipe({ recipe_id: "b", title: "B", cuisine: "Thai" })],
    { diet_types: [], allergies: [], excluded_ingredients: [], preferred_cuisines: ["thai"] },
    [],
  );
  assert.equal(out[0].recipe_id, "b");
  assert.ok(out[0].reasons.some((r) => r.includes("Thai")));
});

test("Tier 1 penalizes recipes cooked in the last 3 days", () => {
  const out = rankInternalRecommendations(
    [recipe({ recipe_id: "a", title: "A", cuisine: "Thai" }),
     recipe({ recipe_id: "b", title: "B", cuisine: "Thai" })],
    { diet_types: [], allergies: [], excluded_ingredients: [], preferred_cuisines: ["thai"] },
    [{ recipe_id: "a", cooked_at: iso(1), cuisine: "Thai", ingredient_text: ["2 cups rice"] }],
  );
  assert.equal(out[0].recipe_id, "b"); // a's cuisine boost is cancelled by the -2 penalty
  assert.ok(out[1].reasons.includes("You cooked this recently"));
});

test("Tier 1 rewards similarity to recently cooked dishes", () => {
  const out = rankInternalRecommendations(
    [recipe({ recipe_id: "a", title: "Different", ingredient_text: ["1 cup oats", "1 banana"] }),
     recipe({ recipe_id: "b", title: "Similar", ingredient_text: ["2 cups rice", "1 chicken breast", "1 onion"] })],
    null, // no profile — pure signal test
    [{ recipe_id: "other", cooked_at: iso(0.5), cuisine: null, ingredient_text: ["2 cups rice", "1 chicken breast", "3 cloves garlic"] }],
  );
  assert.equal(out[0].recipe_id, "b");
  assert.ok(out[0].reasons.includes("Similar to what you cooked recently"));
});

test("Tier 1: no profile and no signals still ranks (recency + alpha order)", () => {
  const out = rankInternalRecommendations(
    [recipe({ recipe_id: "a", title: "Zeta", updated_at: iso(1) }),
     recipe({ recipe_id: "b", title: "Alpha", updated_at: iso(1) })],
    null,
    [],
  );
  assert.equal(out[0].recipe_id, "b"); // tie broken by title
  assert.ok(out[0].reasons.includes("New in your cookbook"));
});

test("Tier 1 caps the result count", () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    recipe({ recipe_id: `r${i}`, title: `R${i}`, updated_at: iso(60) }),
  );
  assert.equal(rankInternalRecommendations(many, null, [], 5).length, 5);
});

test("Tier 1 carries hero_image_url through to the output", () => {
  const out = rankInternalRecommendations(
    [recipe({ hero_image_url: "/images/x.jpg" })],
    null,
    [],
  );
  assert.equal(out[0].hero_image_url, "/images/x.jpg");
});

test("Tier 1 milk allergy matches dairy aliases but not peanut butter", () => {
  const out = rankInternalRecommendations(
    [recipe({ recipe_id: "a", title: "Creamy pasta", ingredient_text: ["1 cup heavy cream"] }),
     recipe({ recipe_id: "b", title: "PB toast", ingredient_text: ["2 tbsp peanut butter", "1 slice bread"] }),
     recipe({ recipe_id: "c", title: "Clean", ingredient_text: ["2 tomatoes"] })],
    { diet_types: [], allergies: ["milk"], excluded_ingredients: [], preferred_cuisines: [] },
    [],
  );
  assert.deepEqual(out.map((r) => r.recipe_id), ["c", "b"]); // both pass the filter; tie breaks by title
});
