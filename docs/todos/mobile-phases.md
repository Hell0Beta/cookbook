# Mobile App — Build Phases (M0–M11)

Offline-first Android companion (`apps/mobile/`, Expo + expo-router). **The app is a mobile re-render of the web screens** — every phase below names the web file to read and the mobile file it lands in. Specs are unchanged: `docs/design.md` (screens/states) and `docs/development.md` (§0 constraints, §3 data model, §7 timer/shake, §8 scaling, §11 API).

**Port rule:** read the web file, then rebuild with RN primitives (`View`/`FlatList`/`Pressable`) and `src/lib/theme.ts` tokens. Never carry over DOM assumptions (hover, `position: fixed`, Tailwind classes, `getElementById`). Logic in `@cookbook/shared` is imported as-is — never re-declared.

Tags: `*(mobile)*` this agent · `*(backend)*` request via backend agent · `*(shared)*` packages/shared. Log every change in `apps/mobile/CHANGELOG.md`.

## Web → mobile map

Web paths are relative to `apps/web/src/`.

| Screen / feature | Web source | Mobile target | Phase |
|---|---|---|---|
| Home / Dashboard | `app/page.tsx`, `components/dashboard-grid.tsx`, `components/grocery-summary-cell.tsx` | `app/(tabs)/index.tsx` | M4, M8 |
| Recipe list | `components/recipes-browser.tsx`, `app/recipes/page.tsx` | `app/(tabs)/index.tsx` | M4 |
| Reader (cooking view) | `app/recipes/[id]/reader-client.tsx`, read branches of `components/blocks/block-views.tsx` | `app/recipe/[id].tsx` | M4 |
| Reader (edit mode) | `components/recipe-editor.tsx`, edit branches of `components/blocks/block-views.tsx` | `app/recipe/[id]/edit.tsx` | M6 |
| Cover picker | `components/cover-picker.tsx` | `src/components/CoverPicker.tsx` | M6 |
| Timers | `components/timer/timer-store.ts`, `floating-timer-pill.tsx` | `src/stores/timers.ts` | M5 |
| Shake-to-advance | `components/timer/use-shake-to-advance.ts` | `src/lib/shake.ts` | M5 |
| Step navigation | `lib/step-navigation.ts` (DOM-bound) | pure parts → `*(shared)*` | M5 |
| Search + filters | `app/search/search-client.tsx`, `components/filter-tag-panel.tsx`, `components/ingredient-have-picker.tsx` | `app/(tabs)/search.tsx` | M8 |
| Favorites / Discover | `components/discover-section.tsx` | `app/(tabs)/index.tsx`, `app/discover.tsx` | M8 |
| Planner | `app/planner/planner-client.tsx` | `app/(tabs)/planner.tsx` | M7 |
| Quick add sheet | `components/quick-add-modal.tsx` | `src/components/QuickAddSheet.tsx` | M7 |
| Grocery list | `app/grocery-list/grocery-list-client.tsx` | `app/(tabs)/grocery.tsx` | M7 |
| Profile + diet | `app/profile/page.tsx`, `auth-client.tsx`, `diet-profile-form.tsx` | `app/(tabs)/profile.tsx` | M8, M10 |
| Imports | `components/youtube-import-panel.tsx`, `components/import-panel.tsx`, `app/recipes/new/page.tsx` | `app/import/*` | M9 |
| Quota UX (§5) | `components/llm-quota.tsx`; notice text is shared — `CHAT_QUOTA_NOTICE` in `packages/shared/src/chat.ts`, import it, don't copy | `src/components/QuotaNotice.tsx` | M9 |
| Bento system | `components/bento.tsx`, tokens in `app/globals.css` + `cookbook ui idea/stitch_yhup_communication_portal/heirloom_kitchen/DESIGN.md` | `src/lib/theme.ts`, `src/components/` | M4 |
| API client | `lib/api.ts` (+ `apiAsset()`) | `src/lib/api-surface.ts` ✅ | M1, M4 |
| Eviction / storage | — (mobile-only; no web equivalent) | `src/lib/eviction.ts` | M10 |
| Voice assistant | `components/chat/*` | **not ported — v2** | — |

