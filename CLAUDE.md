# Recipe Book App — Agent Entry Point

This repo is a multi-agent build of a mobile-first recipe management app (bento UI, block-based recipe editor, meal planning, YouTube import, AI tagging/recommendations). Two documents are the source of truth. Everything else in this repo serves them.

## Read order (before doing ANY work)

1. `docs/design.md` — UI/UX spec: bento layout, color/typography system, all screens, interaction flows.
2. `docs/development.md` — technical spec: **read §0 (deployment constraints) first**, then stack, libraries, data model, tagging engine, import pipelines, REST API surface, build phases.
3. Your own guide: `docs/agents/<your-domain>.md` — scope, boundaries, implementation notes.
4. Your phase checklist(s): `docs/todos/phase-*.md` — check items off as you complete them.

Also see `cookbook ui idea/stitch_yhup_communication_portal/` — Stitch-generated HTML mockups + `heirloom_kitchen/DESIGN.md` (concrete color/typography/radius tokens that implement design.md §2's token system). Frontend agent: treat these as visual reference; the token file is the resolved palette.

> Note: `docs/development.md` has inherited some inconsistent internal numbering from drafting (e.g. §3 "Data Model" contains a "2.1 Core Entities" heading; §7 contains "6.x" subheadings). **Cite sections by top-level number + heading name** (e.g. "development.md §7, 'Unified Read/Edit Surface'") rather than trusting sub-numbers.

## Repo layout

```
apps/web/            Next.js frontend (bento UI, block editor, meal planner)
apps/api/            Node backend (REST API, Prisma + SQLite, in-process job queue)
packages/shared/     TypeScript types + Zod schemas shared by web + api
docs/
  design.md          UI/UX spec (source of truth for screens/components)
  development.md     Technical spec (source of truth for data model, pipelines, API)
  agents/            Per-domain agent guides (scope + boundaries)
  todos/             Per-phase build checklists
cookbook ui idea/    Stitch mockups (HTML + PNG) and resolved design tokens
```

## Deployment & environment constraints (development.md §0 — binding)

Self-hosted homeserver: Linux, i3 4th-gen, 8 GB RAM, ≤5 concurrent users. Every agent must respect:

- **LLM = OpenRouter `nvidia/nemotron-3.5-lightning:free`** (owner-provided key) — *not* Anthropic/Claude. It's a free tier with **daily request limits**: backend detects the quota-exhausted response and returns `429 { error: "llm_quota_exceeded" }`; frontend shows the "daily AI requests used up" alert (design.md §5) and disables only AI features. Rule-based code first, LLM as enhancement — AI features must degrade gracefully, never block core flows.
- **No S3, no Redis, no OAuth.** Images → local data directory served by the API. Caching → in-process LRU/Map with TTL. Jobs → in-process queue (`p-queue`-style), not BullMQ. Auth → username-only + signed session cookie.
- **Offline-first runtime:** the only permitted outbound calls are OpenRouter and user-initiated imports (YouTube, TheMealDB/Spoonacular). No CDN fonts (self-host via `next/font/local`), no telemetry, no runtime downloads.
- **All dependencies vendored at build time** — lockfile-pinned installs (or a Docker image with node_modules baked in).
- **Database: SQLite via Prisma** (single file, backed up by copying). No Postgres/Redis daemons.
- Public recipe API: **TheMealDB default** (free, no key); Spoonacular only behind a config flag with an owner-provided key.

## Working conventions (all agents)

- **Don't duplicate spec content into code comments.** Reference doc sections instead (e.g. `// implements development.md §6, "Diet tag inference"`), never paste the spec into files.
- **Define data shapes once** in `packages/shared`. If web and api both need a type/schema, it lives there and both import it. No parallel re-declarations.
- **Check off todo items** (`- [ ]` → `- [x]`) in `docs/todos/phase-*.md` as you complete them.
- **Keep entity/field names identical to development.md §3 "Data Model"** (`MealPlanEntry.is_upcoming_pin`, `RecipeIngredient.role_tag`, `source_type`, etc.) unless you also update `docs/development.md` in the same change. A rename without a doc update is a bug.
- Match the existing code style of whatever you touch; don't reformat unrelated files.
- **Runtime network access is restricted** to OpenRouter + user-initiated imports (development.md §0). Adding any other outbound call (CDN, font, telemetry, update check) is out of bounds without updating that doc first.
- When a spec is ambiguous, prefer the option development.md §13 "Open Questions" already frames, and record the decision in the relevant `docs/agents/*.md` "Decisions" section rather than silently picking.

## Agent split

| Agent | Owns | Does NOT own |
|---|---|---|
| **frontend** (`docs/agents/frontend.md`) | `apps/web/` everything: bento design system, all screens (Dashboard, Search, Reader/Editor, Quick Add, Meal Planner, Grocery List, Profile), BlockNote unified read/edit surface, timers/shake gesture state, all data fetching via TanStack Query | API route handlers, business logic behind endpoints, schema definitions (imports from `packages/shared`), tagging/import/recommendation logic |
| **backend** (`docs/agents/backend.md`) | `apps/api/` everything: REST surface (development.md §11), Prisma (SQLite) schema + migrations, username-only auth, meal-plan date/slot resolution, grocery aggregation persistence, favorites/upcoming queries, in-process job queue wiring, local image file storage, LLM quota error handling | Any UI, the tagging engine's classification logic, YouTube/public-API extraction logic, recommendation ranking logic (it hosts and calls these as services owned by ai-pipeline/integrations) |
| **ai-pipeline** (`docs/agents/ai-pipeline.md`) | Tagging Engine (development.md §6) incl. rule-based + LLM passes, YouTube extraction pipeline (§5), Tier 1 internal recommendations, Tier 2 Discover recommendations (§10), all OpenRouter LLM client code + prompt budgeting | The REST endpoints exposing these (backend hosts them), any UI, ingredient string parsing / unit conversion math |
| **integrations** (`docs/agents/integrations.md`) | Public API import pipeline (§4: TheMealDB default, Spoonacular behind a flag), ingredient parsing (`parse-ingredient`), unit conversion engine (§8: scaling + grocery aggregation math), ingredient fuzzy-matching/dictionary maintenance | YouTube import, tagging/classification decisions, API routes, UI |

Overlap rule: when a feature spans agents (e.g. YouTube import = ai-pipeline extraction + backend endpoint + frontend loading state), **backend owns the route, the domain specialist owns the logic as an importable service/module, frontend owns the surface.** Interfaces between agents are defined in `packages/shared`.

## Definition of done (per feature/PR, all agents)

- [ ] Implements the referenced `docs/design.md` / `docs/development.md` section(s) — or the doc was updated in the same change to match.
- [ ] Data shapes come from `packages/shared`; entity/field names match development.md §3.
- [ ] No spec text duplicated into comments — section references only.
- [ ] Corresponding items in `docs/todos/phase-*.md` checked off.
- [ ] Loading and empty states exist (design.md §5) — frontend; validation and error responses exist — backend/services.
- [ ] Passes lint/typecheck/build for the workspace(s) you touched.
- [ ] Anything the next agent needs to know (interface changes, new shared types, resolved open questions) recorded in your `docs/agents/*.md` file.
- [ ] No new runtime network calls beyond development.md §0's allowlist; all deps installable offline (lockfile-pinned). AI-dependent paths handle `llm_quota_exceeded` gracefully.
