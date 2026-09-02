"use client";

// Recipe Reader — design.md §3.3/§4.1. When opened scoped to a meal occasion
// (?date=&slot= or ?upcoming=1), it loads every dish sharing that occasion and
// renders the multi-recipe tab strip (§3.3.1): one recipe's block stack at a
// time, a timer dot on tabs whose recipe has a timer running in the background.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { X } from "lucide-react";
import type { MealPlanEntryOut } from "@cookbook/shared";
import { api, type MealSlotParam } from "@/lib/api";
import { RecipeEditor } from "@/components/recipe-editor";
import { useTimerStore } from "@/components/timer/timer-store";
import { cn } from "@/lib/utils";

export type MealOccasion =
  | { kind: "slot"; date: string; slot: string }
  | { kind: "upcoming" };

export function RecipeReaderPage({
  recipeId,
  occasion,
}: {
  recipeId: string;
  occasion: MealOccasion | null;
}) {
  // All dishes attached to the occasion, if the reader was opened scoped to one.
  // Key is null-safe: a null occasion must NOT reuse the "upcoming" cache entry,
  // or its dish list leaks into plain /recipes/:id views.
  const occasionQuery = useQuery({
    queryKey: [
      "meal-plans",
      occasion?.kind ?? "none",
      occasion?.kind === "slot" ? occasion.date : undefined,
      occasion?.kind === "slot" ? occasion.slot : undefined,
    ],
    queryFn: () =>
      occasion!.kind === "slot"
        ? api.getMealsForSlot(occasion!.date, occasion!.slot as MealSlotParam)
        : api.getUpcomingMeals(),
    enabled: occasion !== null,
  });

  // One tab per distinct recipe (multiple rows can share a recipe — one dish).
  const tabs = useMemo(() => {
    const seen = new Map<string, MealPlanEntryOut["recipe"]>();
    for (const entry of occasionQuery.data ?? []) {
      if (!seen.has(entry.recipe_id)) seen.set(entry.recipe_id, entry.recipe);
    }
    return [...seen.values()];
  }, [occasionQuery.data]);

  const [activeId, setActiveId] = useState(recipeId);
  // Follow the URL: /recipes/a → /recipes/b reuses this component without
  // remounting (same dynamic segment), so activeId must re-sync to the new
  // recipe — defaulting to the occasion's first dish when the URL's recipe
  // isn't part of it.
  useEffect(() => {
    setActiveId(
      tabs.length > 0 && !tabs.some((t) => t.id === recipeId) ? tabs[0]!.id : recipeId,
    );
  }, [tabs, recipeId]);

  const activeRecipeId = tabs.some((t) => t.id === activeId) ? activeId : recipeId;

  const { data, isLoading, error } = useQuery({
    queryKey: ["recipe", activeRecipeId],
    queryFn: () => api.getRecipe(activeRecipeId),
  });

  // Cooking-mode open signal (development.md §10): opening the reader scoped
  // to a meal occasion is "actually cooking this" — one CookedEvent per dish
  // opened (tab switches count: that dish is being cooked too), feeding Tier
  // 1's recency ranking. Fire-and-forget; failures never surface.
  useEffect(() => {
    if (occasion && occasionQuery.data) {
      void api.markCooked(activeRecipeId).catch(() => undefined);
    }
  }, [occasion, occasionQuery.data, activeRecipeId]);

  // Remove the active dish from the occasion (DELETE the entry). On the last
  // dish the tabs vanish and the reader becomes a plain recipe view; upcoming
  // pins have no slot/time, so deleting the entry is the un-pin.
  const queryClient = useQueryClient();
  const removeFromOccasion = useMutation({
    mutationFn: () => {
      const mine = (occasionQuery.data ?? []).filter((e) => e.recipe_id === activeRecipeId);
      const entry = mine[0];
      if (!entry) throw new Error("not in this occasion");
      return api.deleteMealPlanEntry(entry.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meal-plans"] });
      toast.success("Removed from the meal");
    },
    onError: () => toast.error("Couldn't remove from the meal — try again"),
  });

  return (
    <div>
      {/* Tab strip under the app bar — only when the occasion has multiple
          dishes; single-dish meals hide it entirely (design.md §3.3.1). */}
      {occasion && tabs.length > 1 && (
        <MealTabs
          tabs={tabs.map((t) => ({ id: t.id, title: t.title }))}
          activeId={activeRecipeId}
          onSelect={setActiveId}
        />
      )}
      {occasion && (occasionQuery.data?.length ?? 0) > 0 && (
        <div className="mx-auto flex max-w-2xl justify-end px-(--spacing-margin) pt-3">
          <button
            type="button"
            onClick={() => removeFromOccasion.mutate()}
            disabled={removeFromOccasion.isPending}
            className="flex items-center gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-[length:var(--text-meta)] font-medium text-(--color-text-secondary) transition-colors hover:border-(--color-error) hover:text-(--color-error) disabled:opacity-50"
          >
            <X className="size-3.5" strokeWidth={1.5} />
            {occasion.kind === "upcoming" ? "Remove from upcoming" : "Remove from this meal"}
          </button>
        </div>
      )}
      {isLoading && <p className="p-4 text-(--color-text-secondary)">Loading…</p>}
      {error && (
        <p className="p-4 text-(--color-error)">
          Couldn&apos;t load this recipe — it may not exist, or you&apos;re not signed in.
        </p>
      )}
      {data && (
        // Keyed by recipe so switching tabs swaps the whole block stack and
        // resets the editor to the new dish (design.md §3.3.1).
        <RecipeEditor key={activeRecipeId} initial={data} recipeId={activeRecipeId} />
      )}
    </div>
  );
}

function MealTabs({
  tabs,
  activeId,
  onSelect,
}: {
  tabs: { id: string; title: string }[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const timers = useTimerStore((s) => s.timers);
  return (
    <nav
      aria-label="Dishes in this meal"
      className="no-scrollbar sticky top-16 z-10 overflow-x-auto border-b border-(--color-border) bg-(--color-page)/95 backdrop-blur"
    >
      <div className="mx-auto flex min-w-max max-w-2xl items-center gap-1 px-(--spacing-margin) py-2">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const timerRunning = timers.some(
            (t) => t.recipeId === tab.id && t.running && !t.completed,
          );
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 rounded-(--radius-sm) border px-3 py-1.5 text-[length:var(--text-meta)] font-medium transition-colors",
                active
                  ? "border-(--color-accent) bg-(--color-accent) text-white"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) hover:bg-(--color-surface-container)",
              )}
            >
              <span className="max-w-40 truncate">{tab.title}</span>
              {/* Background-timer indicator dot on the other tabs (§3.3.1) */}
              {timerRunning && !active && (
                <span
                  aria-label="Timer running"
                  title="A timer is running for this dish"
                  className="size-2 shrink-0 rounded-full bg-(--color-turmeric)"
                />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
