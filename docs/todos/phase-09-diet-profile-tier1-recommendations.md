# Phase 9 — Diet Profile + Tier 1 Recommendations

From development.md §12, Build Phase 9. Implements: DietProfile model + preferences screen and the deterministic internal recommendation engine (development.md §10 Tier 1; design.md §3.7).

## Diet profile (development.md §3, DietProfile; design.md §3.7)
- [x] DietProfile Prisma model: `diet_types`, `allergies` (normalized against known allergen list), `excluded_ingredients`, `preferred_cuisines` *(backend)*
- [x] `PUT /users/me/diet-profile` *(backend)*
- [x] Diet Preferences screen: diet types, allergies/exclusions, disliked ingredients, preferred cuisines (React Hook Form + shared Zod schema) *(frontend)*

## Tier 1 internal recommendations (development.md §10)
- [x] Deterministic ranking module: filter library by `DietProfile`, rank by recency of similar cooked recipes, pantry ingredient overlap, preferred cuisine match — zero LLM calls *(ai-pipeline)*
- [x] `GET /recommendations/internal` *(backend)*
- [x] Powers the Dashboard's "Upcoming Recipe" cell as fallback when nothing is pinned/planned *(backend + frontend)*
- [x] Cooked-recipe history signal: track when a meal-planned recipe is actually opened in cooking mode *(backend + frontend)*
