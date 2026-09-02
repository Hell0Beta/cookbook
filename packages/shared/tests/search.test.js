import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreIngredientMatch } from "../dist/index.js";

const row = (name, role_tag = "main", ingredient_id = null) => ({
  name,
  role_tag,
  ingredient_id,
});

describe("scoreIngredientMatch (development.md §9 step 3)", () => {
  it("scores matched_main / total_main", () => {
    const rows = [row("chicken"), row("rice"), row("lemon")];
    const result = scoreIngredientMatch(rows, { ingredient_ids: [], names: ["chicken", "rice"] });
    assert.equal(result.matched_main, 2);
    assert.equal(result.total_main, 3);
    assert.equal(result.match_score, 2 / 3);
    assert.deepEqual(result.missing.map((m) => m.name), ["lemon"]);
  });

  it("excludes swap-tagged rows from the denominator and from missing", () => {
    const rows = [row("chicken"), row("salt", "swap"), row("olive oil", "swap")];
    const result = scoreIngredientMatch(rows, { ingredient_ids: [], names: ["chicken"] });
    assert.equal(result.total_main, 1);
    assert.equal(result.match_score, 1);
    assert.deepEqual(result.missing, []);
  });

  it("an unmatched swap row does not lower the score", () => {
    const rows = [row("chicken"), row("paprika", "swap")];
    const result = scoreIngredientMatch(rows, { ingredient_ids: [], names: ["chicken"] });
    assert.equal(result.match_score, 1);
  });

  it("matches by master ingredient_id when linked", () => {
    const rows = [row("Chicken Breast", "main", "ing-1"), row("rice")];
    const result = scoreIngredientMatch(rows, { ingredient_ids: ["ing-1"], names: [] });
    assert.equal(result.matched_main, 1);
    assert.deepEqual(result.missing.map((m) => m.name), ["rice"]);
  });

  it("name matching normalizes both sides (plurals, descriptors)", () => {
    const rows = [row("Fresh Tomatoes, chopped"), row("basil", "swap")];
    const result = scoreIngredientMatch(rows, { ingredient_ids: [], names: ["tomatoes"] });
    assert.equal(result.match_score, 1);
  });

  it("no main ingredients scores 0 rather than dividing by zero", () => {
    const rows = [row("salt", "swap")];
    const result = scoreIngredientMatch(rows, { ingredient_ids: [], names: ["salt"] });
    assert.equal(result.match_score, 0);
    assert.equal(result.total_main, 0);
  });

  it("keeps ingredient_id on missing rows for grocery upsell", () => {
    const rows = [row("Chicken Breast", "main", "ing-9")];
    const result = scoreIngredientMatch(rows, { ingredient_ids: [], names: [] });
    assert.deepEqual(result.missing, [{ ingredient_id: "ing-9", name: "Chicken Breast" }]);
  });
});
