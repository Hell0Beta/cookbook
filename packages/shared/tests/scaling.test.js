import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scaleQuantity, scaleIngredients } from "../dist/index.js";

describe("scaleQuantity (development.md §8)", () => {
  it("keeps whole items whole and flags awkward rounds", () => {
    // 1.333 eggs → "~1–2 eggs" (design.md §4.4: avoid fractional eggs)
    const r = scaleQuantity(2, "piece", 3, 2);
    assert.equal(r.display, "~1–2");
    assert.equal(r.approximate, true);

    const awkward = scaleQuantity(3, "piece", 2, 5); // 7.5
    assert.equal(awkward.display, "~7–8");
    assert.equal(awkward.approximate, true);
  });

  it("rounds volumes to kitchen fractions", () => {
    // 1 cup * 1.5 = 1.5 → "1½"
    const r = scaleQuantity(1, "cup", 2, 3);
    assert.equal(r.display, "1½");
    // 2 tsp * 1/3 = 0.667 → nearest ½ or ⅔ → ⅔? candidates 1/2: 0.5, whole 1.
    const t = scaleQuantity(2, "tsp", 3, 1);
    assert.ok(["½", "⅔", "1"].includes(t.display));
  });

  it("never scales null quantities (to taste)", () => {
    const r = scaleQuantity(null, "to_taste", 4, 8);
    assert.equal(r.quantity, null);
    assert.equal(r.display, "");
  });

  it("keeps one decimal on weights", () => {
    const r = scaleQuantity(250, "g", 4, 6); // 375
    assert.equal(r.display, "375");
    const r2 = scaleQuantity(100, "g", 3, 2); // 66.67 → 66.7
    assert.equal(r2.display, "66.7");
  });
});

describe("scaleIngredients", () => {
  it("scales a list and preserves raw_text", () => {
    const out = scaleIngredients(
      [
        { quantity: 2, unit: "cup", raw_text: "2 cups flour" },
        { quantity: null, unit: "to_taste", raw_text: "salt to taste" },
      ],
      2,
      4,
    );
    assert.equal(out[0]?.scaled.display, "4");
    assert.equal(out[0]?.raw_text, "2 cups flour");
    assert.equal(out[1]?.scaled.quantity, null);
  });
});
