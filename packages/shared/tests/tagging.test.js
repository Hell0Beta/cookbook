import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeIngredientName,
  classifyRoleTag,
  inferDietTags,
  prepTimeBucket,
  difficultyHeuristic,
  systemTagsForRecipe,
  ingredientCategory,
  estimateDurationMinutes,
} from "../dist/index.js";

describe("normalizeIngredientName (development.md §4 step 3)", () => {
  it("lowercases, strips parens/punctuation, and singularizes", () => {
    assert.equal(normalizeIngredientName("Fresh Tomatoes, chopped"), "tomato");
    assert.equal(normalizeIngredientName("Free-range eggs (optional)"), "egg");
  });

  it("strips leading descriptor prefixes one after another", () => {
    assert.equal(normalizeIngredientName("finely chopped red onion"), "red onion");
  });

  it("returns empty string for pure descriptors", () => {
    assert.equal(normalizeIngredientName("chopped"), "");
  });
});

describe("classifyRoleTag (development.md §6.1)", () => {
  const ing = (name, quantity = null, unit = null) => ({ name, quantity, unit });

  it("title-mentioned ingredient wins", () => {
    assert.equal(classifyRoleTag(ing("paneer", 200, "g"), "Palak Paneer"), "main");
  });

  it("proteins and primary starches default to main", () => {
    assert.equal(classifyRoleTag(ing("chicken breast", 2, "piece"), "Curry"), "main");
    assert.equal(classifyRoleTag(ing("spaghetti", 500, "g"), "Salad"), "main");
  });

  it("flexible ingredients default to swap", () => {
    assert.equal(classifyRoleTag(ing("olive oil", 2, "tbsp"), "Anything"), "swap");
    assert.equal(classifyRoleTag(ing("salt", null, "to_taste"), "Anything"), "swap");
  });

  it("small measured quantities of flexible-ish items are swap", () => {
    assert.equal(classifyRoleTag(ing("smoked paprika", 1, "tsp"), "Stew"), "swap");
    // but a tablespoon of it is a real player
    assert.equal(classifyRoleTag(ing("smoked paprika", 2, "tbsp"), "Stew"), "main");
  });
});

describe("inferDietTags (development.md §6.2)", () => {
  it("pure plant list is vegan + everything free", () => {
    const tags = inferDietTags(["chickpea", "tomato", "olive oil", "spinach"]);
    assert.ok(tags.includes("vegan"));
    assert.ok(tags.includes("vegetarian"));
    assert.ok(tags.includes("gluten_free"));
    assert.ok(tags.includes("dairy_free"));
    assert.ok(tags.includes("nut_free"));
  });

  it("meat blocks vegan and vegetarian but not the others", () => {
    const tags = inferDietTags(["chicken", "rice", "olive oil"]);
    assert.ok(!tags.includes("vegan"));
    assert.ok(!tags.includes("vegetarian"));
    assert.ok(tags.includes("dairy_free"));
  });

  it("ambiguous animal products err toward not claiming", () => {
    // Worcestershire contains anchovy → no vegan/vegetarian claim
    const tags = inferDietTags(["worcestershire sauce", "tomato"]);
    assert.ok(!tags.includes("vegan"));
    assert.ok(!tags.includes("vegetarian"));
  });

  it("flour blocks gluten_free; milk blocks dairy_free but keeps vegetarian", () => {
    const withGluten = inferDietTags(["flour", "water"]);
    assert.ok(!withGluten.includes("gluten_free"));
    const withDairy = inferDietTags(["milk", "rice"]);
    assert.ok(!withDairy.includes("dairy_free"));
    assert.ok(withDairy.includes("vegetarian"));
  });
});

describe("system tag heuristics (development.md §6.3)", () => {
  it("prep time buckets are half-open at each boundary", () => {
    assert.equal(prepTimeBucket(14), "Under 15 min");
    assert.equal(prepTimeBucket(15), "Under 30 min");
    assert.equal(prepTimeBucket(30), "Under 60 min");
    assert.equal(prepTimeBucket(60), "Over 60 min");
    assert.equal(prepTimeBucket(null), null);
  });

  it("difficulty grows with steps + time", () => {
    assert.equal(difficultyHeuristic(3, 20), "easy");   // 3 + 1.33
    assert.equal(difficultyHeuristic(6, 60), "medium"); // 6 + 4
    assert.equal(difficultyHeuristic(15, 90), "hard");  // 15 + 6
  });

  it("systemTagsForRecipe emits known tags + derived buckets", () => {
    const tags = systemTagsForRecipe({
      cuisine: "Italian",
      mealType: null,
      totalMinutes: 25,
      stepCount: 5,
      dietTags: ["vegetarian"],
    });
    assert.deepEqual(tags, [
      { tag_type: "cuisine", label: "Italian" },
      { tag_type: "prep_time", label: "Under 30 min" },
      { tag_type: "difficulty", label: "easy" }, // 5 + 25/15 ≈ 6.7
      { tag_type: "diet", label: "Vegetarian" },
    ]);
  });
});

describe("ingredientCategory (development.md §6.4)", () => {
  it("maps normalized names to grocery categories", () => {
    assert.equal(ingredientCategory("Fresh Tomatoes"), "produce");
    assert.equal(ingredientCategory("whole milk"), "dairy");
    assert.equal(ingredientCategory("chicken breast"), "meat");
    assert.equal(ingredientCategory("ground cumin"), "spice");
    assert.equal(ingredientCategory("spaghetti"), "pantry");
    assert.equal(ingredientCategory("sourdough"), "bakery");
    // "frozen" is a stripped descriptor, so frozen matches via non-descriptor names
    assert.equal(ingredientCategory("ice cream"), "frozen");
    assert.equal(ingredientCategory("eggs"), "dairy");
    assert.equal(ingredientCategory("salt, to taste"), "spice");
    assert.equal(ingredientCategory("lamb chops"), "meat");
  });

  it("falls back to the last word for unlisted compound names", () => {
    // "cheddar cheese" isn't in the table, but "cheese" is
    assert.equal(ingredientCategory("cheddar cheese"), "dairy");
    assert.equal(ingredientCategory("baby spinach"), "produce");
  });

  it("prefers an exact compound match over the last word", () => {
    assert.equal(ingredientCategory("tomato sauce"), "pantry"); // not produce
  });

  it("falls back to other", () => {
    assert.equal(ingredientCategory("mysterious goo"), "other");
  });
});

describe("estimateDurationMinutes (development.md §4 step 2)", () => {
  it("parses minutes and hours, taking the longest cue", () => {
    assert.equal(estimateDurationMinutes("Simmer for 10 minutes, stirring"), 10);
    assert.equal(estimateDurationMinutes("Bake for 1 hour"), 60);
    assert.equal(estimateDurationMinutes("Rest 5 min, then roast 40 minutes"), 40);
    assert.equal(estimateDurationMinutes("Cook for 1-2 hours until tender"), 120);
  });

  it("returns null when no duration cue exists", () => {
    assert.equal(estimateDurationMinutes("Chop everything finely"), null);
  });
});
