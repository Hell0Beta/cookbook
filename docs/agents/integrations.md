# Integrations Agent

## What you own

The outside-world plumbing and the numeric core: the public recipe API import pipeline, raw ingredient parsing, the unit conversion engine (serving scaling + grocery aggregation math), and the master ingredient dictionary.

## Explicit read list

- `docs/development.md` — **your primary document.**
  - §0 Deployment Constraints — **binding: offline-first, ≤5 users.** TheMealDB is the default provider (free, no key); Spoonacular only behind a config flag.
  - §4 Ingesting Recipes from a Public API (TheMealDB primary path, Spoonacular optional, the 5-step normalization pipeline)
  - §8 "Serving Scaling & Grocery List Aggregation" (scaling formula, unit-family conversion, fraction rounding, non-summed lines)
  - §9 Ingredient-Based Search (the inverted index you help maintain; match-score weighting)
  - §3 Data Model — `Ingredient` (canonical_name, category, default_unit, nutrition_ref), `RecipeIngredient` (raw_text, quantity, unit enum, sort_order), `GroceryListItem` (aggregated_quantity, unit, category, source_recipe_ids)
  - §2 Recommended Libraries (parse-ingredient, convert-units, fraction.js — picked specifically for your features)
  - §13 Open Questions (Spoonacular vs Edamam vs TheMealDB is explicitly yours to resolve)
- `docs/design.md` — §4.4 (Servings Scaling UX: "avoid 1.333 eggs" — your rounding rules implement this), §3.6 (Grocery List: grouped by category, summed/converted quantities).
- Your phase checklists in `docs/todos/` (phases 2, 3 are mostly yours).

## Scope

