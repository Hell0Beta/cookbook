"use client";

// Meal Planner — design.md §3.5, development.md §12 (Phase 6). Three panels:
// week strip + selected-day slot sections (left), "Saved & Favorited" + search
// picker (right — static column on lg, bottom sheet on mobile per the §3.5
// mobile fallback). Drag-and-drop uses @dnd-kit/core (same sensor setup as the
// block editor): picker recipe → slot = POST /meal-plans, dish card → slot/day
// = PATCH reassign, recipe → day cell = Quick Add pre-targeted at that date.
// Empty-state visuals follow the meal_planner_empty_state mockup.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Cookie,
  Croissant,
  Plus,
  Sandwich,
  Search as SearchIcon,
  Star,
  UtensilsCrossed,
  X,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  parseIsoDate,
  toIsoDate,
  weekRange,
  type MealPlanEntryOut,
  type MealSlot,
} from "@cookbook/shared";
import { api, type RecipeSummary } from "@/lib/api";
import { RecipeCover } from "@/components/cover-picker";
import { QuickAddModal } from "@/components/quick-add-modal";
import { cn } from "@/lib/utils";

const SLOTS: { slot: MealSlot; label: string; icon: typeof Croissant }[] = [
  { slot: "breakfast", label: "Breakfast", icon: Croissant },
  { slot: "lunch", label: "Lunch", icon: Sandwich },
  { slot: "dinner", label: "Dinner", icon: UtensilsCrossed },
  { slot: "snack", label: "Snack", icon: Cookie },
];

const addDays = (iso: string, n: number) => {
  const d = parseIsoDate(iso);
  d.setDate(d.getDate() + n);
  return toIsoDate(d);
};

// Drag/drop id codecs — scope keeps the static column and the mobile sheet
// from registering duplicate draggable ids.
const recipeDragId = (scope: string, id: string) => `recipe:${scope}:${id}`;
const entryDragId = (id: string) => `entry:${id}`;
const slotDropId = (date: string, slot: MealSlot) => `slot:${date}|${slot}`;
const dayDropId = (date: string) => `day:${date}`;

