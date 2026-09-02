# Phase 2 — Grocery List

From development.md §12, Build Phase 2. Implements: multi-select recipes → aggregation → grocery list screen (development.md §8 "Grocery List Aggregation"; design.md §3.6).

## Aggregation engine (development.md §8.2)
- [x] Pure aggregation function in `packages/shared`: group by `ingredient_id`, sum matching units *(integrations)*
- [x] Unit-family conversion before summing (volume: tsp→tbsp→cup; weight: g→kg; count) via convert-units *(integrations)*
- [x] Incompatible / `to_taste` / unquantified items → separate non-summed lines ("+ salt to taste (from 2 recipes)") *(integrations)*
- [x] Output grouped by `Ingredient.category` *(integrations)*
- [x] Unit tests: mixed units, null quantities, scaling overrides *(integrations)*

## API (development.md §11)
- [x] Prisma: GroceryList, GroceryListItem models (`aggregated_quantity`, `unit`, `category`, `is_purchased`, `source_recipe_ids`) *(backend)*
- [x] `POST /grocery-lists` — `{ recipe_ids: [...], servings_overrides: {} }` *(backend)*
- [x] `GET /grocery-lists/:id` *(backend)*
- [x] `PATCH /grocery-lists/:id/items/:itemId` — toggle purchased, edit qty *(backend)*
- [x] `POST /grocery-lists/:id/items` — manual add *(backend)*

## UI (design.md §3.6)
- [x] Recipe multi-select entry points: Search list, Meal Planner, Recipe Reader → "Generate Grocery List" *(frontend)*
- [x] Grocery List screen: bento cells per category group, checkbox per item, manual add-item field *(frontend)*
- [x] Empty state: "Select recipes to build your list." (design.md §5) *(frontend)*
- [x] Toast confirmation on generate ("added to grocery list" — sonner) *(frontend)*
