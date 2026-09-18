# Mobile Agent

## What you own

Everything in `apps/mobile/` — the React Native + Expo Android app. Offline-first companion to the web app: same API, same auth, local SQLite mirror, sync engine, and mobile-native renderings of the web screens (tabs, stacks, bottom sheets, swipe actions, background-proof timers).

The mobile app's own living changelog is **`apps/mobile/CHANGELOG.md`** — every change to the mobile app gets an entry there (what changed + what it does). This is part of your Definition of Done, alongside the phase checklists in `docs/todos/mobile-phases.md`.

## Read list

- `docs/todos/mobile-phases.md` — **the build plan and the web → mobile file map**: which web file to port for which screen, at which phase. Start here for any screen work.
- `docs/development.md` — §0 (binding constraints), §3 (data model — mirror field names in the SQLite schema), §7 (timer/shake designs — port to expo-notifications/expo-sensors), §11 (API surface — same endpoints, no forking), §8–§10 (scaling/search/recommendations — shared pure functions do the work).
- `docs/design.md` — screens and states. Mobile mirrors the web screens (Dashboard, Search, Reader/Editor, Planner, Grocery, Profile) with mobile-native navigation and gestures, keeping the Heirloom Kitchen token palette (`src/lib/theme.ts`).
- `apps/web/src/lib/api.ts` — the reference API client; the mobile surface mirrors it (`src/lib/api-surface.ts`).

> The mobile requirements doc `App Plan.txt` (formerly in the repo parent) is **gone** — its three binding rules (offline/hybrid feature split, try-and-catch connectivity with live recovery, eviction-with-prompt) are recorded in `docs/todos/mobile-phases.md` and referenced by `src/sync/engine.ts`, `src/lib/connectivity.ts`, `src/stores/network.ts`, `src/db/schema.ts`. Restore the file if it turns up, otherwise treat the phase doc as the record.

## Architecture (binding)

- **Local-first:** screens read/write the local SQLite DB (`expo-sqlite`) via the repository layer; the sync engine pushes a mutation queue and pulls changes when the server is reachable. Server is never read directly by screens.
- **Same API, additive only:** consume existing endpoints (development.md §11). Sync-specific additions (`?since=`, `page_size`, tombstones) are owned by the backend agent; request them there.
- **Shared logic:** types/schemas/math come from `@cookbook/shared` (workspace dep). Never re-declare a shape locally — add it to shared.
- **Connectivity:** try-and-catch, always live (`src/lib/connectivity.ts`) — NetInfo listener + reachability probe (`GET /users/me`) + failed-call reporting + 15s offline re-probe loop. Online features re-enable the moment the server is reachable; never require an app restart.
- **Eviction is user-confirmed, local-only:** unused-for-30–60-days downloads are flagged; the user chooses keep (resets the timer) or delete-from-phone (content + images go, the stub stays in the list). The server is never touched.
- **Voice assistant is v2** — do not port the web's STT/TTS stack.

## Explicitly NOT your job

- `apps/api/` route handlers (backend agent) — including the sync additions you depend on.
- Tagging/import/recommendation logic (ai-pipeline / integrations agents) — you consume their endpoints.
- Schema definitions — `packages/shared`.

## Decisions

- **2026-09-15:** Expo SDK 57 (current stable), expo-router for file-based navigation, no `.npmrc` hoisting needed (SDK 57 Metro resolves pnpm symlinks; `expo-doctor` 21/21 clean). Deliverable is a direct-install `.apk` via EAS `preview` profile — no app store.
- **2026-09-15:** Session auth replays the API's signed cookie as a `Cookie` header from `expo-secure-store` (RN fetch has no cookie jar). Server URL is user-configurable (default: the Tailscale Serve URL) so one build serves dev + prod.
- **2026-09-15:** `RecipeSearchPage` and `ScaledRecipe` moved from web-local interfaces into `@cookbook/shared` (repo rule: shapes defined once).
