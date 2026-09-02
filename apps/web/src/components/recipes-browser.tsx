"use client";

// Recipe List Item — design.md §2.4 #6: 1x1-wide bento cell, thumbnail (left)
// + title/meta (right). Selection mode (design.md §3.6) turns taps into
// multi-select for "Generate Grocery List" with per-recipe servings overrides.
// Paginated "load more" (infinite query) since the dataset import.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useInfiniteQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import Link from "next/link";
import { Plus, Clock, Users, CheckCheck, X, Minus, ShoppingBasket, LoaderCircle } from "lucide-react";
import { api, type RecipeSummary, type RecipeSearchPage } from "@/lib/api";
import { BentoCell } from "@/components/bento";
import { RecipeCover } from "@/components/cover-picker";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 24;

export function RecipesBrowser() {
  const {
    data,
    isLoading,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["recipes", "browse"],
    queryFn: ({ pageParam }) => api.listRecipes(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last: RecipeSearchPage) =>
      last.has_more ? last.page + 1 : undefined,
  });

  const recipes = (data?.pages ?? []).flatMap((p) => p.items);

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Map<string, number>>(new Map()); // id → servings
  const [showGenerateModal, setShowGenerateModal] = useState(false);

  const toggleSelect = (r: RecipeSummary) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.set(r.id, r.base_servings);
      return next;
    });
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelected(new Map());
  };

  return (
    <div className="flex flex-col gap-(--spacing-gutter) pb-24">
      <div className="flex gap-(--spacing-gutter)">
        <Link
          href="/recipes/new"
          className="flex flex-1 items-center justify-center gap-2 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-4 py-2.5 font-medium text-white hover:opacity-90"
        >
          <Plus className="size-4" /> New recipe
        </Link>
        <button
          type="button"
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          className={cn(
            "flex items-center justify-center gap-2 rounded-(--radius-sm) border px-4 py-2.5 font-medium",
            selectMode
              ? "border-(--color-secondary) bg-(--color-secondary) text-white"
              : "border-(--color-border) bg-(--color-surface) text-(--color-text-primary)",
          )}
        >
          <CheckCheck className="size-4" />
          {selectMode ? "Cancel" : "Select"}
        </button>
      </div>

      {isLoading && <p className="text-(--color-text-secondary)">Loading…</p>}
      {error && (
        <p className="rounded-(--radius-sm) border border-(--color-error) p-3 text-(--color-error)">
          Couldn&apos;t load recipes — is the API running?
        </p>
      )}

      {recipes.length === 0 && !isLoading && (
        <p className="text-(--color-text-secondary)">
          Nothing here yet — create your first recipe.
        </p>
      )}

      <div className="flex flex-col gap-(--spacing-gutter)">
        {recipes.map((r) =>
          selectMode ? (
            <SelectableRecipeCard
              key={r.id}
              recipe={r}
              selected={selected.has(r.id)}
              onToggle={() => toggleSelect(r)}
            />
          ) : (
            <Link key={r.id} href={`/recipes/${r.id}`}>
              <RecipeCard recipe={r} />
            </Link>
          ),
        )}
        {hasNextPage && (
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="flex items-center justify-center gap-2 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) px-4 py-3 text-[length:var(--text-meta)] font-medium transition-colors hover:border-(--color-accent) disabled:opacity-60"
          >
            {isFetchingNextPage ? (
              <>
                <LoaderCircle className="size-4 animate-spin" strokeWidth={1.5} />
                Loading…
              </>
            ) : (
              `Load more (${recipes.length} of ${data?.pages[0]?.total ?? recipes.length})`
            )}
          </button>
        )}
      </div>

      {/* Selection action bar — design.md §3.6 "Generate Grocery List" entry */}
      {selectMode && (
        <div className="fixed inset-x-(--spacing-margin) bottom-20 z-10 mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-3 shadow-sm">
          <span className="text-[length:var(--text-meta)] text-(--color-text-secondary) font-[family-name:var(--font-mono)]">
            {selected.size} selected
          </span>
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => setShowGenerateModal(true)}
            className="flex items-center gap-1.5 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-3 py-1.5 font-medium text-white disabled:opacity-40"
          >
            <ShoppingBasket className="size-4" /> Generate Grocery List
          </button>
        </div>
      )}

      {showGenerateModal && recipes.length > 0 && (
        <GenerateGroceryModal
          recipes={recipes.filter((r) => selected.has(r.id))}
          servingsByRecipe={selected}
          onServingsChange={(id, servings) =>
            setSelected((prev) => new Map(prev).set(id, servings))
          }
          onClose={() => setShowGenerateModal(false)}
          onDone={exitSelectMode}
        />
      )}
    </div>
  );
}

