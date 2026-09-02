"use client";

// Dashboard bento grid — design.md §3.1, visual reference: cookbook ui idea/
// stitch_yhup_communication_portal/dashboard. The "Upcoming Recipe" cell (#2)
// is backed by GET /meal-plans/upcoming (Quick Add "Right now" pins) and
// "Meals planned for the day" (#4) by GET /meal-plans?date= — both route into
// the Recipe Reader scoped to the meal occasion (§4.1), which shows the
// multi-recipe tab strip when a slot has several dishes.
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  CalendarDays,
  ChefHat,
  BookOpen,
  Croissant,
  Plus,
  Sandwich,
  UtensilsCrossed,
  X,
} from "lucide-react";
import { toIsoDate } from "@cookbook/shared";
import { api } from "@/lib/api";
import type { MealPlanEntryOut } from "@cookbook/shared";
import { RecipeCover } from "@/components/cover-picker";
import { GroceryListSummaryCell } from "@/components/grocery-summary-cell";

const SLOTS = [
  { slot: "breakfast", label: "Breakfast", icon: Croissant },
  { slot: "lunch", label: "Lunch", icon: Sandwich },
  { slot: "dinner", label: "Dinner", icon: UtensilsCrossed },
] as const;

export function DashboardGrid() {
  // Today's plan feeds the 3-slot row; tomorrow's feeds the weekly summary —
  // slot quick-adds whose nominal time already passed roll to tomorrow (§7.2).
  const today = toIsoDate(new Date());
  const tomorrow = toIsoDate(new Date(Date.now() + 86_400_000));
  const { data: todayEntries } = useQuery({
    queryKey: ["meal-plans", "day", today],
    queryFn: () => api.getMealsForDate(today),
  });
  const { data: tomorrowEntries } = useQuery({
    queryKey: ["meal-plans", "day", tomorrow],
    queryFn: () => api.getMealsForDate(tomorrow),
  });

  return (
    <div className="grid grid-cols-2 gap-(--spacing-gutter)">
      <UpcomingMealCell />
      <PlannedTodayCells date={today} entries={todayEntries} />
      <WeeklyPlannerCell
        todayCount={todayEntries?.length ?? 0}
        tomorrowCount={tomorrowEntries?.length ?? 0}
      />
      <QuickAddCell />
      <MyRecipesCell />
      <GroceryListSummaryCell />
    </div>
  );
}

