# Phase 3 — Public API Import + Tagging Engine v1

From development.md §12, Build Phase 3. Implements: rule-based tagging and category assignment (development.md §6) plus the public API import pipeline (development.md §4). Tagging Engine v1 = rules only; the LLM pass for ambiguous cases can land here or in Phase 4.

## Provider decision (development.md §0, §4, §13)
- [x] Provider config: TheMealDB default (free, no key), Spoonacular behind a config flag that hides its features when off — record in `docs/agents/integrations.md` "Decisions" *(integrations)*
- [x] API client + in-process LRU/Map response cache with TTL (no Redis — development.md §0) *(integrations + backend)*

## LLM provider integration (development.md §0, §11)
- [x] OpenRouter client module (`nvidia/nemotron-3.5-lightning:free`, key from server env/config) *(ai-pipeline)*
- [x] Normalize OpenRouter daily-limit errors → `llm_quota_exceeded` (429) per §11's error convention *(ai-pipeline + backend)*
- [x] "Daily AI requests used up" alert banner + AI-entry-point disabling in the UI (design.md §5) *(frontend)*

## Import pipeline (development.md §4)
- [x] Step 1–2: fetch provider recipe → map to `Recipe` + split instructions into `RecipeStep` rows (null durations when provider doesn't supply) *(integrations)*
- [x] Step 3: provider ingredients → `Ingredient` master lookup/create with fuzzy `canonical_name` matching ("tomato" ≠ duplicate of "tomatoes") *(integrations)*
- [x] Step 4: handoff to Tagging Engine before save — provider tags never sole truth *(integrations → ai-pipeline)*
- [x] Step 5: set `source_type = public_api`, `source_url` *(integrations)*
- [x] `POST /recipes/import/public-api` — `{ provider_recipe_id }` *(backend)*
- [x] Ingredient parsing via `parse-ingredient` for unstructured provider strings *(integrations)*
- [x] Seed demo library from TheMealDB free tier *(integrations)*

## Tagging Engine v1 (development.md §6)
- [x] `TaggingService` module, callable synchronously (small edits) and via the in-process queue (bulk/import) *(ai-pipeline)*
- [x] Rule-based main/swap classification: small-quantity + flexible list → `swap`; proteins, primary starches, title-mentioned → `main` — must run standalone with the LLM disabled *(ai-pipeline)*
- [x] Diet tag inference against allergen/animal-product dictionaries *(ai-pipeline)*
- [x] System Tag association: meal_type, cuisine, prep_time bucket (summed step durations), difficulty heuristic (step count + total time) → `RecipeTag` rows *(ai-pipeline)*
- [x] Grocery category tagging: seed `Ingredient.category` from provider `aisle`, else lookup table *(ai-pipeline + integrations)*
- [x] Duration estimation from instruction text ("simmer for 10 minutes" → 10) for imported steps *(ai-pipeline)*
- [x] Idempotency: re-tag only changed rows *(ai-pipeline)*
- [x] Tag + RecipeTag Prisma models; `GET /tags` returns nested tree; `POST /tags` custom user tag *(backend)*

## UI
- [x] Import entry affordance in recipe-create flow ("Import from URL" placeholder until web import lands) *(frontend)*
- [x] Imported recipe opens in unified block editor for review before save *(frontend)*
