# Phase 10 — Tier 2 AI/Web-Sourced Recommendations ("Discover")

From development.md §12, Build Phase 10. Implements: Tier 2 LLM-generated recommendations, "Discover" (development.md §10 — revised: no web search on the chosen model).

## Tier 2 pipeline (development.md §10)
- [x] Job (scheduled or on-demand) sending `DietProfile` + recently cooked/saved summary to the LLM (OpenRouter, development.md §0) *(ai-pipeline)* — on-demand refresh on first `GET /recommendations/discover` after the ~24h cadence elapses (`apps/api/src/services/discover.ts`)
- [x] Structured output: `{title, summary, why_recommended}` — **no `source_url`**; short original summaries only, never reproduced copyrighted recipe text *(ai-pipeline)*
- [x] Persist results in the DB with ~24h refresh cadence (no Redis) *(backend)*
- [x] When daily LLM quota is exhausted: serve stale/empty results with `quota_exhausted: true` instead of erroring; skip the refresh job *(ai-pipeline + backend)*
- [x] `GET /recommendations/discover` *(backend)*

## UI
- [x] Distinct "Discover" section — never mixed into core dashboard results *(frontend)* — mounted below the bento grid in `apps/web/src/app/page.tsx` (`apps/web/src/components/discover-section.tsx`)
- [x] Suggestion cards with title, summary, "why recommended" — saving a suggestion goes through manual entry or the user's own import, not auto-fetch *(frontend)* — "Log manually" links to /recipes/new
- [x] Quota-exhausted state: Discover shows the daily-limit notice (design.md §5) without breaking the rest of the dashboard *(frontend)* — inline non-blocking notice + raises the shared §5 banner
