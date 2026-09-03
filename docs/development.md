# Recipe Book App — Development Document

This doc is written for an implementing agent. It assumes `design.md` (companion doc) as the source of truth for screens/components. This doc covers architecture, data model, ingestion pipelines, the tagging engine, and API surface.

---

## 0. Deployment Constraints (binding — read before choosing anything below)

This app runs as a **self-hosted homelab service** with the following hard constraints. Where any later section conflicts with this section, this section wins.

- **Target hardware:** Linux homeserver, i3 4th-gen CPU, 8 GB RAM, GT 820M GPU (not used for inference — free-tier LLM API only). Assume ≤5 concurrent users. Size everything for that: no horizontal scaling, no beefy infra choices.
- **AI/LLM:** `nvidia/nemotron-3.5-lightning:free` via **OpenRouter** (key provided by the owner). This is a **free tier with daily request limits**. Consequences:
  - Every LLM call must be budgeted — rule-based code first (see Tagging Engine §6), LLM only for cases rules can't resolve.
  - The backend must detect OpenRouter's rate/daily-limit response and surface a structured "daily AI quota used up" error; the frontend must render a friendly alert (see design.md §5) and gracefully disable AI-dependent features (YouTube extraction, Discover recommendations) until the next day, while all non-AI features keep working.
  - No streaming-heavy or polling-heavy LLM usage patterns.
- **Offline-ish by default:** the server should make **as few online requests as possible**. Only the LLM API (OpenRouter), the YouTube import path, and the optional public-recipe-API import (§4) are permitted outbound calls. Everything else (fonts, icons, map tiles, update checks, telemetry) must be self-hosted/vendored. **All dependencies must be installed/vendored up front** — no runtime downloads, no CDN references, no post-install scripts that fetch.
- **File storage:** local filesystem on the server (a data directory with recipe images) — no S3 or object storage.
- **Auth:** username-only identification (no email, no OAuth). Accounts exist to separate users' recipes/preferences on a trusted home network, not to be a security boundary against each other. Use a long-lived signed session cookie; no password reset flows needed.
- **No cache tier:** with ≤5 users, a separate Redis instance is not justified. Use in-process caching (a simple LRU/Map with TTL) for external API responses. Keep the **BullMQ-style job semantics** (async YouTube extraction, bulk tagging) but run them on an in-process queue (e.g. a plain promise queue or `p-queue`) — Postgres/SQLite can persist job state if durability is needed.
- **Database:** SQLite (via Prisma) is acceptable and probably preferred at this scale; Postgres only if a feature genuinely needs it. Single-file DB, file backups.
- **Deployment (docker + Tailscale):** two containers (`web` = Next.js standalone on 3000, `api` = Express + Prisma on 3001) via the root `docker-compose.yml`, loopback-published only; SQLite DB + images on the `cookbook-data` Docker volume. Tailscale Serve on the host (443 → web, 8443 → api) provides HTTPS with auto-renewed Let's Encrypt certs and the fixed `cookbook.<tailnet>.ts.net` URL — the only entry point, no funnel/public exposure. Full instructions: `docs/deploy.md`.

---

## 1. Suggested Stack
- **Frontend:** Next.js responsive PWA (mobile-first wireframes; per §0, web app beats React Native here — single self-hosted deployment, no app-store path).
- **Backend:** Node.js (NestJS or Express) or any REST/GraphQL framework the agent is comfortable with.
- **Database:** SQLite via Prisma (per §0 — ≤5 users, homeserver; relational data with FKs and aggregation queries for grocery lists). Postgres only if a feature genuinely demands it.
- **Queue:** No Redis. In-process job queue (e.g. `p-queue`) for async work: YouTube extraction, AI tagging, recommendation refresh. In-process LRU cache with TTL for external API responses.
- **AI/LLM:** `nvidia/nemotron-3.5-lightning:free` via OpenRouter (per §0 — free tier, daily request limits; rule-based first, LLM as fallback). Used for: (a) YouTube transcript → structured recipe extraction, (b) ingredient tagging engine's ambiguous cases. (Tier 2 "Discover" recommendations no longer use the LLM — see §10.)
- **File storage:** local data directory on the server for recipe images (no S3 per §0).
- **Auth:** username-only account creation + long-lived signed session cookie (per §0 — identification, not a security boundary).

## 2. Recommended Libraries

These are picked specifically against this app's harder features (block editor, drag-to-calendar, unit-aware grocery aggregation) rather than generic boilerplate — using them should meaningfully cut build time versus hand-rolling.

### UI foundation
- **shadcn/ui + Radix primitives** — base component kit (modals, dropdowns, tabs, sliders). Tabs map directly onto the Recipe Reader's multi-recipe tab strip; the slider onto the servings stepper. Accessible by default, styled via Tailwind so it takes the palette in `design.md` §2.2 cleanly.
- **Tailwind CSS** — pairs with shadcn; also makes the bento grid layout (§2.1) trivial via `grid-cols-*` / `col-span-*` / `row-span-*` utilities.

