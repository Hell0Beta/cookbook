# Phase 4 — YouTube Import Pipeline

From development.md §12, Build Phase 4. Implements: description/transcript → LLM extraction → review in the same block editor (development.md §5; design.md §4.5).

## Extraction pipeline (development.md §5)
- [x] `video_id` extraction from pasted/dropped URL *(ai-pipeline)*
- [x] Description fetch via YouTube Data API `videos.list` *(ai-pipeline — implemented keyless via watch-page scrape, see ai-pipeline.md Decisions)*
- [x] Transcript fetch via `youtube-transcript`-style library as fallback/supplement *(ai-pipeline)*
- [x] LLM structured extraction (OpenRouter, development.md §0): concatenated description + transcript → strict JSON `{title, servings, ingredients: [{name, quantity, unit, raw_text}], steps: [{instruction, duration_minutes}]}`, nulls for missing, durations from timing cues *(ai-pipeline)*
- [x] Defensive JSON parsing/validation of model output (repair or reject, never silently trust) *(ai-pipeline)*
- [x] Parse JSON → run through Tagging Engine for `role_tag`, diet tags *(ai-pipeline)*
- [x] `youtube-transcript` dependency + provider credentials/config *(ai-pipeline + backend)*
- [x] Ingredient strings normalized through integrations' parser before tagging *(integrations — LLM returns structured qty/unit already; normalizeIngredientName runs inside classifyRoleTag)*

## Edge cases (development.md §5)
- [x] No captions → description only; both sparse → error state prompting manual entry *(ai-pipeline + frontend)*
- [x] Non-English content → extract/translate, flag `language` *(ai-pipeline)*
- [x] Daily LLM quota exhausted → `llm_quota_exceeded` error → "daily AI requests used up" alert + manual-entry fallback (development.md §0, §5) *(ai-pipeline + backend + frontend)*

## API & infra (development.md §5 step 6, §11)
- [x] `POST /recipes/import/youtube` — `{ url }`; async job via the in-process queue *(backend — synchronous, consistent with the Phase 3 sync-not-queue decision; see backend.md Decisions)*
- [x] Store `source_type = youtube_import`, `source_url` = YouTube link *(backend)*
- [x] Persist raw extraction result in the database so re-imports/edits don't re-hit APIs or the LLM *(backend — in-process 24h cache, permitted by development.md §5 step 6; see backend.md Decisions)*

## UI (design.md §4.5)
- [x] "Paste YouTube link" entry as special first block/action in recipe creation *(frontend)*
- [x] Loading state during extraction *(frontend)*
- [x] Auto-populated block stack opens in the unified editor — never auto-saved silently; user reviews/edits before save *(frontend)*
- [x] Source badge "YouTube" in Meta block *(frontend)*