export function PlannerClient() {
  const queryClient = useQueryClient();
  const today = useMemo(() => toIsoDate(new Date()), []);
  const [weekStart, setWeekStart] = useState(() => weekRange(today).from);
  const [selectedDate, setSelectedDate] = useState(today);
  // Picker sheet — `slot` is set when opened from an "ADD <SLOT>" cell, so a
  // tap assigns straight to that slot (null → Quick Add on the selected day).
  const [sheet, setSheet] = useState<{ open: boolean; slot: MealSlot | null }>({
    open: false,
    slot: null,
  });
  const [quickAdd, setQuickAdd] = useState<{
    recipeId: string;
    title: string;
    date: string;
  } | null>(null);
  const [activeDrag, setActiveDrag] = useState<{ title: string; thumb: string | null } | null>(
    null,
  );

  const { data: weekEntries } = useQuery({
    queryKey: ["meal-plans", "week", weekStart],
    queryFn: () => api.getMealsForWeek(weekStart),
  });
  // Drag-source lookup over the first page — drag handles only exist on
  // rendered cards, which come from the same page.
  const { data: recipesPage } = useQuery({
    queryKey: ["recipes", "browse"],
    queryFn: () => api.listRecipes(1),
  });
  const recipes = recipesPage?.items ?? [];

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const dayEntries = useMemo(
    () => (weekEntries ?? []).filter((e) => e.date === selectedDate),
    [weekEntries, selectedDate],
  );
  const entriesForSlot = (slot: MealSlot) => dayEntries.filter((e) => e.meal_slot === slot);
  const unslotted = dayEntries.filter((e) => e.meal_slot === null);

  // ── mutations ───────────────────────────────────────────────────────────────
  const invalidateMeals = () => queryClient.invalidateQueries({ queryKey: ["meal-plans"] });

  const assign = useMutation({
    mutationFn: (body: { recipe_id: string; date: string; meal_slot: MealSlot }) =>
      api.assignMeal(body),
    onSuccess: () => invalidateMeals(),
    onError: () => toast.error("Couldn't plan that recipe — try again"),
  });
  const move = useMutation({
    mutationFn: (args: { id: string; patch: { date: string; meal_slot?: MealSlot | null } }) =>
      api.updateMealPlanEntry(args.id, args.patch),
    onSuccess: () => invalidateMeals(),
    onError: () => toast.error("Couldn't move that dish — try again"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteMealPlanEntry(id),
    onSuccess: () => invalidateMeals(),
    onError: () => toast.error("Couldn't remove that dish — try again"),
  });

  // ── week navigation (keeps the selected weekday when shifting) ──────────────
  const shiftWeek = (dir: 1 | -1) => {
    const offset = days.indexOf(selectedDate);
    const nextStart = addDays(weekStart, dir * 7);
    setWeekStart(nextStart);
    setSelectedDate(addDays(nextStart, offset < 0 ? 0 : offset));
  };

  // ── picker taps ─────────────────────────────────────────────────────────────
  const pickRecipe = (r: RecipeSummary) => {
    const slot = sheet.slot;
    if (slot) {
      assign.mutate(
        { recipe_id: r.id, date: selectedDate, meal_slot: slot },
        {
          onSuccess: () =>
            toast.success(`Planned "${r.title}" for ${dayLabel(selectedDate)}'s ${cap(slot)}`),
        },
      );
      setSheet({ open: false, slot: null });
    } else {
      setSheet({ open: false, slot: null });
      setQuickAdd({ recipeId: r.id, title: r.title, date: selectedDate });
    }
  };

  // ── drag-and-drop ───────────────────────────────────────────────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith("entry:")) {
      const entry = weekEntries?.find((en) => entryDragId(en.id) === id);
      if (entry) setActiveDrag({ title: entry.recipe.title, thumb: entry.recipe.hero_image_url });
    } else {
      const recipeId = id.split(":")[2];
      const r = (recipes ?? []).find((x) => x.id === recipeId);
      if (r) setActiveDrag({ title: r.title, thumb: r.hero_image_url });
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    const id = String(e.active.id);

    if (id.startsWith("recipe:")) {
      const recipeId = id.split(":")[2]!;
      const r = (recipes ?? []).find((x) => x.id === recipeId);
      if (!r) return;
      if (over.startsWith("slot:")) {
        const [date, slot] = over.slice(5).split("|") as [string, MealSlot];
        assign.mutate(
          { recipe_id: recipeId, date, meal_slot: slot },
          { onSuccess: () => toast.success(`Planned "${r.title}" for ${dayLabel(date)}'s ${cap(slot)}`) },
        );
      } else if (over.startsWith("day:")) {
        const date = over.slice(4);
        setQuickAdd({ recipeId, title: r.title, date });
      }
      return;
    }

    if (id.startsWith("entry:")) {
      const entryId = id.slice(6);
      const entry = weekEntries?.find((en) => en.id === entryId);
      if (!entry) return;
      if (over.startsWith("slot:")) {
        const [date, slot] = over.slice(5).split("|") as [string, MealSlot];
        if (entry.date === date && entry.meal_slot === slot) return;
        move.mutate({ id: entryId, patch: { date, meal_slot: slot } });
      } else if (over.startsWith("day:")) {
        const date = over.slice(4);
        if (entry.date === date) return;
        move.mutate({ id: entryId, patch: { date } });
      }
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveDrag(null)}
    >
      {/* Page header — meal_planner_empty_state mockup */}
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-display)] font-bold">
            {/* Meal Planner */}
          </h2>
          <p className="mt-1 text-(--color-text-secondary)">Organize your meals.</p>
        </div>
        <button
          type="button"
          onClick={() => setSheet({ open: true, slot: null })}
          className="flex shrink-0 items-center gap-1.5 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-3 py-2 text-[length:var(--text-meta)] font-medium text-white hover:opacity-90"
        >
          <Plus className="size-4" strokeWidth={1.5} />
          Add a Recipe
        </button>
      </div>

      {/* Week strip — grid-cols-7 day cells (empty-state mockup layout) */}
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-mono text-(--color-text-secondary)">{weekLabel(days)}</span>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Previous week"
            onClick={() => shiftWeek(-1)}
            className="flex size-7 items-center justify-center rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) hover:border-(--color-accent)"
          >
            <ChevronLeft className="size-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-label="Next week"
            onClick={() => shiftWeek(1)}
            className="flex size-7 items-center justify-center rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) hover:border-(--color-accent)"
          >
            <ChevronRight className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <div className="mb-6 grid grid-cols-7 gap-1">
        {days.map((date) => (
          <DayCell
            key={date}
            date={date}
            selected={date === selectedDate}
            isToday={date === today}
            entryCount={(weekEntries ?? []).filter((e) => e.date === date).length}
            onSelect={() => setSelectedDate(date)}
          />
        ))}
      </div>

      {/* 3-panel body: day (left) + picker (right; static column on lg only) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {/* Selected-day header */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-(--color-border)/50 pb-3">
            <h3 className="min-w-0 font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
              {dayLabel(selectedDate, { weekday: true })}
            </h3>
            <span className="rounded-(--radius-sm) bg-(--color-surface-container-high) px-2 py-1 font-mono text-mono text-(--color-text-secondary)">
              {dayEntries.length} MEAL{dayEntries.length === 1 ? "" : "S"} PLANNED
            </span>
          </div>

          {dayEntries.length === 0 ? (
            <EmptyDayState onAdd={() => setSheet({ open: true, slot: null })} />
          ) : (
            <div className="flex flex-col gap-4">
              {SLOTS.map(({ slot, label, icon: Icon }) => (
                <SlotSection
                  key={slot}
                  date={selectedDate}
                  slot={slot}
                  label={label}
                  icon={<Icon className="size-4" strokeWidth={1.5} />}
                  entries={entriesForSlot(slot)}
                  busy={move.isPending || remove.isPending}
                  onAddSlot={() => setSheet({ open: true, slot })}
                  onRemove={(id) => remove.mutate(id)}
                />
              ))}
              {unslotted.length > 0 && (
                <ScheduledSection
                  entries={unslotted}
                  busy={remove.isPending}
                  onRemove={(id) => remove.mutate(id)}
                />
              )}
            </div>
          )}
        </div>

        {/* Static picker column — desktop drag source */}
        <aside className="hidden lg:block">
          <RecipePicker scope="side" draggable onPick={pickRecipe} />
        </aside>
      </div>

      {/* Mobile picker sheet — tap-first (the sheet covers drop targets, so
          dragging from here isn't useful; the lg column handles drag) */}
      {sheet.open && (
        <div
          className="fixed inset-0 z-20 flex items-end bg-black/30 lg:hidden"
          onClick={() => setSheet({ open: false, slot: null })}
        >
          <div
            className="flex max-h-[78dvh] w-full flex-col rounded-t-(--radius-bento) border border-(--color-border) bg-(--color-surface)"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Pick a recipe"
          >
            <div className="flex items-center justify-between border-b border-(--color-border)/50 p-(--spacing-cell) pb-3">
              <h3 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
                {sheet.slot ? `Add to ${cap(sheet.slot)}` : "Add a Recipe"}
              </h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setSheet({ open: false, slot: null })}
                className="text-(--color-text-secondary)"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-(--spacing-cell)">
              <RecipePicker scope="sheet" draggable={false} onPick={pickRecipe} />
            </div>
          </div>
        </div>
      )}

      <DragOverlay>
        {activeDrag && (
          <div className="flex items-center gap-3 rounded-(--radius-bento) border border-(--color-accent) bg-(--color-surface) p-3 opacity-90">
            <RecipeCover
              url={activeDrag.thumb}
              className="size-10 shrink-0 rounded-(--radius-sm) border border-(--color-border)"
            />
            <span className="font-medium">{activeDrag.title}</span>
          </div>
        )}
      </DragOverlay>

      {quickAdd && (
        <QuickAddModal
          recipeId={quickAdd.recipeId}
          recipeTitle={quickAdd.title}
          plannerDate={quickAdd.date}
          onClose={() => setQuickAdd(null)}
        />
      )}
    </DndContext>
  );
}