function RecipeCard({ recipe: r }: { recipe: RecipeSummary }) {
  return (
    <BentoCell span="2x1" className="flex-row gap-(--spacing-cell)">
      <RecipeCardThumb recipe={r} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate font-[family-name:var(--font-display)] font-semibold">
          {r.title}
        </h2>
        <div className="mt-1 flex items-center gap-3 font-mono text-mono text-(--color-text-secondary)">
          <span className="flex items-center gap-1">
            <Users className="size-3.5" strokeWidth={1.5} /> {r.base_servings}
          </span>
          {r.total_time_minutes !== null && (
            <span className="flex items-center gap-1">
              <Clock className="size-3.5" strokeWidth={1.5} /> {r.total_time_minutes}m
            </span>
          )}
        </div>
      </div>
    </BentoCell>
  );
}

function SelectableRecipeCard({
  recipe: r,
  selected,
  onToggle,
}: {
  recipe: RecipeSummary;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" onClick={onToggle} className="text-left" aria-pressed={selected}>
      <BentoCell
        span="2x1"
        className={cn(
          "flex-row gap-(--spacing-cell)",
          selected && "border-(--color-accent) bg-(--color-surface-container)",
        )}
      >
        <div className="relative shrink-0">
          <RecipeCardThumb recipe={r} />
          <span
            className={cn(
              "absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-(--radius-sm) border bg-(--color-surface)",
              selected
                ? "border-(--color-accent) bg-(--color-accent) text-white"
                : "border-(--color-border-strong)",
            )}
          >
            {selected && <CheckCheck className="size-3" />}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-[family-name:var(--font-display)] font-semibold">
            {r.title}
          </h2>
          <div className="mt-1 flex items-center gap-3 font-mono text-mono text-(--color-text-secondary)">
            <span className="flex items-center gap-1">
              <Users className="size-3.5" strokeWidth={1.5} /> {r.base_servings}
            </span>
            {r.total_time_minutes !== null && (
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" strokeWidth={1.5} /> {r.total_time_minutes}m
              </span>
            )}
          </div>
        </div>
      </BentoCell>
    </button>
  );
}

function RecipeCardThumb({ recipe: r }: { recipe: RecipeSummary }) {
  return (
    <RecipeCover
      url={r.hero_image_url}
      className="size-20 shrink-0 rounded-(--radius-sm) border border-(--color-border)"
    />
  );
}

// ── generate modal — per-recipe servings overrides (POST /grocery-lists) ────

function GenerateGroceryModal({
  recipes,
  servingsByRecipe,
  onServingsChange,
  onClose,
  onDone,
}: {
  recipes: RecipeSummary[];
  servingsByRecipe: Map<string, number>;
  onServingsChange: (id: string, servings: number) => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();

  const generate = useMutation({
    mutationFn: () =>
      api.createGroceryList(
        recipes.map((r) => r.id),
        Object.fromEntries(recipes.map((r) => [r.id, servingsByRecipe.get(r.id) ?? r.base_servings])),
      ),
    onSuccess: (list) => {
      toast.success(`Grocery list created — ${list.items.length} items`);
      onDone();
      router.push("/grocery-list");
    },
    onError: () => toast.error("Couldn't generate the grocery list — try again"),
  });

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 p-(--spacing-margin) sm:items-center"
      onClick={onClose}
    >
      {/* Bottom-sheet card, reduced-radius bento treatment (design.md §3.4 modal style) */}
      <div
        className="w-full max-w-md rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
            Servings to shop for
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-(--color-text-secondary)"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="mb-4 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {recipes.map((r) => {
            const servings = servingsByRecipe.get(r.id) ?? r.base_servings;
            return (
              <li
                key={r.id}
                className="flex items-center justify-between gap-3 rounded-(--radius-sm) border border-(--color-border) px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate">{r.title}</span>
                <span className="flex shrink-0 items-center rounded-(--radius-sm) border border-(--color-border) font-[family-name:var(--font-mono)] text-[length:var(--text-meta)]">
                  <button
                    type="button"
                    aria-label={`Fewer servings for ${r.title}`}
                    onClick={() => onServingsChange(r.id, Math.max(1, servings - 1))}
                    className="px-2 py-0.5 hover:text-(--color-accent-deep)"
                  >
                    <Minus className="size-3" />
                  </button>
                  <span className="min-w-6 text-center">{servings}</span>
                  <button
                    type="button"
                    aria-label={`More servings for ${r.title}`}
                    onClick={() => onServingsChange(r.id, Math.min(100, servings + 1))}
                    className="px-2 py-0.5 hover:text-(--color-accent-deep)"
                  >
                    <Plus className="size-3" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          disabled={generate.isPending}
          onClick={() => generate.mutate()}
          className="flex w-full items-center justify-center gap-2 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-4 py-2.5 font-medium text-white disabled:opacity-50"
        >
          <ShoppingBasket className="size-4" />
          {generate.isPending ? "Generating…" : "Generate Grocery List"}
        </button>
      </div>
    </div>
  );
}
