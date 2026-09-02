# Recipe Book App — Design Document

## 1. Product Summary
A mobile-first recipe management app that lets a user log recipes (with or without precise measurements), scale them by servings, auto-generate grocery lists, import recipes from YouTube links, tag ingredients as "main" vs "swappable," search by ingredients on hand, plan meals on a calendar, and get personalized + AI-sourced recipe recommendations based on diet preferences.

Reference wireframes: `Dashboard` (home screen) and `Search` with a `Select Filter Tags` side panel. These define the base visual language; the direction below (bento-box UI) governs final layout treatment.

---

## 2. Design System

### 2.1 Layout Style — Bento Box
- The app uses a **bento-box grid**: content organized into distinct rectangular "cells" of varying sizes packed into a grid (as seen in the Dashboard wireframe: one large card, two medium cards, three small cards, one wide card).
- **Radius is the key differentiator from typical bento UI:** most bento-style UIs use large, pillowy corner radii (16–24px+). This app should use a **noticeably smaller radius** (~4–6px) on all bento cells — same grid/cell logic, flatter and crisper look. Apply this same reduced radius to cards, images, buttons, chips, and modals for consistency.
- Cell sizing follows a simple grid unit (e.g., a 4- or 6-column base grid) so cells can span 1–2 columns / 1–2 rows without ad hoc pixel math.
- Cells: thin 1px border, low/no shadow — keep it flat, not skeuomorphic. Diagonal-hatch placeholder pattern for empty/loading images (as in the wireframe) stays consistent across bento cells.

### 2.2 Color (tokens, not final hex — hand to visual design pass)
| Token | Usage |
|---|---|
| `--color-bg` | App background, neutral off-white |
| `--color-surface` | Card/cell background |
| `--color-border` | 1px hairline borders on cells, inputs, chips |
| `--color-text-primary` | Headings, body |
| `--color-text-secondary` | Meta text (time, servings, tags) |
| `--color-accent` | Primary action color, active nav indicator, active tag/tab state |
| `--color-placeholder` | Image placeholders / skeletons (diagonal hatch) |

### 2.3 Typography
- Display/H1: App name, screen titles ("Dashboard", "Search", "Meal Planner")
- H2: Section labels ("Upcoming Recipe", "Meal Planner", "Grocery List")
- Body: recipe titles, ingredient/block text
- Meta/small: servings, cook time, tag labels, timers

### 2.4 Core Components