// ── week strip day cell (droppable: open Quick Add pre-targeted on drop) ─────

function DayCell({
  date,
  selected,
  isToday,
  entryCount,
  onSelect,
}: {
  date: string;
  selected: boolean;
  isToday: boolean;
  entryCount: number;
  onSelect: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: dayDropId(date) });
  const d = parseIsoDate(date);
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col items-center rounded-(--radius-sm) border p-2 transition-colors",
        selected
          ? "border-(--color-accent) bg-(--color-accent) text-white"
          : isToday
            ? "border-(--color-accent) bg-(--color-surface) text-(--color-text-primary)"
            : "border-(--color-border) bg-(--color-surface) text-(--color-text-primary) hover:bg-(--color-surface-container)",
        date < toIsoDate(new Date()) && !selected && "opacity-60",
        isOver && !selected && "border-(--color-accent) bg-(--color-surface-container)",
      )}
    >
      <span
        className={cn(
          "font-mono text-mono",
          selected ? "font-bold text-white" : "text-(--color-text-secondary)",
        )}
      >
        {d.toLocaleDateString("en-US", { weekday: "short" }).slice(0, 3).toUpperCase()}
      </span>
      <span className="mt-1 font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-bold">
        {d.getDate()}
      </span>
      <span className="mt-1.5 flex h-1.5 gap-0.5">
        {Array.from({ length: Math.min(entryCount, 4) }, (_, i) => (
          <span
            key={i}
            className={cn(
              "size-1.5 rounded-full",
              selected ? "bg-white" : "bg-(--color-secondary)",
            )}
          />
        ))}
      </span>
    </button>
  );
}

