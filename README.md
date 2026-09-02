# Cookbook

Self-hosted recipe book app — bento UI, unified block-based recipe editor, meal
planning, grocery lists, YouTube import, AI tagging & recommendations.

**Read [`CLAUDE.md`](./CLAUDE.md) first**, then the specs in `docs/`.

## Quick start (dev)

```bash
pnpm install
pnpm db:push          # create SQLite schema (apps/api/data/cookbook.db)
pnpm dev              # api on :3001, web on :3000
```

Open http://localhost:3000, create a username under Profile, and start adding
recipes. Environment defaults live in `.env.example` (API key for the LLM is
only needed from Phase 3+).

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js frontend |
| `apps/api` | Express + Prisma (SQLite) backend |
| `packages/shared` | Shared Zod schemas, types, pure domain functions |
| `docs/` | Specs, agent guides, phase checklists |