### Block-style editor (Recipe Reader/Editor, §7.1)
- **BlockNote** (recommended starting point) — built specifically for Notion-style block editing on top of Tiptap/ProseMirror. Ships drag handles, the `+` block inserter, slash commands, and reordering out of the box — gets most of the way to the unified read/edit spec (§3.3) with far less custom code than raw Lexical.
- **Lexical** (fallback/alternative) — more low-level; better only if a custom block type (e.g. a live-timer `Step` block) needs behavior BlockNote's plugin model can't cleanly express. Worth a short spike on the `Step` block specifically before committing to either.

### Drag & drop
- **dnd-kit** — modern, accessible, actively maintained. Use for reordering blocks in the editor and for dragging recipes from the Meal Planner's right sidebar onto calendar days (§3.5).

### Meal Planner calendar
- **FullCalendar (React wrapper)** — its external-event-dragging plugin is built for exactly this: dragging an external card (a recipe) onto a calendar cell. If the week view stays simple, a hand-rolled CSS grid + `date-fns` is a lighter alternative worth spiking first.

### Grocery list & ingredient handling
- **parse-ingredient** (or `recipe-ingredient-parser-v2`) — parses raw strings like "2 cups flour, chopped" into `{quantity, unit, ingredient}`. Useful for normalizing YouTube-extracted and public-API ingredients before they reach the Tagging Engine (§6).
- **convert-units** — handles the unit-family conversions grocery aggregation needs (tsp→tbsp→cup, g→kg) per §8.2, without hand-written conversion tables.
- **fraction.js** — formats scaled quantities as ½, ⅓, ¾ instead of decimals — directly solves the "1.333 eggs" rounding problem in §8.1.

### Forms & data
- **React Hook Form + Zod** — validation for the Quick Add modal, diet profile, and manual recipe fields; Zod schemas can double as API request validation if the backend is also TypeScript.
- **TanStack Query** — caching/refetching for recipe search, grocery lists, and meal plans; handles loading/error states that would otherwise be hand-rolled.
- **Prisma** — ORM matching the schema in §3; faster to iterate on than raw SQL. Use the SQLite connector (§0).
- **tRPC** (optional) — end-to-end type safety without hand-writing REST client code; only worth it if the same team owns frontend and backend and the API isn't exposed publicly.

### State, timers, feedback
- **Zustand** — lightweight global store; natural fit for the persistent floating Timer Tool state (§7.3) that needs to survive navigation across tabs/screens.
- **Framer Motion** — transitions for tab switching (multi-recipe reader), Quick Add modal open/close, block reordering.
- **sonner** — toast notifications for timer completion, "added to grocery list," quick-add confirmations.
- **lucide-react** — icon set (matches `design.md` §2.5).

### YouTube import (§5)
- **youtube-transcript** — pulls captions without full OAuth Data API setup, covering the transcript half of the extraction pipeline; pair with the official YouTube Data API only for description/metadata retrieval.

### Voice assistant (§14)
- **@huggingface/transformers** (transformers.js v3) — in-browser Whisper via ONNX Runtime Web (WASM, WebGPU where available); the only sanctioned STT path per §14.1. Model weights are vendored at build time, never fetched at runtime.

---

## 3. Data Model

### 2.1 Core Entities

**User**
- id, username (unique), display_name, avatar_url, created_at
- diet_profile_id (FK)

**DietProfile**
- id, user_id
- diet_types: array (vegan, vegetarian, keto, paleo, gluten_free, dairy_free, none, ...)
- allergies: array (free text, normalized against a known allergen list)
- excluded_ingredients: array
- preferred_cuisines: array

**Recipe**
- id, user_id (nullable if from public source), title, description, hero_image_url
- base_servings (int)
- total_time_minutes (derived, sum of step durations + prep buffer)
- source_type: enum(`manual`, `youtube_import`, `public_api`, `web_import`, `dataset`)
- source_url (nullable)
- cuisine, meal_type, difficulty
- diet_tags: array (auto + manual, e.g. `vegan`, `gluten_free`) — see Tagging Engine
- created_at, updated_at

**Ingredient** (master/normalized ingredient dictionary — shared across recipes)
- id, canonical_name, category (produce, dairy, meat, pantry, spice, etc.), default_unit
- nutrition_ref (optional FK/lookup key into an external nutrition source)

**RecipeIngredient** (join table — the actual line item within a recipe)
- id, recipe_id, ingredient_id (nullable if unmatched free-text ingredient)
- raw_text (as entered/extracted, e.g. "a pinch of salt")
- quantity (nullable — supports "to taste"/"a pinch" with no number)
- unit (nullable, enum: g, kg, ml, l, tsp, tbsp, cup, oz, lb, piece, pinch, to_taste, ...)
- role_tag: enum(`main`, `swap`) — see Tagging Engine §6
- swap_suggestions: array of ingredient_ids (alternatives)
- sort_order