// ── selected-day slot section (droppable target for recipes + dish cards) ────

function SlotSection({
  date,
  slot,
  label,
  icon,
  entries,
  busy,
  onAddSlot,
  onRemove,
}: {
  date: string;
  slot: MealSlot;
  label: string;
  icon: React.ReactNode;
  entries: MealPlanEntryOut[];
  busy: boolean;
  onAddSlot: () => void;
  onRemove: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: slotDropId(date, slot) });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-(--radius-bento) border p-2 transition-colors",
        isOver
          ? "border-(--color-accent) bg-(--color-surface-container)"
          : "border-transparent",
      )}
    >
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className="shrink-0 text-(--color-text-secondary)">{icon}</span>
        <span className="min-w-0 break-words font-mono text-mono uppercase tracking-wider text-(--color-text-secondary)">
          {label}
        </span>
      </div>
      {entries.map((e) => (
        <DishCard key={e.id} entry={e} busy={busy} onRemove={onRemove} />
      ))}
      {entries.length === 0 && (
        <button
          type="button"
          onClick={onAddSlot}
          className="hatch flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-(--radius-bento) border border-dashed border-(--color-border-strong)/40 px-2 text-center text-(--color-text-secondary) transition-colors hover:bg-(--color-surface)"
        >
          <Plus className="size-4 shrink-0 text-(--color-accent)" strokeWidth={1.5} />
          <span className="min-w-0 break-words font-mono text-mono tracking-widest">
            ADD {label.toUpperCase()}
          </span>
        </button>
      )}
    </div>
  );
}

// ── dish card (draggable — PATCH-reassign on drop; remove → DELETE) ──────────

