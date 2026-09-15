# Mobile App Changelog

Living documentation — updated with every change to the mobile app. Each entry: date, what changed, what it does (user-visible behavior + why). The build-phase plan is `docs/todos/mobile-phases.md`; the domain guide is `docs/agents/mobile.md`.

## 2026-09-15 — M0 + start of M1: scaffold, auth, connectivity

### Scaffold (M0)
- **`apps/mobile` workspace created** — Expo SDK 57 + expo-router (file-based tabs: Home, Search, Planner, Grocery, Profile), TypeScript strict, React Native 0.87. `expo-doctor` passes all 21 checks. What it does: the app now boots to a tab shell with placeholder screens, ready for Expo Go.
- **`metro.config.js`** — monorepo watch folders + node_modules paths. What it does: lets Metro resolve `@cookbook/shared` through the pnpm workspace symlink so the mobile app reuses the web app's shared types/logic.
- **`tsconfig.json` path alias `@cookbook/mobile/*`** — same convention as web's `@/` alias.
- **`eas.json`** — `preview` profile builds a direct-install `.apk` (no app store; the app talks to the private Tailscale server).
- **`app.config.ts`** — `cookbook://` deep-link scheme, Android package `app.cookbook.mobile`, new-arch enabled.

### API client + auth (M1)
- **`src/lib/api-transport.ts`** — fetch transport: injects the session cookie as a `Cookie` header (RN has no cookie jar), 8s timeout, normalizes errors to the API's `{ error, message? }` convention. Network-level failures throw `ApiRequestError(0, "network_error")` **and report to the connectivity watcher**, so a failed call flips the app into offline mode (App Plan.txt try-and-catch).
- **`src/lib/session.ts`** — session token in `expo-secure-store`; captured from the login response's `set-cookie` header.
- **`src/lib/config.ts`** — user-configurable server URL (AsyncStorage), default `https://cookbook.dog-taipan.ts.net:8443` (the Tailscale Serve entry point). Lets one build target both dev (LAN IP) and prod.
- **`src/lib/api-surface.ts`** — typed methods per REST endpoint (development.md §11), mirroring the web client.
- **`app/login.tsx`** — sign-in / sign-up screen with server-URL field. On success: stores the session, re-probes connectivity, returns to the app.

### Connectivity (M1) — try-and-catch, live recovery
- **`src/lib/connectivity.ts` + `src/stores/network.ts`** — three signals keep the online/offline state current without ever restarting the app: (1) NetInfo listener re-probes on network changes; (2) every failed API call marks offline and schedules a re-probe; (3) while offline a 15s re-probe loop catches silent reconnects. The probe hits `GET /users/me` — "online" means *the tailnet server answered*, not just Wi-Fi. Home screen shows the live status.
- **`src/lib/theme.ts`** — light/dark token palette (roles mirror the web design tokens; full bento design port lands with M4).

### Shared package (affects web + api too)
- **`packages/shared/src/search.ts`** — added `RecipeSearchPage` (the paginated `/recipes` envelope) as a shared schema; was duplicated as a web-local interface. Web's `api.ts` now imports/re-exports it.
- **`packages/shared/src/scaling.ts`** — added `ScaledRecipe` (the `/recipes/:id/scale` response) as a shared schema, same dedup rationale.

### Verification
- `pnpm typecheck` passes across all 4 workspace projects; shared's 85 tests pass.

## 2026-09-15 — M2: backend sync additions (apps/api + packages/shared)

- **`GET /recipes` list items now carry `updated_at` + `user_id`** (`apps/api/src/routes/recipes.ts`, `packages/shared/src/search.ts`). What it does: gives the mobile sync engine its incremental-pull cursor and lets the phone tell "my recipe" (sync full content) from shared dataset stubs. Additive — web ignores the new fields.
- **`?since=<ISO>` filter + `?page_size=` (up to 200)** on `GET /recipes`. What it does: incremental sync pulls only changed recipes after the first full stub pull (which needs ~68 requests at 200/page for the 13.5k dataset instead of ~560 at 24). Invalid `since` values fall back to a full pull rather than erroring (client clock skew can't brick sync). Ignored in ingredient-scoring mode.
- **`RecipeTombstone` Prisma model + `GET /recipes/deleted?since=`** (`apps/api/prisma/schema.prisma`, recipes route). What it does: deleting a recipe on web/API records a tombstone; the phone's next sync asks for tombstones since its cursor and removes those recipes locally. Entries auto-prune after 90 days. Favorites endpoint returns the same enriched summary shape.
- **`DeletedRecipesResponse` schema added to shared** — one declaration for the tombstone envelope.

### Verified live against the dev API
- `?page_size=1` returns 1 item with `updated_at`/`user_id`, `has_more: true`
- `?since=<future>` → empty; `?since=<epoch>` → all recipes
- DELETE recipe → 204; `/recipes/deleted` lists its id; list total drops

### Verification
- All 4 workspace typechecks pass; shared's 85 tests pass.