Product rules carried over from the (now-removed) `App Plan.txt` — referenced by `src/sync/engine.ts`, `connectivity.ts`, `db/schema.ts`, `stores/network.ts`: **offline/hybrid feature split**, **try-and-catch connectivity with live recovery**, **eviction-with-prompt**. Restore the source file or keep these as the record.

## Shared modules — import, never re-declare

`packages/shared/src/` already holds the math and shapes each phase needs. The mobile app imports these; it does not port them.

| Module | Needed by | Key exports |
|---|---|---|
| `scaling.ts` | M5 servings stepper | serving-scale math (§8) |
| `slots.ts` | M7 planner | `resolveNextSlot`, `weekRange`, `toIsoDate`, `parseIsoDate`, `SLOT_TIMES` |
| `meal-plan.ts` | M7 quick add | `resolveQuickAddTarget` |
| `grocery.ts` | M7 grocery | `aggregateGroceryList`, `groupGroceryByCategory`, `CATEGORY_ORDER` |
| `search.ts` | M8 search | `RecipeSearchPage` envelope |
| `recommendations.ts` | M8 diet profile + Discover | `DietProfile` |
| `tagging.ts` | M6/M8 tag editing | tag + diet-inference shapes |
| `youtube.ts` | M9 import | extraction request/response shapes |
| `chat.ts` | M9 quota UX | `CHAT_QUOTA_NOTICE` |

Native deps for M4–M9 are **already in `apps/mobile/package.json`** — add nothing, or you'll duplicate a vendored dep: `expo-image` + `expo-file-system` (covers/cache, M4), `expo-linking` (deep links, M4), `react-native-gesture-handler` + `react-native-reanimated` (swipe actions + sheets, M4/M6), `zustand` (timers, M5), `expo-notifications` + `expo-sensors` + `expo-haptics` (M5).

## M0 — Scaffold
- [x] `apps/mobile` workspace: Expo SDK 57 + expo-router, TS strict, pnpm workspace *(mobile)*
- [x] Metro monorepo config; `expo-doctor` + all-workspace `pnpm typecheck` clean *(mobile)*
- [x] Tab shell — Home, Search, Planner, Grocery, Profile (`app/(tabs)/_layout.tsx`) *(mobile)*
- [x] `eas.json` `preview` (apk) profile; `cookbook://` scheme in `app.config.ts` *(mobile)*

## M1 — API client + auth + connectivity
- [x] Transport (`src/lib/api-transport.ts`): `Cookie` header session, 8s timeout, `{error, message?}` normalization; network failures report to the connectivity watcher *(mobile)*
- [x] Session token from `set-cookie` → SecureStore (`src/lib/session.ts`); server URL setting (`src/lib/config.ts`) *(mobile)*
- [x] Endpoint surface mirroring `apps/web/src/lib/api.ts` (`src/lib/api-surface.ts`) *(mobile)*
- [x] Login/signup screen (`app/login.tsx`), server-URL field *(mobile)*
- [x] Connectivity: NetInfo + reachability probe + failed-call reporting + 15s offline re-probe (`src/lib/connectivity.ts`, `src/stores/network.ts`) *(mobile)*
- [ ] `OfflineBanner` in `app/_layout.tsx` — status text currently lives on Home only; manual re-check uses the existing `recheckNow()` (`src/lib/connectivity.ts`) *(mobile)* → folds into M4's design pass

## M2 — Backend sync additions
- [x] `GET /recipes` summary gains `updated_at` + `user_id` *(backend)*
- [x] `GET /recipes?since=&page_size=` (≤200) — incremental pull cursor *(backend)*
- [x] `RecipeTombstone` + `GET /recipes/deleted?since=` (90-day prune) *(backend)*
- [x] development.md §11 + backend.md updated in the same change *(backend)*