**Public API import pipeline — development.md §4:**
1. Fetch recipe from provider. **Default: TheMealDB** (free, no key — good for seeding/demo; per §0). **Spoonacular is optional, behind a config flag** (`findByIngredients`, `extract`, structured ingredients with `aisle`) — only enabled if the owner provides a key; when disabled, its features (web import, ingredient-search fallback) hide or degrade cleanly.
2. Map fields → `Recipe` (+ split instructions into `RecipeStep` rows; null durations when the provider doesn't supply them).
3. Map provider ingredients → look up/create `Ingredient` master rows with fuzzy match on `canonical_name` ("tomato" vs "tomatoes" must not duplicate).
4. Hand off to the Tagging Engine (ai-pipeline's service) before saving — provider tags are never the sole truth.
5. Set `source_type = public_api`, `source_url` for attribution.

**Web import (`POST /recipes/import/url`):** Spoonacular's `extract` endpoint for arbitrary URLs (development.md §4) — **only when the Spoonacular flag is enabled**; otherwise this entry point is hidden in the UI. Then the same normalization path.

**Ingredient parsing:** `parse-ingredient` (or `recipe-ingredient-parser-v2`) normalizing raw strings — "2 cups flour, chopped" → `{quantity, unit, ingredient}` — for YouTube-extracted and public-API ingredients before they reach the Tagging Engine. Also powers the ingredient autocomplete against the `Ingredient` master table (§9 step 2).

**Unit conversion engine (development.md §8):**
- Scaling: `scaled_quantity = raw_quantity * (target_servings / base_servings)`; unit-aware rounding — nearest ¼/⅓/½ for cups/tsp/tbsp (fraction.js), whole units for `piece` items (never fractional eggs; "~2–3 eggs" style flag when awkward); `quantity = null` items never scale.
- Aggregation math: group by `ingredient_id`; sum matching units; convert within unit families (volume: tsp→tbsp→cup; weight: g→kg; count) via convert-units; incompatible or `to_taste` items become separate non-summed lines ("+ salt to taste (from 2 recipes)"); output grouped by `Ingredient.category`.
- Export these as pure functions in `packages/shared` so the frontend can render live scaling previews without a round-trip.

**Ingredient dictionary maintenance:** the master `Ingredient` table — fuzzy matching, canonicalization, category seeds from provider `aisle` fields.

**Inverted index (§9 step 1):** `ingredient_id → [recipe_ids]` — a plain indexed table maintained on write or an in-memory Map rebuilt on startup (no Elasticsearch/Meilisearch at this scale, per §0); you build/maintain it, ai-pipeline's role-tag weighting consumes it (coordinate the match-score formula: `matched_main / total_main`, swap weighted ~0.3 or excluded from the denominator).

## Explicitly NOT your job

- **Tagging/classification decisions** (main/swap, diet tags) — ai-pipeline owns the Tagging Engine; your pipeline hands recipes to it at step 4.
- **YouTube import** — ai-pipeline owns §5 entirely.
- **API routes** — backend owns `POST /recipes/import/public-api`, `/recipes/import/url`, `GET /recipes/:id/scale`, and grocery-list endpoints; you own the modules they call.
- **Grocery list UI and persistence** — frontend renders it; backend persists `GroceryList`/`GroceryListItem` rows. You provide the aggregation math as a pure function.
- **Recommendation logic** — ai-pipeline.

## Key implementation notes (from development.md)

- Use `convert-units` for unit-family conversions — don't hand-write conversion tables (§2).
- Use `fraction.js` for ½/⅓/¾ output formatting — it directly solves design.md §4.4's "1.333 eggs" problem (§2).
- Spoonacular's structured ingredients map directly onto `RecipeIngredient`/`GroceryListItem.category` via the `aisle` field (§4).
- Keep the unit enum exactly as specified: `g, kg, ml, l, tsp, tbsp, cup, oz, lb, piece, pinch, to_taste, ...` (§3, RecipeIngredient).
- Fuzzy matching happens at import time AND when users type ingredients — one shared matcher, not two.

## Definition of done

- [ ] Import pipeline runs the 5 normalization steps in order, ending with a Tagging Engine handoff.
- [ ] Duplicate ingredients are impossible: fuzzy match on `canonical_name` collapses "tomato"/"tomatoes".
- [ ] Scaling and aggregation are pure, unit-tested functions exported from `packages/shared`.
- [ ] Fraction rounding rules implemented (no fractional whole items; practical fractions for volumes; nulls pass through).
- [ ] Incompatible units produce separate non-summed lines with recipe-count annotation.
- [ ] Provider choice implemented per development.md §0/§4: TheMealDB default, Spoonacular behind a config flag that hides its features when off; recorded in "Decisions" below. Todo items checked off in `docs/todos/`.

## Decisions

*(record: chosen provider + why (rate limits/budget), fuzzy-match strategy and threshold, any added unit enum values — update development.md §3/§13 in the same change if the enum changes)*

- **Scaling math landed in Phase 1** (`packages/shared/src/scaling.ts`, tested): kitchen-fraction rounding for volumes (nearest of ⅛/¼/⅓/½ + wholes), whole-items-only for `piece` with `~N–N+1` display when the scaled value sits awkwardly between wholes (>0.25 from nearest), one decimal for weights, ½-steps for `pinch`/`to_taste`/unitless, null quantities pass through untouched. Shared by both the frontend stepper (client-side) and `GET /recipes/:id/scale` (server-side) — one implementation, no drift.
- **Grocery aggregation landed in Phase 2** (`packages/shared/src/grocery.ts`, tested): grouping key is `ingredient_id` when matched, else normalized name (case/whitespace-insensitive), so Phase 1's free-text ingredients still de-duplicate correctly across recipes. Unit-family conversion via `convert-units` (v2 spells tablespoon `Tbs` — see `cu()`); volumes convert through an ml base, weights through g, and results are rounded at 1e-6 to kill float noise from round-trips. Mixed-unit display: all-US-customary volumes → cups; otherwise metric base with a kg/l step at ≥1000. `pinch` never sums (treat it like `to_taste`); incompatible families (cup flour + g flour) stay as separate lines per §8.2 #4. Rounding happens exactly once — after summing, via `formatQuantity` — never on the input quantities.
- **TheMealDB is the only provider wired (Phase 3)** — `apps/api/src/services/mealdb.ts`; Spoonacular stays behind `config.spoonacular.enabled` with no code paths until its features are actually needed (§0: don't build what the flag hides). MealDB quirks learned live: `latest.php` is Patreon-gated (returns a non-array), so the seed script sweeps `search.php` queries instead; `strArea` is the cuisine ("Italian"), `strCategory` maps to meal_type only for Breakfast/Dessert/Starter/Side/Snack/Beverage (else null — "Chicken" is not a meal type); servings don't exist → default 4; `strIngredientN`/`strMeasureN` pair 1..20 with null holes.
- **Import pipeline (Phase 3, `apps/api/src/services/import-pipeline.ts`)**: `parse-ingredient` (new dep, lockfile-pinned) parses "2 cups plain flour" into quantity + `unitOfMeasureID`; UOM ids map onto the Unit enum (tablespoon→tbsp, fluidOunce→oz, each→piece, …) and anything unmappable keeps a null unit — no enum values were added, so development.md §3 is unchanged. "to taste" text forces unit `to_taste` with null quantity. Hero images download once into DATA_DIR/images (a dead remote URL degrades to a hatch cover, never a failed import). Ingredient master rows are find-or-create keyed on `normalizeIngredientName`, category from the §6.4 lookup table (MealDB has no `aisle`, so the Spoonacular branch will seed it when that lands).
- **Imports save directly, then open in the editor for review (Phase 3 decision)** — `POST /recipes/import/public-api` persists as a SHARED recipe (userId null, visible to all accounts per §3's shared-import rule), idempotent on (sourceType public_api, sourceUrl) — re-import returns the existing row, so the seed script is re-runnable. The frontend then routes to `/recipes/:id`. This diverges from the YouTube flow's "pre-fill before save" (§5) deliberately: public-API data is structured and rule-tagged on arrival, while LLM extraction needs human review before it ever touches the DB. Recorded here because it resolves the phase-03 todo's ambiguity.
- **§6.4 lookup hardened at read time (post-Phase 6)** — manual recipes never link Ingredient master rows (`persist.writeBlocks` stores `ingredientId: null`), and pre-existing master rows can carry a stale "other", so list generation and manual item-add in `apps/api/src/routes/grocery-lists.ts` fall back to `ingredientCategory(rawText/label)` whenever the master row is missing or "other". The lookup itself gained three fixes (`packages/shared/src/tagging.ts`, tested): "to taste" is stripped as a descriptor ("salt, to taste" → "salt" → spice); egg/egg yolk/egg white categorize as dairy (aisle placement); and a last-word fallback maps unlisted compounds via their final word ("cheddar cheese" → "cheese", "baby spinach" → "spinach") — exact compound matches win first, so "tomato sauce" stays pantry. Item deletion (`DELETE /grocery-lists/:id/items/:itemId`) is backend-owned; regenerating a list re-derives items from recipe ingredients, so a deleted recipe-derived item reappears on regenerate — inherent to the generate-from-recipes model, noted in the route comment.
- **Drag-to-recategorize beats the rules (post-Phase 6)** — the lookup stays the default, but the user's drop is authoritative: `PATCH /grocery-lists/:id/items/:itemId` with `{ category }` rewrites the GroceryListItem AND the Ingredient master row (linked items update their row; free-text items upsert one keyed on `normalizeIngredientName(label)`), so the correction survives regeneration. Generate/manual-add consult a by-name master lookup (one `findMany` on the batch of normalized unlinked names) before falling to the rule table — precedence: explicit body.category > user-corrected master row > rule lookup. The master table is global (no userId on Ingredient), so with ≤5 homeserver users one person's correction fixes it for everyone — treated as a feature, not a leak. No schema change was needed.
- **`findMealDbThumb` — the sanctioned non-import MealDB call (post-Phase 10)**: Discover image resolution needed a thumbnail finder, so `mealdb.ts` gained `filter.php?i=<ingredient>` lookups (24h TTL cache, one per Discover suggestion per refresh, ≤6/user/day). It picks the meal whose name has the highest word overlap with the suggestion title and returns null on zero overlap — wrong-dish images are worse than placeholders. development.md §0's allowlist was amended in the same change (Discover image resolution is now explicitly permitted alongside user-initiated imports). The download itself reuses `saveImageFromUrl` (image-store.ts), so the browser only ever sees local `/images/...` paths.
- **Inverted index = in-memory Map, two postings maps (Phase 8, development.md §9 step 1)** — `apps/api/src/services/ingredient-index.ts` keeps `ingredient_id → Set<recipe_id>` AND a second `normalized_name → Set<recipe_id>` map built from the RecipeIngredient rows that link no master Ingredient (manual recipes, per the writeBlocks decision above) — without the name map, hand-typed recipes would be invisible to ingredient search. Chosen over a plain indexed table per §0's no-new-infrastructure bias and the phase checklist's "in-memory Map rebuilt on startup" preference; it's built lazily on first search (concurrent first callers share one rebuild) and dropped (`invalidateIngredientIndex()`) from `persist.writeBlocks` + `DELETE /recipes/:id` — every write path funnels through those. Full rebuild is one `findMany` over RecipeIngredient, trivial at this scale. Known granularity limit, accepted: matching is exact per master row, so pantry "chicken" doesn't satisfy "chicken thigh" (MealDB seeds one master row per granular name); autocomplete surfaces both, so the user can add either. The Spoonacular `findByIngredients` fallback stays unbuilt — the flag doesn't exist and §0 says don't build what it hides.