**RecipeStep**
- id, recipe_id, step_number, instruction_text, duration_minutes (nullable — powers the in-app timer), sort_order

**Tag** (generic system for filter panel — supports the nested "Active Item / Nested Item" structure)
- id, label, parent_tag_id (nullable — null = top-level/"Default Item", non-null = nested child), tag_type (meal_type, cuisine, diet, prep_time, difficulty, ingredient_based, custom)

**RecipeTag** (many-to-many Recipe ↔ Tag)

**GroceryList**
- id, user_id, name, created_at, status (active/archived)

**GroceryListItem**
- id, grocery_list_id, ingredient_id, label (display-name snapshot for unmatched free-text items and manual adds), aggregated_quantity, unit, category, is_purchased, source_recipe_ids (array — traceability of which recipes contributed)

**MealPlan / MealPlanEntry**
- id, user_id, date, meal_slot (breakfast/lunch/dinner/snack/custom), recipe_id, servings_planned
- `scheduled_at` (nullable timestamp) — set when the entry comes from the Quick Add "in next X minutes" path rather than a fixed slot; `meal_slot` can be null in that case.
- `is_upcoming_pin` (bool) — set when added via Quick Add's "Right now / #Upcoming" option, so the Dashboard's "Upcoming Recipe" cell can query directly for this flag rather than inferring it from date/time.
- **Multiple dishes per meal:** a single (date, meal_slot) — or a single scheduled_at "occasion" — can have *multiple* `MealPlanEntry` rows (one per dish/recipe). There is no separate "Meal" grouping entity; the Recipe Reader and Dashboard query all entries sharing the same (date, meal_slot) or the same `is_upcoming_pin`/`scheduled_at` occasion and render them as tabs (see design.md §3.3.1). This keeps the schema simple while supporting multi-dish meals.

**Favorite**
- id, user_id, recipe_id, created_at, `unique(user_id, recipe_id)`
- Powers the Meal Planner's "Saved & Favorited" right sidebar (design.md §3.5). Deleting a user or recipe cascades.

