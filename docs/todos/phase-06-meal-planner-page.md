# Phase 6 — Meal Planner Page

From development.md §12, Build Phase 6. Implements: 3-panel layout (calendar body, day sidebar, saved/search sidebar) with drag-and-drop assignment (design.md §3.5).

## Calendar & assignment API (development.md §11)
- [x] `GET /meal-plans?week=` — calendar body data *(backend)*
- [x] `POST /meal-plans` — assign recipe to date/slot (drag-and-drop target) *(backend)*
- [x] `GET /recipes/favorites`, `POST /recipes/:id/favorite`, `DELETE /recipes/:id/favorite` *(backend)*
- [x] Reassign/remove entry actions on planned meals *(backend)* — `PATCH /meal-plans/:id` + `DELETE /meal-plans/:id`

## Layout (design.md §3.5)
- [x] Calendar spike: FullCalendar + external-event-dragging vs hand-rolled CSS grid + date-fns week view (development.md §2) — record choice in frontend "Decisions" *(frontend)* — hand-rolled grid-cols-7 week strip; see `docs/agents/frontend.md` Decisions
- [x] Center: week (or month) calendar; day cells show recipe thumbnails/icons per planned slot *(frontend)* — per-slot dot indicators (capped at 4)
- [x] Left sidebar "Recipes for Selected Day": entries grouped by meal slot, compact Recipe List Items with remove/reassign *(frontend)*
- [x] Right sidebar "Saved & Favorited" + search bar (same component as main Search) *(frontend)*
- [x] Mobile: 3-panel structure preserved — single column with swipeable panels or bottom-sheet toggle *(frontend)* — picker is a bottom sheet

## Interactions (design.md §3.5, §3.4)
- [x] Selecting a day updates the left sidebar *(frontend)*
- [x] Drag recipe from right sidebar onto day/slot (dnd-kit or FullCalendar plugin) *(frontend)* — dnd-kit; dish cards drag too (PATCH reassign)
- [x] Tap a sidebar recipe → Quick Add modal pre-targeted at planner context *(frontend)* — `plannerDate` prop on QuickAddModal; sheet opened from an "ADD <SLOT>" cell assigns straight to that slot
- [x] Empty day state: "Nothing planned yet — drag a recipe here or use Quick Add." (design.md §5) *(frontend)* — empty-state cell per the `meal_planner_empty_state` mockup
