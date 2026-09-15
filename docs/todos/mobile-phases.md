# Mobile App — Build Phases (M0–M11)

Source plan: mobile agent's approved build plan (2026-09-15). Check items off as completed; log every change in `apps/mobile/CHANGELOG.md`.

## M0 — Scaffold
- [x] `apps/mobile` workspace: Expo SDK 57 + expo-router, TS strict, wired into pnpm workspace
- [x] Metro monorepo config (workspace watch folders, symlink resolution)
- [x] `expo-doctor` clean; `pnpm typecheck` passes for all workspaces
- [x] Tab shell (Home, Search, Planner, Grocery, Profile) with placeholders; boots in Expo Go
- [x] `eas.json` with `preview` (apk) profile
- [x] `CHANGELOG.md` created; `docs/agents/mobile.md` + CLAUDE.md layout row

## M1 — API client + auth + connectivity
- [x] Transport (`api-transport.ts`): Cookie-header session, timeouts, `{error, message?}` normalization
- [x] Session token capture from set-cookie → SecureStore (`session.ts`)
- [x] Server URL setting (default ts.net, editable) (`config.ts`)
- [x] Typed endpoint surface mirroring web client (`api-surface.ts`)
- [x] Login/signup screen with server-URL field
- [x] Connectivity: NetInfo + reachability probe + failed-call reporting + offline re-probe loop (`connectivity.ts`, `stores/network.ts`)
- [ ] OfflineBanner component in root layout (status text lives on Home for now — finalize with M4's design pass)

## M2 — Backend sync additions (backend agent owns; mobile requests)
- [x] `GET /recipes` summarySelect gains `updated_at` + `user_id`
- [x] `GET /recipes?since=&page_size=` (page_size up to 200)
- [x] `RecipeTombstone` model + `GET /recipes/deleted?since=`
- [x] docs/development.md §11 + backend.md updates in the same change
- [x] Verified live: list params, since-filtering, delete→tombstone flow (2026-09-15)

## M3 — Local DB + sync engine
- [ ] SQLite schema (stubs/content/images/meal-plan/grocery/favorites/mutation_queue/sync_meta)
- [ ] Repository layer; screens read/write local-first
- [ ] Sync engine: incremental pull, mutation-queue push, LWW conflicts, single-flight
- [ ] Triggers: app start, NetInfo reconnect, foreground, pull-to-refresh
- [ ] First-run full stub pull with progress UI (page_size=200)

## M4 — Recipe library + reader
- [ ] Bento-styled recipe list (cards, pull-to-refresh, swipe actions)
- [ ] Reader with block components (Title/Meta/Ingredient/Step/Note)
- [ ] Content caching + hero image downloads (expo-file-system)
- [ ] Stub/rehydrate flow ("needs internet" state offline)
- [ ] Deep links (`cookbook://recipe/:id`)

## M5 — Cooking mode
- [ ] Read-mode blocks + servings stepper (shared scaling helpers)
- [ ] Timers: timestamp-based store + expo-notifications scheduled triggers + vibration; Android 13+ permission at first timer start
- [ ] Shake-to-advance (expo-sensors, spike detection, cooking-mode-scoped)
- [ ] CookedEvent queued on reader open

## M6 — Create/edit
- [ ] Editable block states (reorder, insert, delete) — one component per block type
- [ ] Offline manual create/edit queued; `PUT /recipes/:id/blocks` batching
- [ ] Cover upload (online-only, gated)

## M7 — Meal planner + quick add + grocery
- [ ] Planner screen with quick-add bottom sheet (shared slot resolution)
- [ ] Grocery list: view/check-off/recategorize offline, aggregation via shared code

## M8 — Search hybrid + filters + favorites + Discover + diet profile
- [ ] Server search online (tag tree filters, ingredient matching)
- [ ] Local fallback search offline (stubs + cached ingredients)
- [ ] Favorites list, Discover (online-only), diet profile settings

## M9 — Imports (online-only)
- [ ] YouTube import (review-before-save), public API import
- [ ] `llm_quota_exceeded` alert UX (design.md §5)

## M10 — Eviction system
- [ ] 30–60-day unused detection (default 45, configurable)
- [ ] Keep/delete prompt (in-app + local notification); keep resets timer
- [ ] "Manage downloads" screen + storage usage in Profile
- [ ] Evict = content + images only; stub stays; server untouched

## M11 — APK
- [ ] Splash/icon assets; app.config polish
- [ ] EAS `preview` build → install on phone with Tailscale
- [ ] End-to-end against `cookbook.dog-taipan.ts.net:8443`: offline scenarios, backgrounded timers, reconnect sync
- [ ] Install instructions in `apps/mobile/README.md`