**CookedEvent**
- id, user_id, recipe_id, cooked_at
- Written when a meal-planned recipe is opened in cooking mode (§10 Tier 1's "recency of similar cooked recipes" signal). Fire-and-forget — one row per reader open scoped to a meal occasion; never user-facing.

**DiscoverSuggestion**
- id, user_id, title, summary, why_recommended, image_url (nullable), recipe_id (nullable), generated_at
- "Discover" output (§10): persisted per user, replaced wholesale on each ~24h refresh. recipe_id is set when the suggestion points at a local dataset recipe — the card links to the full recipe. image_url is the recipe's local `/images/...` hero.

**CookingSession** (voice assistant — §14)
- id, user_id, recipe_id, occasion_key (nullable — matches the meal-occasion identity the Reader already uses: `?date=&slot=` / `?upcoming=1` params), started_at, ended_at (nullable), last_seen_at
- One row per (user, occasion) conversation, reused across re-opens within a reasonable window (~same day) so "Continue conversation" reloads context; a fresh row on "Start fresh" or a new occasion.

**ChatMessage** (voice assistant — §14)
- id, cooking_session_id (FK), role (`user` | `assistant`), content (text only — transcribed speech is stored as its transcript, audio is never persisted), intent (nullable: `step_control` | `ingredient_lookup` | `timer` | `llm` | `llm_fallback` | `quota_notice`), created_at
- `intent` records which router branch produced the reply — rule-based answers (`step_control`, `ingredient_lookup`, `timer`) cost zero quota; `llm` marks OpenRouter turns. `llm_fallback` marks the quota-exhausted spoken notice.

---

## 4. Ingesting Recipes from a Public API

Use **TheMealDB** (free, no key required for basic tier — good for seeding/demo data) and/or **Spoonacular** (richer: ingredient parsing, nutrition, "search by ingredients," `recipe extract from URL` endpoint — paid tiers but has a free quota) as the external source. Per §0's offline-first constraint, **default to TheMealDB** (no key, no account) and treat Spoonacular as an optional enhancement behind a config flag. Spoonacular directly supports:
- `findByIngredients` — matches the "search by ingredients I have" feature almost natively (can be used as a fallback/supplement to your own internal ranking).
- `extract` — parses a recipe from an arbitrary URL, useful for the "web import" stretch feature.
- Structured ingredient objects with `amount`, `unit`, `name`, `aisle` (grocery category) — this maps directly onto `RecipeIngredient`/`GroceryListItem.category`.

**Normalization pipeline (Public API → internal schema):**
1. Fetch recipe from provider.
2. Map fields → `Recipe` (title, image, servings, cuisine, instructions → split into `RecipeStep` rows; if the provider doesn't give per-step durations, leave `duration_minutes` null and flag for the tagging engine to estimate from instruction text, e.g. "simmer for 10 minutes" → parse `10`).
3. Map each provider ingredient → look up/create in the `Ingredient` master table (fuzzy match on `canonical_name` to avoid duplicates like "tomato" vs "tomatoes").
4. Push the assembled recipe through the **Tagging Engine** (§6) before saving, so imported recipes get `main`/`swap` role tags, diet tags, and filter `Tag` associations — don't rely on the provider's own tags as the sole source of truth.
5. Store `source_type = public_api`, `source_url` = provider recipe URL for attribution.

**Local dataset import (added 2026-09-01):** `apps/api/scripts/import-archive.ts` ingests the offline `archive/` dataset (Epicurious-derived CSV, ~13.5k recipes, local hero images) through the same pipeline shape as a one-time script: same block mapping, master linking, and rules-only Tagging Engine pass (no LLM). Rows persist as shared recipes (`source_type = "dataset"`, `userId` null, `source_url = dataset://<slug>` for idempotent re-runs); images are copied into `DATA_DIR/images` as `dataset-<slug>.jpg`. This is the source for Discover's suggestions (§10) and the reason search is paginated. The `archive/` directory is a data source, not an app dependency — it stays out of git and the Docker build context.

---

## 5. YouTube Recipe Extraction

**Flow:**
1. User pastes/drops a YouTube URL in the Create screen.
2. Backend extracts `video_id`, fetches:
   - Video **description** (via YouTube Data API `videos.list`) — creators very often paste the full written recipe here.
   - **Transcript/captions** (via `youtube-transcript`-style library, or YouTube Data API captions if available) as a fallback/supplement when the description lacks detail.
3. Concatenate description + transcript, send to the LLM (OpenRouter `nvidia/nemotron-3.5-lightning:free`, §0) with a structured-extraction prompt, e.g.:
   > "Extract a structured recipe from this YouTube video content. Return only JSON matching this schema: `{title, servings, ingredients: [{name, quantity, unit, raw_text}], steps: [{instruction, duration_minutes}]}`. If a value isn't present, use null. Infer step durations from spoken/written timing cues where possible."
4. Parse the JSON response, run it through the **Tagging Engine** (§6) to assign `main`/`swap` roles and diet tags.
5. Pre-fill the Create/Edit form for the user to review and correct before saving — never auto-save an extracted recipe silently, since transcript-based extraction will sometimes be wrong.
6. Store `source_type = youtube_import`, `source_url` = the YouTube link, and persist the raw extraction result (database or in-process cache — no Redis per §0) so re-imports/edits don't re-hit the API or the LLM unnecessarily.

**Edge cases to handle:**
- No captions available → rely on description only; if description is also too sparse, show the user an error state prompting manual entry.
- Non-English content → the LLM can still extract/translate structure; flag `language` on the recipe if useful later.
- **Daily LLM quota exhausted** (§0) → return a structured error (`llm_quota_exceeded`) instead of a generic failure; the UI shows the "daily AI requests used up" alert and offers manual entry.

---

## 6. Tagging Engine

This is the shared engine that all three ingestion paths (manual entry, public API import, YouTube import) run through before a recipe is considered "saved," so every recipe in the system ends up with a consistent set of system tags regardless of source.

**Responsibilities:**
1. **Main vs. Swap ingredient classification** — for each `RecipeIngredient`, classify `role_tag`. Approach:
   - Rule-based first pass: ingredients present in small quantities and drawn from a known "flexible" list (salt, pepper, garnish herbs, oil for frying, generic "vegetable oil") default to `swap`; proteins, primary starches, and any ingredient mentioned in the recipe title default to `main`.
   - LLM pass for ambiguous cases: send the full ingredient list + recipe title/steps to the LLM (§0), ask it to classify each as `main` or `swap` with a one-line rationale, and suggest 1–3 `swap_suggestions` per swappable ingredient (e.g., "buttermilk" → swap suggestions: milk + lemon juice, plain yogurt). The rule-based pass must be able to run **standalone** when the daily LLM quota is exhausted — the LLM pass is an enhancement, never a hard dependency.
2. **Diet tag inference** — derive `diet_tags` (vegan, vegetarian, gluten_free, dairy_free, nut_free, etc.) by checking the full ingredient list against known allergen/animal-product dictionaries; flag anything ambiguous for LLM adjudication (e.g., "Worcestershire sauce" often contains anchovies — not vegan/vegetarian by default).
3. **System `Tag` association** — auto-populate `RecipeTag` rows for meal_type, cuisine, prep_time bucket (derived from summed step durations), and difficulty (heuristic on step count + total time), so every recipe is filterable in the Search screen's tag panel without manual tagging by the user.
4. **Grocery category tagging** — assign each `Ingredient` a `category` (Produce, Dairy, Meat, Pantry, Spice, Frozen, Bakery) so the Grocery List screen can group items; seed this from the public API's `aisle` field where available, else classify via a lookup table + LLM fallback for unknowns. The rule-based assignment is a default, not a verdict: dragging an item to another category on the Grocery List screen rewrites `Ingredient.category` (matched by canonical name for free-text items), and a user correction always outranks the lookup table on subsequent list generation.
5. **Idempotency** — engine should be safely re-runnable (e.g., user edits an ingredient list → re-tag only the changed rows, not the whole recipe) to avoid unnecessary LLM calls.

**Implementation note:** implement this as an internal service (`TaggingService`) called synchronously for small edits and via the job queue for bulk/import operations, so imports don't block the UI.

---

## 7. Recipe Reader/Editor, Quick Add, Timer & Shake Gesture

### 6.1 Unified Read/Edit Surface
Per `design.md` §3.3, read and edit modes render the same block components (`Title`, `Cover Image`, `Meta`, `Ingredient`, `Step`, `Note`). Implementation approach:
- Model the recipe client-side as an ordered array of typed block objects (mirrors `RecipeIngredient`/`RecipeStep` server rows, plus lightweight `Note` blocks — add a `RecipeNote` table or a generic `RecipeBlock` table with a `block_type` discriminator if flexibility to add block types later matters more than strict typing).
- A single component per block type renders in two visual states (`readonly` / `editable` props) rather than maintaining two separate component trees — this is what guarantees the "looks the same in both modes" requirement; avoid building a distinct form UI that merely resembles the reader.
- Edit actions (reorder via drag-handle, insert via `+`, delete) mutate the client-side block array; persist via a single `PUT /recipes/:id/blocks` batch update on save/blur, rather than one request per keystroke.

### 6.2 Quick Add to Meal (Modal)
- `POST /meal-plans/quick-add` — body: `{ recipe_id, mode: "now" | "slot" | "custom_minutes", slot?: "breakfast"|"lunch"|"dinner", minutes?: number, date? }`.
  - `mode: "now"` → creates a `MealPlanEntry` with `is_upcoming_pin = true`, `date = today`.
  - `mode: "slot"` → resolves the next occurrence of that slot (today if not yet passed, else tomorrow) and creates a standard slotted entry — expose this resolution as a pure function so the frontend can preview "adds to: Today's Dinner" before confirming.
  - `mode: "custom_minutes"` → sets `scheduled_at = now + minutes`, `meal_slot = null`.
- Triggerable from both the Recipe Reader and a Search result cell — same modal component, parameterized by `recipe_id` (and by the currently-active tab's recipe if triggered from a multi-recipe reader).

### 6.3 Timer Tool
- Client-side timer state should be lifted to a global store (not per-component), since the design calls for a persistent floating control that survives navigation across tabs/screens.
- Support multiple concurrent timer instances keyed by `(recipe_id, step_id)`; each instance: `duration_seconds`, `remaining_seconds`, `status` (running/paused/done), `started_at`.
- Use a single `requestAnimationFrame`/`setInterval` ticking the store rather than one interval per timer instance, to avoid drift/perf issues with several timers active.
- Completion should trigger both a UI state change and a device alert (Web: `Notification`/vibration API where available; React Native: local notification + `Vibration.vibrate()`).

### 6.4 Shake-to-Advance
- Web: `DeviceMotionEvent` (`devicemotion` listener), computing acceleration magnitude delta and thresholding against a single sharp spike to avoid false positives from ambient movement; note iOS Safari requires an explicit permission prompt (`DeviceMotionEvent.requestPermission()`) triggered by a user gesture.
- React Native: `expo-sensors` `Accelerometer` (or `react-native-sensors`), same spike-detection approach.
- Scope activation to when the Recipe Reader is in the foreground and in read (cooking) mode — disable the listener when the tab is backgrounded, in edit mode, or when the user has toggled shake-to-advance off, to save battery and avoid accidental triggers.
- On trigger: advance the active tab's current step index, scroll it into view, and auto-start its timer if it has a `duration_minutes`.

---

## 8. Serving Scaling & Grocery List Aggregation

### 6.1 Serving Scaling
- `scaled_quantity = raw_quantity * (target_servings / base_servings)`
- Apply unit-aware rounding: round to the nearest sensible fraction (¼, ⅓, ½) for cups/tsp/tbsp; round to nearest whole unit for "piece" items (e.g., eggs, onions) — never show fractional whole items; flag anything that rounds awkwardly (e.g., "2.5 eggs") with a UI note ("~2–3 eggs").
- Ingredients with `quantity = null` (e.g., "salt to taste") don't scale — always display as-is.

### 6.2 Grocery List Aggregation
1. Take the set of selected `Recipe` (and their target servings, if scaled).
2. For each `RecipeIngredient`, resolve to its scaled quantity + unit.
3. Group by `ingredient_id`; where units match, sum directly; where units differ but are convertible (e.g., tsp → tbsp → cup, g → kg), convert to a common unit before summing (maintain a unit-conversion table per unit family: volume, weight, count).
4. Where units are incompatible or the ingredient is `to_taste`/unquantified, list as a separate non-summed line ("+ salt to taste (from 2 recipes)").
5. Output grouped by `Ingredient.category` for the Grocery List screen.
6. Persist as `GroceryList` + `GroceryListItem` rows with `source_recipe_ids` for traceability, and allow manual add/edit/checkoff after generation.

---

## 9. Ingredient-Based Search ("What can I make with what I have")

1. Maintain an inverted index: `ingredient_id → [recipe_ids]` (a plain indexed table maintained on write, or an in-memory Map rebuilt on startup — at ≤5 users, a dedicated search engine like Elasticsearch/Meilisearch is not justified; SQLite handles this trivially).
2. User inputs their available ingredients (autocomplete against the `Ingredient` master table).
3. Score each candidate recipe: `match_score = (matched_main_ingredients / total_main_ingredients)`, with `swap`-tagged ingredients excluded from the denominator (or weighted at a fraction, e.g. 0.3) since the user can substitute those.
4. Rank results by `match_score` desc; surface "missing ingredients" per result so the user can see what they'd still need to buy (this doubles as a natural upsell into the grocery list feature — "Buy 2 missing items to make this").
5. Optionally fall back to Spoonacular's `findByIngredients` for recipes outside the user's own saved library (only if the Spoonacular flag is enabled, per §4/§0).

---

## 10. Recommendation Engine (Diet-Based + AI Web Recommendations)

Two-tier approach:

**Tier 1 — Internal recommendations (deterministic, fast, no LLM cost):**
- Filter the recipe library by the user's `DietProfile` (diet_types, allergies, excluded_ingredients, preferred_cuisines).
- Rank by: recency of similar recipes cooked, ingredient overlap with pantry (if provided), and preferred cuisine match.
- This powers "Upcoming Recipe" on the Dashboard.

**Tier 2 — "Discover" from the local dataset (revised 2026-09-01):**
- The LLM generation pass is retired. Discover now selects recipes from the locally imported dataset (the `archive/` CSV import, `source_type = "dataset"`, `userId` null — see §4's dataset pipeline). Zero network, zero LLM quota; works fully offline.
- ~24h refresh cadence, wholesale replacement per user, persisted as `DiscoverSuggestion` rows (unchanged). Selection: hard-filter by the user's `DietProfile` (allergies/excluded ingredients via ingredient text), soft-score by cuisine preference + diet-tag match, then a deterministic daily rotation (seeded shuffle keyed on day + user) so the same day shows the same picks but every day differs. Recently cooked/saved recipes are excluded.
- Each suggestion row carries `recipe_id` — the card links straight to the full recipe in the reader. `why_recommended` is rule-derived copy (cuisine match / diet fit / "ready in under 45 minutes" fallback).
- `GET /recipes` (and the search screen) are paginated (24/page) since the dataset made the library ~13.5k recipes; the response envelope is `{items, total, page, page_size, has_more}`.

---

## 11. API Surface (REST, representative — agent may adjust to GraphQL if preferred)

```
POST   /auth/signup | /auth/login        # username-only (§0); returns signed session cookie
GET    /users/me
PUT    /users/me/diet-profile

POST   /recipes                     # manual create
GET    /recipes/:id
PUT    /recipes/:id
DELETE /recipes/:id
GET    /recipes?tags=&q=&ingredients=

POST   /recipes/import/youtube      # { url }
POST   /recipes/import/url          # { url } (web import)
POST   /recipes/import/public-api   # { provider_recipe_id }

GET    /recipes/:id/scale?servings=6   # returns scaled ingredient list

GET    /tags                        # nested filter tag tree
POST   /tags                        # custom user tag

POST   /grocery-lists               # { recipe_ids: [...], servings_overrides: {}, mode: "replace" | "append" }  # append merges into the active list
GET    /grocery-lists/:id
PATCH  /grocery-lists/:id/items/:itemId   # toggle purchased, edit qty, recategorize ({ category }) — persists to the Ingredient master row so it survives regeneration
POST   /grocery-lists/:id/items     # manual add
DELETE /grocery-lists/:id/items/:itemId   # remove an item (reappears if the list is regenerated)

GET    /meal-plans?week=            # for the 3-panel Meal Planner calendar body
GET    /meal-plans?date=            # for the "Recipes for Selected Day" left sidebar
POST   /meal-plans                  # assign recipe to date/slot (drag-and-drop target)
POST   /meal-plans/quick-add        # { recipe_id, mode: now|slot|custom_minutes, slot?, minutes?, date? }
GET    /meal-plans/upcoming         # resolves the Dashboard's "Upcoming Recipe" occurrence (may return >1 recipe)
GET    /meal-plans/for-slot?date=&slot=   # all recipes for a given meal occurrence, for Recipe Reader tabs
PATCH  /meal-plans/:id             # { date?, meal_slot?, servings_planned? } — reassign (planner drag-and-drop) / adjust servings
DELETE /meal-plans/:id             # remove a planned dish

GET    /recipes/favorites           # for the Meal Planner right sidebar "Saved & Favorited" list
POST   /recipes/:id/favorite
DELETE /recipes/:id/favorite

GET    /recommendations/internal
GET    /recommendations/discover    # "Discover" tier from the local dataset (§10)
POST   /recipes/:id/cooked          # cooking-mode open signal → CookedEvent (§10)

POST   /chat/sessions               # { recipe_id, occasion_key? } — resume today's session for the occasion or create a new CookingSession (§14)
GET    /chat/sessions/:id           # message history (session resume, §14)
POST   /chat/sessions/:id/messages  # { content, context: { current_step_id, active_timers[] } } — LLM turn → persisted reply (§14); 429 llm_quota_exceeded at quota
POST   /chat/sessions/:id/log       # { role, content, intent } — fire-and-forget persistence of client-resolved router turns + proactive notices (§14); never calls the LLM
```

Error convention for AI-dependent endpoints (YouTube import, Discover, chat LLM turns): when the OpenRouter daily quota is hit, respond `429 { "error": "llm_quota_exceeded" }` (or include a `quota_exhausted: true` flag for stale-OK reads like Discover) so the frontend can show the §0 alert. For the chat route specifically, the 429 must arrive *after* the user's message is persisted — the conversation log survives quota exhaustion, and the client speaks the §5 fallback notice and continues rule-based (§14).

---

## 12. Build Phases (suggested)

1. **Phase 1 — Core CRUD + Unified Reader/Editor:** Auth, Recipe/Ingredient/Step models, the block-based read/edit surface (§7.1), servings scaling.
2. **Phase 2 — Grocery List:** Multi-select recipes → aggregation → grocery list screen.
3. **Phase 3 — Public API import + Tagging Engine v1** (rule-based tagging, category assignment).
4. **Phase 4 — YouTube import pipeline** (description/transcript → LLM extraction → review in the same block editor).
5. **Phase 5 — Meal Planning core:** MealPlanEntry model, Quick Add modal + endpoint, Dashboard "Upcoming"/"Meals planned for the day" wiring, multi-recipe tabs in the Reader.
6. **Phase 6 — Meal Planner page:** 3-panel layout (calendar body, day sidebar, saved/search sidebar), drag-and-drop assignment.
7. **Phase 7 — Cooking-mode features:** Timer tool (global store, floating control), shake-to-advance gesture.
8. **Phase 8 — Ingredient-based search + filter tag panel** (nested tag tree UI from `design.md` §2.4).
9. **Phase 9 — Diet profile + Tier 1 recommendations.**
10. **Phase 10 — Tier 2 AI-generated recommendations ("Discover").**
11. **Phase 11 — Voice cooking assistant (§14):** chat session persistence + LLM chat route → collapsible chat panel (text-only) → TTS + proactive timer speech → intent router → local STT (speech input layered last onto a working chat surface).

---

## 13. Open Questions for the Agent to Resolve During Build
- Whether Spoonacular is enabled at all, or TheMealDB-only (per §0's offline-first constraint — default TheMealDB-only unless the owner provides a key).
- Whether nutrition data (calories/macros) is in scope now or a later phase — the `Ingredient.nutrition_ref` field is included so it can be added without a schema change later.
- Exact OpenRouter quota-error shape (`nvidia/nemotron-3.5-lightning:free` daily limits) — confirm the response body OpenRouter returns at limit and normalize it to the `llm_quota_exceeded` convention in §11.

### Resolved (previously open, now decided by §0)
- ~~Public recipe API choice~~ → TheMealDB default, Spoonacular behind a flag.
- ~~Native mobile vs web~~ → responsive Next.js PWA, self-hosted.
- ~~Claude API~~ → OpenRouter `nvidia/nemotron-3.5-lightning:free` with daily-limit handling.
- ~~Voice assistant STT/TTS provider~~ (owner decision, 2026-09-02) → **fully local**: transformers.js (WASM/WebGPU) with build-time-vendored whisper models for STT, browser SpeechSynthesis for TTS. Latency traded away for §0 compliance. No §0 amendment needed — zero new outbound calls.
- ~~Voice chat transport~~ → plain request/response, no SSE/token streaming (§0's "no streaming-heavy LLM usage patterns").

---

## 14. Voice Cooking Assistant (Cooking Session Chat)

UX spec: design.md §3.3.4 (panel states, push-to-talk, spoken behavior, session resume) and design.md §5 (voice behavior at quota exhaustion). Conversation with the assistant during a cooking session: speech-first push-to-talk, text always available, replies rendered in the transcript and spoken via on-device TTS. **All speech processing is local** (owner decision — latency-tolerant, §0-clean).

### 14.1 Speech I/O — on-device, zero outbound audio

- **STT:** `@huggingface/transformers` (transformers.js v3) in a dedicated Web Worker. Model: whisper `tiny.en`, q8-quantized (~40 MB) default; `base.en` q8 is the documented quality upgrade if transcription on target devices demands it. Backend: WASM; WebGPU where the browser exposes it. **Never the Web Speech API** — Chrome's implementation streams audio to Google's servers, which is outside §0's outbound allowlist.
- **Vendoring:** all model + runtime artifacts (ONNX weights, onnxruntime-web `.wasm` binaries) are vendored at build time under `apps/web/public/models/` and served from the app's own origin; transformers.js must be configured with local model paths and remote fetching disabled (its default is the HuggingFace hub — that would be a runtime download, §0 violation). Zero new outbound calls; §0 unchanged.
- **Latency expectation:** single-digit seconds per short push-to-talk clip on mid-range phones (verify on real devices during Phase 11 — benchmark figures for WASM whisper are anecdotal, and cross-origin-isolation requirements affect them; adjust model size from the measurement, not from published numbers).
- **COOP/COEP caveat:** multithreaded WASM (SharedArrayBuffer) needs cross-origin isolation, but `Cross-Origin-Embedder-Policy: require-corp` breaks the API-origin `<img>` loads (recipe covers) unless the API sends `Cross-Origin-Resource-Policy` headers. Prefer `credentialless` COEP or verify a workaround before enabling threads; single-threaded WASM is the acceptable fallback.
- **TTS:** browser SpeechSynthesis — local, free, and available even at LLM quota exhaustion. Voice/rate selection is frontend concern; pick a sensible default, settings later.

### 14.2 Intent router — rule-based first (quota discipline)

- `routeCookingIntent(text, context)` — a **pure function in `packages/shared`**, unit-tested, run **client-side before anything is sent**. Recipe-bound intents resolve locally with zero server round-trips and zero quota:
  - **Step control** ("next", "repeat that", "go back", "what's step 4") → actions executed against the Reader + the Zustand timer store (§7's timer state is client-side; there is no server timer to command) — same semantics as shake-to-advance: scroll into focus, auto-start timers.
  - **Ingredient lookup** ("how much flour?") → shared scaling helpers (§8.1) over the recipe's blocks at the current servings.
  - **Timer control** ("set a timer for 5 minutes", "how long left?") → Zustand timer store actions; status reads live client state.
  - These turns persist via fire-and-forget `POST /chat/sessions/:id/log` (user message + rule-based reply, intent recorded).
- **Everything else** — substitutions, technique, general cooking questions (in scope, owner decision) — is an LLM turn: `POST /chat/sessions/:id/messages`.
- The router must fail soft: an unrecognized query falls through to the LLM rather than dead-ending. It saves quota and latency; it does not gatekeep.

### 14.3 LLM turns

- Plain chat completion through the existing OpenRouter client (`services/openrouter.ts`) — **no SSE/token streaming** (§0). The panel's "thinking" state covers the free-tier wait.
- Short replies by design: `maxTokens` ≈ 200 and the system prompt instructs ≤ 2 sentences, kitchen-terse. `reasoning: { effort: "none", exclude: true }` stays on (the model dumps chain-of-thought into `content` otherwise — see ai-pipeline agent decisions).
- **Context budget** (ai-pipeline owns prompt assembly): recipe title + current servings, current step ± neighbors (from client-sent `context.current_step_id`), the full ingredient list at current scale, an active-timer summary, and the last ~8 persisted session turns. Not the whole recipe. The system prompt fixes the persona: terse, kitchen-appropriate, this-recipe-first.
- **Quota:** 429 `llm_quota_exceeded` per §11's convention, *after* persisting the user's message. The client speaks the design.md §5 fallback notice and the session continues rule-based; the failed turn logs with intent `llm_fallback`.

### 14.4 Session persistence

- `CookingSession` / `ChatMessage` (§3). One session per (user, occasion) within a same-day-ish window; reopening offers "Continue conversation" / "Start fresh" (design.md §3.3.4). Resumed sessions reload recent turns as LLM context — no re-sending of history the server already has.
- Proactive notices (spoken timer completions) log as `ChatMessage` rows (`role: assistant`, intent `timer`) so the transcript matches what was said aloud.
- **Audio is never persisted** — transcript text only.

### 14.5 Build order (Phase 11)

Chat route + persistence → text-only panel → TTS + proactive timer speech → intent router → STT. Voice is an input modality layered onto a working chat feature — each stage lands on a usable surface.
