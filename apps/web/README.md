# apps/web

Next.js frontend. **You are the frontend agent's domain** — see `docs/agents/frontend.md` before writing any code here.

- Visual spec: `docs/design.md` (bento system, screens, flows) + resolved tokens in `cookbook ui idea/stitch_yhup_communication_portal/heirloom_kitchen/DESIGN.md`
- Stack decisions: `docs/development.md` §2 (shadcn/ui, BlockNote, dnd-kit, TanStack Query, Zustand, Framer Motion, sonner, lucide-react)
- All shared types/schemas come from `packages/shared` — never redeclare them here.
- Build order: `docs/todos/phase-01-core-crud-unified-editor.md` first.
