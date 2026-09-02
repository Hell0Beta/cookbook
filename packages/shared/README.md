# packages/shared

Single source of truth for TypeScript types and Zod schemas used by both `apps/web` and `apps/api`. **Any agent may add types here; no app redeclares them locally.**

Contents (as phases land):
- Entity types mirroring `docs/development.md` §3 "Data Model" — names identical to the doc.
- Zod schemas for API request/response validation (shared between client-side forms and server-side routes).
- Pure, unit-testable domain functions both apps need: serving scaling, unit conversion, slot-resolution (e.g. "next occurrence of dinner") — see `docs/agents/integrations.md` and `docs/agents/backend.md`.