function DishCard({
  entry,
  busy,
  onRemove,
}: {
  entry: MealPlanEntryOut;
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entryDragId(entry.id),
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "flex min-w-0 items-stretch gap-3 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-2 lg:cursor-grab lg:active:cursor-grabbing",
        isDragging && "opacity-40",
      )}
    >
      <Link
        href={`/recipes/${entry.recipe_id}?date=${entry.date}${
          entry.meal_slot ? `&slot=${entry.meal_slot}` : ""
        }`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <RecipeCover
          url={entry.recipe.hero_image_url}
          className="size-14 shrink-0 rounded-(--radius-sm) border border-(--color-border)"
        />
        <div className="min-w-0">
          <h4 className="break-words font-medium">{entry.recipe.title}</h4>
          <span className="break-words font-mono text-mono text-(--color-text-secondary)">
            {entry.recipe.total_time_minutes !== null
              ? `${entry.recipe.total_time_minutes}m`
              : "—"}
            {" · "}
            {entry.servings_planned} serving{entry.servings_planned === 1 ? "" : "s"}
          </span>
        </div>
      </Link>
      <button
        type="button"
        aria-label={`Remove ${entry.recipe.title}`}
        disabled={busy}
        onClick={() => onRemove(entry.id)}
        className="flex w-8 shrink-0 items-center justify-center text-(--color-text-secondary) transition-colors hover:text-(--color-error) disabled:opacity-50"
      >
        <X className="size-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}

// ── meal_slot: null group — custom-time ("Scheduled") + #Upcoming pins ────────

function ScheduledSection({
  entries,
  busy,
  onRemove,
}: {
  entries: MealPlanEntryOut[];
  busy: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-(--radius-bento) p-2">
      <div className="flex min-w-0 items-center gap-2 px-1">
        <span className="min-w-0 break-words font-mono text-mono uppercase tracking-wider text-(--color-text-secondary)">
          Scheduled
        </span>
      </div>
      {entries.map((e) => (
        <div
          key={e.id}
          className="flex min-w-0 items-center gap-3 rounded-(--radius-bento) border border-dashed border-(--color-border) bg-(--color-surface) p-2"
        >
          <Link
            href={`/recipes/${e.recipe_id}`}
            className="flex min-w-0 flex-1 items-center gap-3"
          >
            <RecipeCover
              url={e.recipe.hero_image_url}
              className="size-10 shrink-0 rounded-(--radius-sm) border border-(--color-border)"
            />
            <div className="min-w-0">
              <h4 className="break-words font-medium">{e.recipe.title}</h4>
              <span className="break-words font-mono text-mono text-(--color-text-secondary)">
                {e.is_upcoming_pin
                  ? "#UPCOMING"
                  : e.scheduled_at
                    ? new Date(e.scheduled_at).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "—"}
              </span>
            </div>
          </Link>
          <button
            type="button"
            aria-label={`Remove ${e.recipe.title}`}
            disabled={busy}
            onClick={() => onRemove(e.id)}
            className="flex w-8 shrink-0 items-center justify-center text-(--color-text-secondary) transition-colors hover:text-(--color-error) disabled:opacity-50"
          >
            <X className="size-4" strokeWidth={1.5} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── whole-day empty state (meal_planner_empty_state mockup, design.md §5) ────

function EmptyDayState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mb-4 flex min-h-[300px] flex-col items-center justify-center rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-8 text-center">
      <div className="mb-5 flex size-24 items-center justify-center rounded-full border border-(--color-border)/50 bg-(--color-surface-container-high)">
        <UtensilsCrossed className="size-9 text-(--color-accent)" strokeWidth={1.5} />
      </div>
      <h4 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
        Your day is looking a bit empty.
      </h4>
      <p className="mb-6 mt-2 max-w-sm text-(--color-text-secondary)">
        Plan a meal or find a new favorite recipe to fill your bento grid.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-2 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-6 py-3 text-[length:var(--text-meta)] font-medium text-white hover:opacity-90"
      >
        <Plus className="size-4" strokeWidth={1.5} />
        Add a Recipe
      </button>
    </div>
  );
}

// ── recipe picker — favorites + searchable library (right panel / sheet) ─────

function RecipePicker({
  scope,
  draggable,
  onPick,
}: {
  scope: string;
  draggable: boolean;
  onPick: (r: RecipeSummary) => void;
}) {
  const [query, setQuery] = useState("");
  const { data: favorites } = useQuery({ queryKey: ["favorites"], queryFn: api.listFavorites });
  // Sidebar list = first page only — the sheet is a picker, not a browser;
  // the full library lives on the Search/Recipes screens.
  const { data: recipesPage } = useQuery({
    queryKey: ["recipes", "browse"],
    queryFn: () => api.listRecipes(1),
  });
  const favoriteIds = useMemo(() => new Set((favorites ?? []).map((r) => r.id)), [favorites]);

  const q = query.trim().toLowerCase();
  const match = (r: RecipeSummary) => !q || r.title.toLowerCase().includes(q);
  const favList = (favorites ?? []).filter(match);
  const rest = (recipesPage?.items ?? []).filter((r) => match(r) && !favoriteIds.has(r.id));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* Search bar — same pattern as the Search screen (design.md §2.4 #2) */}
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute inset-y-0 left-3 my-auto size-5 text-(--color-text-secondary)"
          strokeWidth={1.5}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes..."
          aria-label="Search recipes"
          className="w-full rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) py-2.5 pl-10 pr-4 outline-none transition-colors placeholder:text-(--color-text-secondary) focus:border-(--color-accent)"
        />
      </div>

      <section>
        <h4 className="mb-2 px-1 font-mono text-mono uppercase tracking-widest text-(--color-text-secondary)">
          Saved & Favorited
        </h4>
        {favList.length === 0 ? (
          <p className="px-1 text-[length:var(--text-meta)] text-(--color-text-secondary)">
            Star recipes in the list below to pin them here.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {favList.map((r) => (
              <PickerRow
                key={r.id}
                recipe={r}
                scope={scope}
                draggable={draggable}
                favorited
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 px-1 font-mono text-mono uppercase tracking-widest text-(--color-text-secondary)">
          All Recipes
        </h4>
        {rest.length === 0 ? (
          <p className="px-1 text-[length:var(--text-meta)] text-(--color-text-secondary)">
            {q ? "No recipes match that search." : "No recipes yet — add one first."}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rest.map((r) => (
              <PickerRow
                key={r.id}
                recipe={r}
                scope={scope}
                draggable={draggable}
                favorited={false}
                onPick={onPick}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PickerRow({
  recipe,
  scope,
  draggable,
  favorited,
  onPick,
}: {
  recipe: RecipeSummary;
  scope: string;
  draggable: boolean;
  favorited: boolean;
  onPick: (r: RecipeSummary) => void;
}) {
  const { attributes, listeners, setNodeRef } = useDraggable({
    id: recipeDragId(scope, recipe.id),
    disabled: !draggable,
  });
  const queryClient = useQueryClient();
  const toggleFavorite = useMutation({
    mutationFn: (): Promise<unknown> =>
      favorited ? api.removeFavorite(recipe.id) : api.addFavorite(recipe.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["favorites"] }),
  });
  return (
    <div
      ref={setNodeRef}
      {...(draggable ? { ...attributes, ...listeners } : {})}
      className={cn(
        "flex min-w-0 items-stretch gap-2 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-2 transition-colors hover:bg-(--color-surface-container)",
        draggable && "lg:cursor-grab lg:active:cursor-grabbing",
      )}
    >
      <button
        type="button"
        onClick={() => onPick(recipe)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <RecipeCover
          url={recipe.hero_image_url}
          className="size-10 shrink-0 rounded-(--radius-sm) border border-(--color-border)"
        />
        <span className="min-w-0 flex-1 break-words font-medium">{recipe.title}</span>
      </button>
      <button
        type="button"
        aria-label={favorited ? `Unfavorite ${recipe.title}` : `Favorite ${recipe.title}`}
        title={favorited ? "Remove from favorites" : "Add to favorites"}
        onClick={() => toggleFavorite.mutate()}
        disabled={toggleFavorite.isPending}
        className={cn(
          "flex w-8 shrink-0 items-center justify-center transition-colors disabled:opacity-50",
          favorited
            ? "text-(--color-turmeric)"
            : "text-(--color-text-secondary) hover:text-(--color-turmeric)",
        )}
      >
        <Star
          className="size-4"
          strokeWidth={1.5}
          fill={favorited ? "currentColor" : "none"}
        />
      </button>
    </div>
  );
}

// ── date formatting helpers ─────────────────────────────────────────────────

function dayLabel(iso: string, opts: { weekday?: boolean } = {}) {
  return parseIsoDate(iso).toLocaleDateString(
    "en-US",
    opts.weekday
      ? { weekday: "long", month: "short", day: "numeric" }
      : { month: "short", day: "numeric" },
  );
}

function weekLabel(days: string[]) {
  const from = parseIsoDate(days[0]!);
  const to = parseIsoDate(days[days.length - 1]!);
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(from)} – ${fmt(to)}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
