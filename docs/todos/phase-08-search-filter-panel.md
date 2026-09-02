# Phase 8 — Ingredient-Based Search + Filter Tag Panel

From development.md §12, Build Phase 8. Implements: nested tag tree UI (design.md §2.4 #4, §4.6) and "what can I make with what I have" search (development.md §9; design.md §4.7).

## Search infrastructure (development.md §9)
- [x] Inverted index `ingredient_id → [recipe_ids]` — plain indexed table or in-memory Map rebuilt on startup (development.md §9) *(integrations + backend)*
- [x] Ingredient autocomplete endpoint against the `Ingredient` master table *(backend + integrations)*
- [x] Match scoring: `matched_main / total_main`, `swap`-tagged excluded from denominator or weighted ~0.3 *(ai-pipeline defines formula; backend implements in query)*
- [x] `GET /recipes?tags=&q=&ingredients=` — combined filter query *(backend)*
- [x] Missing-ingredients surfaced per result ("Buy 2 missing items to make this") *(backend + frontend)*
- [ ] Optional Spoonacular `findByIngredients` fallback for recipes outside the user's library *(integrations)* — **skipped deliberately**: the `config.spoonacular.enabled` flag doesn't exist yet and §0 says don't build what the flag hides; internal ranking fully covers the feature.

## Filter tag panel (design.md §2.4 #4, §4.6)
- [x] Expandable Tag Filter component: flat or one-level-nested groups ("Active Item ⌄" → indented "Nested Item" rows, flat "Default Item" rows) *(frontend)*
- [x] Slide-out panel from the chip row `+` button; "Select Filter Tags" title *(frontend)*
- [x] Horizontally scrollable active chip row; chips update on panel close; result list re-queries *(frontend)*
- [x] Search screen assembled: app bar + search input + chip row + Recipe List Item results (design.md §3.2) *(frontend)*
- [x] Quick-add-to-meal affordance on every result cell (design.md §2.4 #6) *(frontend)*

## Ingredient search UX (design.md §4.7)
- [x] "Ingredients I have" input mode with autocomplete *(frontend)*
- [x] Results ranked by match score, with per-result missing-ingredient display *(frontend)*
- [x] Grocery-list upsell path from missing ingredients *(frontend)*
