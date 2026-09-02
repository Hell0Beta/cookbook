import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateGroceryList,
  groupGroceryByCategory,
  formatQuantity,
} from "../dist/index.js";

function entry(partial) {
  return {
    ingredient_id: null,
    quantity: 1,
    unit: "piece",
    category: "other",
    role_tag: "main",
    recipe_title: "Test Recipe",
    ...partial,
  };
}

describe("aggregateGroceryList (development.md §8.2)", () => {
  it("sums matching units and groups by name when ingredient_id is null", () => {
    const items = aggregateGroceryList([
      entry({ display_name: "flour", quantity: 2, unit: "cup", source_recipe_id: "r1" }),
      entry({ display_name: "Flour", quantity: 1, unit: "cup", source_recipe_id: "r2" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 3);
    assert.equal(items[0].unit, "cup");
    assert.equal(items[0].display, "3");
    assert.deepEqual(items[0].source_recipe_ids, ["r1", "r2"]);
    assert.equal(items[0].recipe_count, 2);
  });

  it("converts units within a family before summing (tsp + tbsp → cup)", () => {
    // 8 tbsp + 8 tsp ≈ 157.7 ml ≈ 2/3 cup
    const items = aggregateGroceryList([
      entry({ display_name: "olive oil", quantity: 8, unit: "tbsp", source_recipe_id: "r1" }),
      entry({ display_name: "olive oil", quantity: 8, unit: "tsp", source_recipe_id: "r1" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].unit, "cup"); // all-US volume mix → cups
    assert.ok(
      Math.abs(items[0].quantity - 2 / 3) < 0.01,
      `expected ~2/3 cup, got ${items[0].quantity}`,
    );
  });

  it("converts weights and steps to kg past 1000 g", () => {
    const items = aggregateGroceryList([
      entry({ display_name: "chicken", quantity: 800, unit: "g", source_recipe_id: "r1" }),
      entry({ display_name: "chicken", quantity: 0.9, unit: "kg", source_recipe_id: "r2" }),
    ]);
    // Mixed metric weights → base g (1700) → ≥1000 → kg
    assert.equal(items.length, 1);
    assert.equal(items[0].unit, "kg");
    assert.ok(Math.abs(items[0].quantity - 1.7) < 0.01);
    assert.equal(items[0].display, "1.7");
  });

  it("keeps incompatible unit families as separate non-summed lines", () => {
    const items = aggregateGroceryList([
      entry({ display_name: "flour", quantity: 2, unit: "cup", source_recipe_id: "r1" }),
      entry({ display_name: "flour", quantity: 200, unit: "g", source_recipe_id: "r2" }),
    ]);
    assert.equal(items.length, 2);
    const units = items.map((i) => i.unit).sort();
    assert.deepEqual(units, ["cup", "g"]);
  });

  it("sums whole items as counts and flags awkward rounds", () => {
    const items = aggregateGroceryList([
      entry({ display_name: "eggs", quantity: 2, unit: "piece", source_recipe_id: "r1" }),
      entry({ display_name: "eggs", quantity: 3, unit: "piece", source_recipe_id: "r2" }),
      entry({ display_name: "eggs", quantity: 1, unit: "piece", source_recipe_id: "r3" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].display, "6");
    assert.equal(items[0].recipe_count, 3);

    const awkward = aggregateGroceryList([
      entry({ display_name: "eggs", quantity: 2.5, unit: "piece", source_recipe_id: "r1" }),
    ]);
    assert.equal(awkward[0].display, "~2–3");
    assert.equal(awkward[0].approximate, true);
  });

  it("never sums to_taste / unquantified items — merges with recipe count", () => {
    const items = aggregateGroceryList([
      entry({ display_name: "salt to taste", quantity: null, unit: "to_taste", source_recipe_id: "r1" }),
      entry({ display_name: "Salt To Taste", quantity: null, unit: null, source_recipe_id: "r2" }),
      entry({ display_name: "salt to taste", quantity: null, unit: "to_taste", source_recipe_id: "r1" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "loose");
    assert.equal(items[0].quantity, null);
    assert.equal(items[0].recipe_count, 2);
    assert.equal(items[0].display, "");
  });

  it("keeps a single loose item's quantity (1 pinch salt)", () => {
    const items = aggregateGroceryList([
      entry({ display_name: "salt", quantity: 1, unit: "pinch", source_recipe_id: "r1" }),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 1);
    assert.equal(items[0].unit, "pinch");
    assert.equal(items[0].display, "1");
  });

  it("sums exactly pre-scaled quantities (servings overrides applied upstream)", () => {
    // r1: 2 eggs scaled ×1.5 = 3; r2: 1 egg unscaled → 4 total
    const items = aggregateGroceryList([
      entry({ display_name: "eggs", quantity: 3, unit: "piece", source_recipe_id: "r1" }),
      entry({ display_name: "eggs", quantity: 1, unit: "piece", source_recipe_id: "r2" }),
    ]);
    assert.equal(items[0].quantity, 4);
    assert.equal(items[0].display, "4");
  });

  it("groups output by category in aisle order", () => {
    const items = aggregateGroceryList([
      entry({ display_name: "milk", category: "dairy", source_recipe_id: "r1" }),
      entry({ display_name: "carrots", category: "produce", source_recipe_id: "r1" }),
      entry({ display_name: "cumin", category: "spice", source_recipe_id: "r1" }),
    ]);
    const groups = groupGroceryByCategory(items);
    assert.deepEqual(groups.map((g) => g.category), ["produce", "dairy", "spice"]);
    assert.deepEqual(
      groups[0].items.map((i) => i.label),
      ["carrots"],
    );
  });

  it("prefers ingredient_id grouping over name collisions", () => {
    // Two different master ingredients that happen to share raw text must not merge.
    const items = aggregateGroceryList([
      entry({ display_name: "pepper", ingredient_id: "ing-black-pepper", source_recipe_id: "r1" }),
      entry({ display_name: "pepper", ingredient_id: "ing-bell-pepper", source_recipe_id: "r1" }),
    ]);
    assert.equal(items.length, 2);
  });
});

describe("formatQuantity (grocery display)", () => {
  it("renders kitchen fractions for US volumes", () => {
    assert.equal(formatQuantity(1.5, "cup").display, "1½");
    assert.equal(formatQuantity(0.5, "tsp").display, "½");
  });

  it("renders metric volumes and weights with ≤1 decimal", () => {
    assert.equal(formatQuantity(950, "ml").display, "950");
    assert.equal(formatQuantity(1.25, "kg").display, "1.3");
    assert.equal(formatQuantity(66.666, "g").display, "66.7");
  });

  it("renders whole items as whole numbers", () => {
    assert.equal(formatQuantity(4, "piece").display, "4");
    assert.equal(formatQuantity(4.5, "piece").display, "~4–5");
  });
});