## M3 — Local DB + sync engine
- [x] SQLite schema — stubs/content/mutation_queue/sync_meta, versioned migrations (`src/db/schema.ts`) *(mobile)*
- [x] Repository layer (`src/db/repositories/`) — screens touch only this *(mobile)*
- [x] Sync engine: pull-then-push, single-flight, triggers on start/online/foreground/login/pull-to-refresh (`src/sync/engine.ts`) *(mobile)*
- [x] LWW conflicts as pure functions + `conflicts` surfaced, never silent (`src/sync/lww.ts`, `tests/lww.test.ts`, 6 tests) *(mobile)*
- [x] Home renders the local library + sync status card (design.md §5 empty states) — the M4 design pass replaces this list's presentation *(mobile)*
- [ ] First-run progress UI — deferred; the dataset is small until M4/M9 pull it *(mobile)* → with M4

## M4 — Recipe library + reader ← current
Port the bento design system first, then the list and reader on top of it.
- [ ] Token port: `src/lib/theme.ts` gains the full Heirloom Kitchen palette from `app/globals.css` + `cookbook ui idea/stitch_yhup_communication_portal/heirloom_kitchen/DESIGN.md` (colors, radii, type scale) *(mobile)*
- [ ] `src/components/` bento primitives from `components/bento.tsx` — cell with image/text/action regions; cover images via `expo-image` *(mobile)*
- [ ] Recipe list on Home from `components/recipes-browser.tsx` + card cells in `components/dashboard-grid.tsx`: cover (`RecipeCover` → `apiAsset()`), title, meta, swipe actions (`react-native-gesture-handler`), pull-to-refresh (replaces M3's plain rows) *(mobile)*
- [ ] Reader `app/recipe/[id].tsx` from `reader-client.tsx`: header/cover, servings context, block stack; read-only first (edit is M6) *(mobile)*
- [ ] Block components from read branches of `components/blocks/block-views.tsx` — Meta (title/servings/source badge), Ingredient (qty/unit/role pill), Step (number, text, duration chip), Note *(mobile)*
- [ ] Images: `src/lib/images.ts` porting `apiAsset()` (`/images/*` is API-origin, prefix `NEXT_PUBLIC_API_URL` equivalent) + hero downloads via `expo-file-system` (`expo-file-system` and `expo-image` are already deps — no new packages) *(mobile)*
- [ ] Stub → full rehydrate from `src/db/repositories/recipes.ts`; "needs internet" state for stub rows offline (design.md §5) *(mobile)*
- [ ] Deep links `cookbook://recipe/:id` + `/recipe/[id]` route params via `expo-linking` *(mobile)*
- [ ] Carryover: `OfflineBanner` in root layout (manual re-check = `recheckNow()`); first-run sync progress *(mobile)*

## M5 — Cooking mode
Development.md §7 ("Timer Tool" / "Shake-to-Advance"), design.md §3.3.2–3.3.3.
- [ ] Read-mode blocks + servings stepper — reuse the M4 read components + `scaling.ts` from shared (§8) *(mobile)*
- [ ] Timers `src/stores/timers.ts` (zustand — already a dep) from `components/timer/timer-store.ts`: re-key to absolute timestamps (background-proof), `expo-notifications` scheduled triggers, vibration via `expo-haptics`; Android 13+ permission on first start *(mobile)*
- [ ] Floating timer pill from `components/timer/floating-timer-pill.tsx`; tap returns to the step *(mobile)*
- [ ] Shake `src/lib/shake.ts` from `components/timer/use-shake-to-advance.ts` via `expo-sensors` — magnitude-delta spike + cooldown, scoped to cooking mode *(mobile)*
- [ ] Step navigation: move the pure `resolveSwipe` / midpoint-rule helpers out of web-local `lib/step-navigation.ts` into `@cookbook/shared`; RN keeps only the sensor/scroll bindings *(shared + mobile)*
- [ ] CookedEvent queued on reader open (offline-safe, flushed by the sync engine) *(mobile)*

## M6 — Create / edit
- [ ] Editable block states from `components/recipe-editor.tsx` + edit branches of `block-views.tsx`: reorder, insert, delete, inline text, auto-grow fields *(mobile)*
- [ ] Offline create/edit → mutation queue; `PUT /recipes/:id/blocks` batching on save *(mobile)*
- [ ] Cover upload from `components/cover-picker.tsx` — online-only, gated with a clear offline state *(mobile)*

## M7 — Planner + quick add + grocery
- [ ] Planner `app/(tabs)/planner.tsx` from `app/planner/planner-client.tsx`: week strip, slot cells, entry CRUD via repositories; slot resolution from shared `slots.ts` (`resolveNextSlot`, `weekRange`, `toIsoDate`, `parseIsoDate`) *(mobile)*
- [ ] Quick add sheet from `components/quick-add-modal.tsx` — parameterized by `recipe_id`, preview line via shared `resolveQuickAddTarget` (`meal-plan.ts`), same helper the backend applies on `POST /meal-plans/quick-add`; bottom sheet on `react-native-reanimated` *(mobile)*
- [ ] Grocery `app/(tabs)/grocery.tsx` from `app/grocery-list/grocery-list-client.tsx`: category groups, check-off, recategorize, manual add — aggregation math from shared `grocery.ts` (`aggregateGroceryList`, `groupGroceryByCategory`, `CATEGORY_ORDER`) *(mobile)*

## M8 — Search + filters + favorites + Discover + diet profile
Needs M4 + M7 first: `search-client.tsx` imports `RecipeCover` and `QuickAddModal`, so both must exist as mobile components before this phase lands.
- [ ] Server search from `app/search/search-client.tsx`: debounced query, pagination via the shared `search.ts` `RecipeSearchPage` envelope, tag tree + ingredient matching modes *(mobile)*
- [ ] Filter panel from `components/filter-tag-panel.tsx`; "ingredients I have" from `components/ingredient-have-picker.tsx` — as native sheets *(mobile)*
- [ ] Local fallback search offline (stubs + cached ingredients) — no web equivalent *(mobile)*
- [ ] Favorites list + Discover (`components/discover-section.tsx`, online-only, accordion + collapsed default) *(mobile)*
- [ ] Diet profile from `app/profile/diet-profile-form.tsx`: diet/allergen/cuisine chips, excluded ingredients — `DietProfile` type from shared `recommendations.ts` *(mobile)*
- [ ] Home Dashboard composition from `components/dashboard-grid.tsx` + `components/grocery-summary-cell.tsx`: upcoming meal cell, day slots, grocery summary *(mobile)*

## M9 — Imports (online-only)
- [ ] YouTube import from `components/youtube-import-panel.tsx` — review-before-save, `no_recipe_content` nudge, free-tier wait state; request/response shapes from shared `youtube.ts` *(mobile)*
- [ ] Public API import from `components/import-panel.tsx` + the create flow in `app/recipes/new/page.tsx` *(mobile)*
- [ ] `llm_quota_exceeded` UX (design.md §5) from `components/llm-quota.tsx` — disable AI features only, never block core flows; use the shared `CHAT_QUOTA_NOTICE` (`packages/shared/src/chat.ts`) for the notice text *(mobile)*

## M10 — Eviction system
Mobile-only — no web source. Rules from App Plan.txt (see above).
- [ ] Unused 30–60-day detection (default 45, configurable) *(mobile)*
- [ ] Keep/delete prompt (in-app + local notification); keep resets the timer *(mobile)*
- [ ] "Manage downloads" screen + storage usage on Profile *(mobile)*
- [ ] Evict = content + images only; stub stays; server untouched (`src/db/schema.ts` split) *(mobile)*

## M11 — APK
- [ ] Splash/icon assets; `app.config.ts` polish *(mobile)*
- [ ] EAS `preview` build → install on phone with Tailscale *(mobile)*
- [ ] End-to-end against the tailnet server: offline scenarios, backgrounded timers, reconnect sync *(mobile)*
- [ ] Install instructions in `apps/mobile/README.md` *(mobile)*