1. **Top App Bar** — App name/logo (left), avatar/profile circle (right).
2. **Search Bar** — Icon + placeholder "Search here...", full width, small radius, sits directly under app bar.
3. **Filter Chip Row** — `+` button (opens filter panel) followed by horizontally scrollable chips.
4. **Filter Tag Panel ("Card")** — Slide-out panel, "Select Filter Tags" title, expandable "Active Item ⌄" groups revealing indented "Nested Item" rows, plus flat "Default Item" rows below. Reusable **Expandable Tag Filter** component (flat or one-level-nested).
5. **Bento Cell (base primitive)** — The atomic unit behind every dashboard/list card: image region (optional) + text region (optional) + action region (optional), sized to span 1x1, 2x1, or 2x2 grid units. All the components below (#6–#9) are specific configurations of this primitive.
6. **Recipe List Item (Search results)** — 1x1-wide bento cell: thumbnail (left) + title/meta lines (right). Carries a **quick-add-to-meal affordance** — see §4.2.
7. **Recipe Highlight Cell (Dashboard "Upcoming Recipe")** — Large bento cell: image, title, meta line, "Read more →". Tapping opens the **Recipe Reader** (§3.3) — see §4.1 for the multi-recipe behavior.
8. **Small Square Cells** — Used for "Meal Planner" entry, and "Meals planned for the day" thumbnails.
9. **Bottom Tab Bar** — 4 items: `Home` (active, colored underline), Search, Meal Planner, Profile.

### 2.5 Iconography
Clean line-icon set (e.g., Lucide), thin stroke, minimal fill — matches the flat, low-chrome bento treatment.

---

## 3. Screens

### 3.1 Dashboard (Home)
Bento grid, top to bottom:
1. App bar (logo + avatar)
2. **Upcoming Recipe** cell — large. Tapping opens the **Recipe Reader** loaded with the meal planned for the next upcoming slot. See §4.1 — if that meal has multiple dishes, the reader opens directly into its tabbed multi-recipe view.
3. **Meal Planner** entry cell → opens Meal Planner page (§3.5)
4. **Meals planned for the day** — row of 3 small square cells (breakfast/lunch/dinner), each tap → Recipe Reader for that meal/slot (again, tabbed if multiple dishes)
5. **Grocery List** summary cell → full Grocery List screen
6. Bottom tab bar

### 3.2 Search / Browse
1. App bar
2. Search input
3. Filter chip row (`+` opens the Filter Tag Panel, §2.4.4)
4. Result list — repeated **Recipe List Item** cells. Each item exposes the quick-add-to-meal affordance (§4.2) directly from the list, no need to open the recipe first.

### 3.3 Recipe Reader / Editor (Unified)
This is the single most important structural change from a typical app: **read mode and edit mode share the same layout and the same block components.** Editing is just "read mode with editable blocks," not a separate form screen.

**Notion-style block editor:**
- The recipe is a stack of typed blocks, added/reordered/removed via a `+` block inserter (appears on hover/tap between blocks, same as Notion's "+" affordance):
  - `Title` block
  - `Cover Image` block
  - `Meta` block (servings stepper, total time, source badge — manual / YouTube / imported)
  - `Ingredient` block — one per line item: quantity, unit, name, and a `Main`/`Swap` tag pill (tap pill to change; swap-tagged items show alternates on tap in both modes)
  - `Step` block — one per instruction: text + inline timer chip (see §3.3.1). Steps can include their own optional sub-image.
  - `Note` block — free text, for anything else (substitution notes, storage tips).
- **In read mode:** blocks render as plain, clean text/inline elements — no visible input chrome, no borders around fields. It should look like a finished document, not a form.
- **In edit mode:** the exact same blocks become directly editable in place (click text to edit, drag-handle on the left of each block to reorder, `+` to insert a new block type, trash icon to remove) — same fonts, same spacing, same positions as read mode. There is no separate "Edit Recipe" screen; there's an edit toggle on the same page.
- **Import entry points** live as a special first block/action when creating a new recipe from scratch: "Paste YouTube link" or "Import from URL" — running either populates the block stack automatically, which the user then edits in place like any other recipe.

#### 3.3.1 Multi-Recipe Tabs
Because a single dashboard "Upcoming Recipe" or planned meal can represent **multiple dishes** (e.g., a dinner of "Grilled Chicken" + "Rice Pilaf" + "Roasted Veg"), the Recipe Reader supports a **tab strip** directly under the app bar when more than one recipe is attached to the meal being viewed:
- Tabs labeled by recipe name (or dish thumbnail + name), horizontally scrollable if many.
- Only one recipe's block stack is shown at a time; switching tabs swaps the block stack below.
- The **Timer Tool** (§3.3.2) and **Shake-to-Advance** (§3.3.3) are scoped per active tab, but a small persistent indicator shows if another tab has a timer running in the background (e.g., a small dot/badge on that tab).
- When opened for a single-dish meal, the tab strip is simply hidden (not shown as a 1-item tab).

#### 3.3.2 Timer Tool
- Any `Step` block with a duration renders a tappable timer chip inline (e.g., "Simmer — 12 min").
- Tapping starts a countdown that also docks into a small **persistent floating timer control** (bottom-of-screen pill) so the user can navigate elsewhere in the app (e.g., switch tabs, open Grocery List) without losing the running timer. Tapping the floating control returns to that step.
- Multiple concurrent timers supported (e.g., one per active tab) — floating control shows a stack/count if more than one is running, expandable to see all.
- Timer completion: visual pulse + sound/vibration alert.

#### 3.3.3 Shake-to-Advance
- While the Recipe Reader is open in read mode (cooking mode), a **single shake gesture** advances to the next `Step` block, scrolling it into focus and starting its timer automatically if it has a duration. This is aimed at hands-messy cooking use — no need to touch the screen to progress.
- Should be toggleable (some users cook near counters where accidental shakes could happen) — expose an on/off affordance within the reader (e.g., small "shake to advance: on" indicator, tappable).

### 3.4 Quick Add to Meal (Modal)
Triggered from two places: (a) the **Recipe Reader**, and (b) each **Recipe List Item** in Search results — a small "add to meal" icon/button on the cell.

Modal contents:
- **Right now / #Upcoming** — adds it as the next thing to cook, surfaces on the Dashboard's "Upcoming Recipe" cell immediately.
- **Breakfast / Lunch / Dinner** (today, or default to "next occurrence" — see development doc for date resolution logic) — quick single-tap slot assignment.
- **In next [X] minutes** — quick numeric/stepper input for an ad hoc time (e.g., "in 30 min") rather than a fixed slot — good for "I'm hungry now-ish" use cases.
- **"Open full planner →"** button at the bottom of the modal — routes to the Meal Planner page (§3.5) for anything more specific (a future date, multiple dishes at once, etc.).
- Modal follows the same reduced-radius bento visual treatment as the rest of the app — not a full-screen takeover, a centered/bottom-sheet card.

### 3.5 Meal Planner (3-Panel Layout)
Desktop/tablet: true 3-column layout. Mobile: collapses to a single column with the sidebars accessible as swipeable panels or a bottom sheet toggle (agent's call based on final breakpoint strategy — the 3-panel *structure*, not necessarily 3 fixed columns, must be preserved on small screens).

- **Left Sidebar — "Recipes for Selected Day":** Lists whatever is already planned for the date currently selected in the calendar, grouped by meal slot (Breakfast/Lunch/Dinner/Snack), each entry a compact Recipe List Item with a remove/reassign action.
- **Center/Body — Calendar:** Week or month view (agent's call; week view likely more useful for a meal planner). Each day cell shows small recipe thumbnails/icons per planned meal slot. Selecting a day updates the left sidebar. Supports drag-and-drop of a recipe from the right sidebar onto a day/slot as an alternative to the Quick Add modal.
- **Right Sidebar — "Saved & Favorited" + Search:** A search bar at the top (same component as the main Search screen's search bar) to find any recipe, plus a default list of the user's saved/favorited recipes below it for fast access. Recipes here are draggable onto the calendar, or tappable to open the Quick Add modal (§3.4) pre-targeted at this planner context.

### 3.6 Grocery List
- Entry point: select recipes (from Search list quick-select, Meal Planner, or Recipe Reader) → "Generate Grocery List."
- Aggregated, de-duplicated ingredient list, quantities summed/unit-converted, grouped by grocery category, rendered as bento cells per category group.
- Checkbox per item to mark purchased; manual add-item field.

### 3.7 Diet Preferences / Profile
- Diet type(s), allergies/exclusions, disliked ingredients, preferred cuisines — feeds the recommendation engine (development doc §8).

---

## 4. Key Interaction Flows

### 4.1 Dashboard → Recipe Reader (multi-recipe aware)
Tapping the "Upcoming Recipe" cell or any "Meals planned for the day" thumbnail opens the Recipe Reader scoped to **that meal occurrence**, not a single fixed recipe. If one dish is planned, the reader opens directly on it with no tab strip. If multiple dishes are planned for that same meal, the reader opens with the tab strip visible (§3.3.1), defaulting to the first tab.

### 4.2 Quick Add to Meal
From the Recipe Reader or a Search result cell → tap the add-to-meal affordance → **Quick Add modal** (§3.4) → user picks Right Now/slot/custom-time, or jumps to the full planner. This is the primary path for planning without ever opening the calendar.

### 4.3 Notion-Style Editing
Open any recipe → toggle "Edit" → the identical block layout becomes directly editable in place → toggle back to "Done"/read mode → no navigation, no separate screen, no re-render into a different visual structure.

### 4.4 Servings Scaling
Stepper in the `Meta` block → all `Ingredient` blocks' quantities recompute live (ratio of new/base servings), with sensible rounding (avoid "1.333 eggs" — round to nearest practical fraction, or flag "adjust to taste").

### 4.5 YouTube Import
Paste/drop a YouTube URL at recipe-creation entry → loading state → block stack auto-populates (title, servings guess, ingredient blocks, timed step blocks) → user reviews/edits in the same unified block editor before saving.

### 4.6 Tag Filter Panel
Chip row `+` → panel slides in → user expands grouped tags, taps nested/default items → panel closes → chip row updates → result list re-queries.

### 4.7 Ingredient-Based Search
User enters ingredients they have → results ranked by % of a recipe's *main* ingredients matched (swap-tagged ingredients weighted lower/ignored in the match score).

---

## 5. Empty / Loading / Alert States
- Image placeholders use the diagonal-hatch pattern from the wireframe — consistent skeleton treatment across all bento cells.
- Grocery list empty state: "Select recipes to build your list."
- Meal Planner empty day: left sidebar shows "Nothing planned yet — drag a recipe here or use Quick Add."
- **AI quota alert:** the LLM runs on a free tier with daily request limits (development.md §0). When exhausted, show a dismissible banner/toast — "Daily AI requests used up — YouTube import and Discover are unavailable until tomorrow." — and disable only the AI-dependent entry points (grey them out with the same message on tap). Everything else in the app keeps working normally; this is never a blocking error screen.
