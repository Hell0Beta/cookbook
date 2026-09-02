# apps/api

Backend service. **You are the backend agent's domain** — see `docs/agents/backend.md` before writing any code here.

- Owns the REST surface (`docs/development.md` §11), Prisma (SQLite) schema + migrations (`§3 Data Model` — field names are contractual), username-only auth, in-process job-queue infrastructure, and local file storage for images (see `development.md §0` — no Redis/S3/OAuth on this homeserver deployment).
- Domain logic (tagging, YouTube extraction, recommendations, import pipelines, unit conversion) lives in modules owned by the ai-pipeline and integrations agents — this app hosts and calls them; it does not implement them.
- Shared request/response schemas live in `packages/shared`.
- Build order: `docs/todos/phase-01-core-crud-unified-editor.md` first.
