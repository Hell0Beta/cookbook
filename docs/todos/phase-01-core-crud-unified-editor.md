# Phase 1 — Core CRUD + Unified Reader/Editor

From development.md §12, Build Phase 1. Implements: auth, Recipe/Ingredient/Step models, the block-based read/edit surface (development.md §7, "Unified Read/Edit Surface"), servings scaling.

## Scaffold
- [x] Monorepo tooling: pnpm workspaces / Turborepo for `apps/web`, `apps/api`, `packages/shared` *(backend)*
- [x] `apps/web`: Next.js + Tailwind + shadcn/ui + TanStack Query + Zustand skeleton *(frontend)*
- [x] `apps/api`: NestJS or Express + Prisma (SQLite) skeleton *(backend)*
- [x] `packages/shared`: initial Zod schemas + TS types for Recipe, RecipeIngredient, RecipeStep, block types *(backend, reviewed by frontend)*

## Auth & user (development.md §0, §11)
- [x] `POST /auth/signup`, `POST /auth/login` — username-only, long-lived signed session cookie *(backend)*
- [x] `GET /users/me` *(backend)*

## Data model (development.md §3 "Data Model")
- [x] Prisma schema: User, Recipe, Ingredient, RecipeIngredient, RecipeStep (+ RecipeNote or generic RecipeBlock per §7.1) *(backend)*
- [x] `source_type` enum (`manual`, `youtube_import`, `public_api`, `web_import`); nullable `source_url` *(backend)*
- [x] `RecipeIngredient`: nullable `quantity`/`ingredient_id`, `unit` enum, `role_tag` enum, `sort_order` *(backend)*

## API (development.md §11)
- [x] `POST /recipes`, `GET /recipes/:id`, `PUT /recipes/:id`, `DELETE /recipes/:id` *(backend)*
- [x] `GET /recipes/:id/scale?servings=6` — uses integrations' scaling helpers (stub with raw multiply until Phase 2 if needed) *(backend)*

## Unified Reader/Editor (design.md §3.3, §4.3; development.md §7.1)
- [x] Bento design system: Tailwind theme from `heirloom_kitchen/DESIGN.md` tokens; base `BentoCell` primitive (design.md §2.1, §2.4 #5) *(frontend)*
- [x] Client-side block model: ordered array of typed blocks mirroring server rows *(frontend)*
- [x] One component per block type (Title, Cover Image, Meta, Ingredient, Step, Note) with `readonly`/`editable` props — same tree both modes *(frontend)*
- [x] BlockNote integration: drag-handle reorder, `+` inserter, block-type menu; spike custom `Step` block feasibility (development.md §2) *(frontend)*
- [x] `PUT /recipes/:id/blocks` batch persist on save/blur *(backend)*
- [x] Edit toggle with zero layout shift between modes (design.md §4.3) *(frontend)*
- [x] Ingredient block `Main`/`Swap` pill (visual only this phase; tagging logic is Phase 3) *(frontend)*
- [x] Servings stepper in Meta block → live scaled quantities (design.md §4.4; math from `packages/shared`) *(frontend + integrations)*

## Scaling helpers (development.md §8 "Serving Scaling")
- [x] Pure scaling function + fraction rounding (¼/⅓/½ for volumes, whole units for pieces, nulls pass through) exported from `packages/shared` *(integrations)*

## Wrap-up
- [x] Local image storage: configurable data dir + static serve route (no S3 — development.md §0) *(backend)*
- [x] Self-hosted fonts via `next/font/local` — zero external requests at runtime *(frontend)*
- [x] All agents: check off items, record interface notes in `docs/agents/*.md` "Decisions"