// §3.1 #2 — large hero cell: the Quick Add "Right now / #Upcoming" occurrence
// (queried by the pin flag, development.md §3). May be several dishes; the
// reader's tab strip handles that (design.md §4.1). The X un-pins the shown
// dish (DELETE /meal-plans/:id — a pin has no slot or scheduled time, so
// removing the entry IS removing it from "Right now"). With nothing pinned,
// the cell falls back to the top Tier 1 recommendation (development.md §10) —
// framed as "Suggested", never as a planned meal.
function UpcomingMealCell() {
  const queryClient = useQueryClient();
  const { data: upcoming, isLoading } = useQuery({
    queryKey: ["meal-plans", "upcoming"],
    queryFn: api.getUpcomingMeals,
  });

  // Tier 1 fallback — only queried when nothing is pinned (enabled flag).
  const { data: recs, isLoading: recsLoading } = useQuery({
    queryKey: ["recommendations", "internal"],
    queryFn: api.getInternalRecommendations,
    enabled: !isLoading && (upcoming?.length ?? 0) === 0,
  });

  const removePin = useMutation({
    mutationFn: (id: string) => api.deleteMealPlanEntry(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meal-plans"] }),
    onError: () => toast.error("Couldn't remove from upcoming — try again"),
  });

  const first = upcoming?.[0];
  const dishCount = new Set(upcoming?.map((e) => e.recipe_id) ?? []).size;
  const suggestion = recs?.recommendations[0];
  const href = first
    ? `/recipes/${first.recipe.id}?upcoming=1`
    : suggestion
      ? `/recipes/${suggestion.recipe_id}`
      : "/planner";

  if (!isLoading && !first && suggestion) {
    // Recommendation fallback — distinct framing so it never reads as planned.
    return (
      <Link
        href={href}
        className="group col-span-2 flex flex-col overflow-hidden rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) transition-colors hover:border-(--color-accent)"
      >
        <div className="hatch relative h-36 w-full border-b border-(--color-border)">
          {suggestion.hero_image_url && (
            <RecipeCover
              url={suggestion.hero_image_url}
              className="absolute inset-0 h-full w-full"
            />
          )}
          <span className="absolute left-(--spacing-cell) top-(--spacing-cell) rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 font-mono text-mono uppercase">
            Suggested for you
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 p-(--spacing-cell)">
          <div className="min-w-0">
            <h2 className="truncate font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
              {suggestion.title}
            </h2>
            <p className="mt-1 truncate text-[length:var(--text-meta)] text-(--color-text-secondary)">
              {suggestion.reasons[0] ?? "Based on your cookbook"}
            </p>
          </div>
          <ArrowRight
            className="size-5 shrink-0 text-(--color-accent) transition-transform group-hover:translate-x-1"
            strokeWidth={1.5}
          />
        </div>
      </Link>
    );
  }

  if (!isLoading && !first && !recsLoading && !suggestion) {
    return (
      <Link
        href="/planner"
        className="group col-span-2 flex flex-col overflow-hidden rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) transition-colors hover:border-(--color-accent)"
      >
        <div className="hatch relative flex h-44 w-full items-center justify-center border-b border-(--color-border)">
          <div className="flex flex-col items-center gap-1 text-(--color-text-secondary)">
            <ChefHat className="size-8 opacity-60" strokeWidth={1.5} />
            <span className="font-mono text-mono uppercase">Nothing planned yet</span>
          </div>
          <span className="absolute left-(--spacing-cell) top-(--spacing-cell) rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 font-mono text-mono uppercase">
            Upcoming Meal
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 p-(--spacing-cell)">
          <div className="min-w-0">
            <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
              Plan your first meal
            </h2>
            <p className="mt-1 text-[length:var(--text-meta)] text-(--color-text-secondary)">
              Recipes you schedule appear here, ready to cook.
            </p>
          </div>
          <ArrowRight
            className="size-5 shrink-0 text-(--color-accent) transition-transform group-hover:translate-x-1"
            strokeWidth={1.5}
          />
        </div>
      </Link>
    );
  }

  return (
    <div className="relative col-span-2 overflow-hidden rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) transition-colors hover:border-(--color-accent)">
      <Link href={href} className="group flex flex-col">
      <div className="relative h-44 w-full border-b border-(--color-border)">
        {/* hatch skeleton doubles as the loading state (design.md §5) */}
        <RecipeCover
          url={first?.recipe.hero_image_url ?? null}
          className="h-full w-full"
        />
        <span className="absolute left-(--spacing-cell) top-(--spacing-cell) rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 font-mono text-mono uppercase">
          Upcoming Meal
        </span>
        {dishCount > 1 && (
          <span className="absolute right-(--spacing-cell) top-(--spacing-cell) rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 font-mono text-mono uppercase">
            {dishCount} dishes
          </span>
        )}
      </div>
      <div className="flex items-center justify-between gap-4 p-(--spacing-cell)">
        <div className="min-w-0">
          <h2 className="truncate font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
            {first ? first.recipe.title : "…"}
          </h2>
          <p className="mt-1 text-[length:var(--text-meta)] text-(--color-text-secondary)">
            {first
              ? dishCount > 1
                ? `Cooking next — plus ${dishCount - 1} more dish${dishCount === 2 ? "" : "es"}`
                : "Cooking next"
              : "Loading your plan…"}
          </p>
        </div>
        <ArrowRight
          className="size-5 shrink-0 text-(--color-accent) transition-transform group-hover:translate-x-1"
          strokeWidth={1.5}
        />
        </div>
      </Link>
      {/* Remove from upcoming — sits above the link so it doesn't navigate.
          With several dishes this removes the one shown (newest pin). */}
      {first && (
        <button
          type="button"
          aria-label={`Remove ${first.recipe.title} from upcoming`}
          title="Remove from upcoming"
          disabled={removePin.isPending}
          onClick={() => removePin.mutate(first.id)}
          className="absolute bottom-3 right-3 z-10 flex size-8 items-center justify-center rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) transition-colors hover:border-(--color-error) hover:text-(--color-error) disabled:opacity-50"
        >
          <X className="size-4" strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

// §3.1 #4 — row of 3 small square cells (breakfast/lunch/dinner), each opening
// the Reader scoped to that slot (tabbed if several dishes, design.md §4.1).
function PlannedTodayCells({
  date,
  entries,
}: {
  date: string;
  entries: MealPlanEntryOut[] | undefined;
}) {
  return (
    <section className="col-span-2">
      <h3 className="mb-3 px-1 font-semibold">Planned for Today</h3>
      <div className="grid grid-cols-3 gap-(--spacing-gutter)">
        {SLOTS.map(({ slot, label, icon: Icon }) => {
          const dishes = (entries ?? []).filter((e) => e.meal_slot === slot);
          const first = dishes[0];
          return (
            <Link
              key={slot}
              href={
                first ? `/recipes/${first.recipe.id}?date=${date}&slot=${slot}` : "/planner"
              }
              className="group flex flex-col overflow-hidden rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) transition-colors hover:border-(--color-accent)"
            >
              <div className="hatch relative h-24 w-full border-b border-(--color-border)">
                {first && (
                  <RecipeCover
                    url={first.recipe.hero_image_url}
                    className="absolute inset-0 h-full w-full"
                  />
                )}
                {!first && (
                  <div className="flex h-full w-full items-center justify-center">
                    <Icon
                      className="size-8 text-(--color-text-secondary) opacity-50 transition-opacity group-hover:opacity-100"
                      strokeWidth={1.5}
                    />
                  </div>
                )}
                {dishes.length > 1 && (
                  <span className="absolute right-1.5 top-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-1.5 py-0.5 font-mono text-mono">
                    +{dishes.length - 1}
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="font-mono text-mono uppercase text-(--color-text-secondary)">
                  {label}
                </div>
                <div className="mt-0.5 truncate text-(--color-text-secondary)">
                  {entries === undefined ? "…" : first ? first.recipe.title : "—"}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// §3.1 #3 — Meal Planner entry cell, weekly summary flavor (dashboard mockup).
// Full week wiring lands with the Phase 6 planner page; Today/Tomorrow show
// real counts so slot quick-adds that rolled to tomorrow stay visible.
function WeeklyPlannerCell({ todayCount, tomorrowCount }: { todayCount: number; tomorrowCount: number }) {
  const countLabel = (n: number) => (n > 0 ? `${n} MEAL${n === 1 ? "" : "S"}` : "0 MEALS");
  const days = [
    { day: "Today", meals: countLabel(todayCount), active: true },
    { day: "Tomorrow", meals: countLabel(tomorrowCount), active: tomorrowCount > 0 },
    { day: "Wed", meals: "PLAN", active: false },
  ];
  return (
    <div className="flex flex-col rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold">Weekly Planner</h3>
        <CalendarDays className="size-5 text-(--color-text-secondary)" strokeWidth={1.5} />
      </div>
      <div className="flex flex-1 flex-col justify-center gap-3">
        {days.map((d, i) => (
          <div
            key={d.day}
            className={
              "flex items-center justify-between border-b border-(--color-border) pb-2 " +
              (i === days.length - 1 ? "border-b-0 pb-0 " : "") +
              (d.active ? "" : "opacity-60")
            }
          >
            <span className="text-[length:var(--text-meta)] text-(--color-text-secondary)">
              {d.day}
            </span>
            <span
              className={
                "font-mono text-mono " +
                (d.active ? "text-(--color-accent)" : "text-(--color-text-secondary)")
              }
            >
              {d.meals}
            </span>
          </div>
        ))}
      </div>
      <Link
        href="/planner"
        className="mt-4 flex w-full items-center justify-center rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) py-2 text-[length:var(--text-meta)] font-medium transition-colors hover:bg-(--color-surface-container)"
      >
        View Full Schedule
      </Link>
    </div>
  );
}

// Quick Add — dashed cell → /recipes/new (dashboard mockup "Log New Recipe").
function QuickAddCell() {
  return (
    <Link
      href="/recipes/new"
      className="flex items-center justify-center rounded-(--radius-bento) border border-dashed border-(--color-border-strong) bg-(--color-surface-container) p-(--spacing-cell) transition-colors hover:bg-(--color-surface-container-high)"
    >
      <span className="flex items-center gap-2 font-medium">
        <Plus className="size-5" strokeWidth={1.5} /> Log New Recipe
      </span>
    </Link>
  );
}

// Cookbook entry — browse all recipes.
function MyRecipesCell() {
  return (
    <Link
      href="/recipes"
      className="col-span-2 flex min-h-24 flex-col justify-between rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell) transition-colors hover:border-(--color-accent)"
    >
      <div className="flex items-center justify-between">
        <span className="font-[family-name:var(--font-display)] font-semibold">My Recipes</span>
        <BookOpen className="size-4 text-(--color-text-secondary)" strokeWidth={1.5} />
      </div>
      <span className="text-[length:var(--text-meta)] text-(--color-text-secondary)">
        Browse, read and edit your cookbook →
      </span>
    </Link>
  );
}
