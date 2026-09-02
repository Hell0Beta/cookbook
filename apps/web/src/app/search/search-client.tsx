"use client";

// Search screen — design.md §3.2: search input + filter chip row (+ opens the
// Filter Tag Panel, §2.4 #4/§4.6) + "Ingredients I have" mode (§4.7) + result
// list ranked by ingredient match score (development.md §9). All filtering
// runs server-side via GET /recipes?tags=&q=&ingredients=.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Apple,
  CalendarPlus,
  Clock,
  LoaderCircle,
  Plus,
  Search as SearchIcon,
  ShoppingBasket,
  Users,
  X,
} from "lucide-react";
import type { IngredientOption, RecipeSearchResult, TagNode } from "@cookbook/shared";
import { api, ApiRequestError, type RecipeSearchPage } from "@/lib/api";
import { RecipeCover } from "@/components/cover-picker";
import { QuickAddModal } from "@/components/quick-add-modal";
import { FilterTagPanel } from "@/components/filter-tag-panel";
import { IngredientHavePicker } from "@/components/ingredient-have-picker";
import { cn } from "@/lib/utils";

export function SearchClient() {
  const [query, setQuery] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [ingredientMode, setIngredientMode] = useState(false);
  const [haveIngredients, setHaveIngredients] = useState<IngredientOption[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: tagNodes } = useQuery({ queryKey: ["tags"], queryFn: api.getTags });

  const ingredientIds = useMemo(() => haveIngredients.map((i) => i.id), [haveIngredients]);
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["recipes", "search", debouncedQ, selectedTagIds, ingredientIds],
    queryFn: ({ pageParam }) =>
      api.searchRecipes({
        q: debouncedQ || undefined,
        tags: selectedTagIds,
        ingredients: ingredientIds,
        page: pageParam,
      }),
    initialPageParam: 1,
    getNextPageParam: (last: RecipeSearchPage) =>
      last.has_more ? last.page + 1 : undefined,
    placeholderData: (prev) => prev,
  });
  const results = (data?.pages ?? []).flatMap((p) => p.items);

  const tagLabelById = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (nodes: TagNode[]) => {
      for (const n of nodes) {
        map.set(n.id, n.label);
        walk(n.children);
      }
    };
    walk(tagNodes ?? []);
    return map;
  }, [tagNodes]);

  const toggleTag = (id: string) =>
    setSelectedTagIds((ids) =>
      ids.includes(id) ? ids.filter((t) => t !== id) : [...ids, id],
    );

  const scoring = ingredientIds.length > 0;
  const filtering = debouncedQ !== "" || selectedTagIds.length > 0 || scoring;

  return (
    <div>
      {/* Search bar — design.md §2.4 #2 */}
      <div className="relative mb-4">
        <SearchIcon
          className="pointer-events-none absolute inset-y-0 left-3 my-auto size-5 text-(--color-text-secondary)"
          strokeWidth={1.5}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes, ingredients..."
          aria-label="Search recipes"
          className="w-full rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) py-3 pl-10 pr-4 outline-none transition-colors placeholder:text-(--color-text-secondary) focus:border-(--color-accent)"
        />
      </div>

      {/* Filter chip row — design.md §2.4 #3: `+` opens the Filter Tag Panel,
          followed by horizontally scrollable active chips. */}
      <div className="no-scrollbar mb-4 overflow-x-auto">
        <div className="flex min-w-max items-center gap-2 pb-2">
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label="Open filter tag panel"
            title="Select filter tags"
            className="flex size-9 shrink-0 items-center justify-center rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) text-(--color-text-primary) transition-colors hover:border-(--color-accent)"
          >
            <Plus className="size-4" strokeWidth={1.5} />
          </button>
          <button
            type="button"
            aria-pressed={ingredientMode}
            onClick={() => setIngredientMode((m) => !m)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-(--radius-bento) border px-3 py-1.5 text-[length:var(--text-meta)] font-medium transition-colors",
              ingredientMode || scoring
                ? "border-(--color-accent) bg-(--color-accent) text-white"
                : "border-(--color-border) bg-(--color-surface) hover:bg-(--color-surface-container)",
            )}
          >
            <Apple className="size-3.5" strokeWidth={1.5} />
            Ingredients I have
            {scoring && (
              <span className="font-mono text-mono">{haveIngredients.length}</span>
            )}
          </button>
          {selectedTagIds.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => toggleTag(id)}
              aria-label={`Remove ${tagLabelById.get(id) ?? "filter"} filter`}
              className="flex shrink-0 items-center gap-1 rounded-(--radius-bento) border border-(--color-accent) bg-(--color-surface-container) px-3 py-1.5 text-[length:var(--text-meta)] font-medium"
            >
              {tagLabelById.get(id) ?? "Tag"}
              <X className="size-3" strokeWidth={2} />
            </button>
          ))}
        </div>
      </div>

      {/* "Ingredients I have" mode — design.md §4.7 */}
      {ingredientMode && (
        <IngredientHavePicker selected={haveIngredients} onChange={setHaveIngredients} />
      )}

      {/* Result list — design.md §3.2 #4, ranked by match score (§4.7) */}
      {isLoading && <p className="text-(--color-text-secondary)">Loading…</p>}

      {results && results.length === 0 && !isLoading && (
        <div className="rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell) text-center">
          <p className="font-medium">No recipes found</p>
          <p className="mt-1 text-[length:var(--text-meta)] text-(--color-text-secondary)">
            {scoring
              ? "Nothing matches those ingredients yet — add a few more you have on hand."
              : filtering
                ? "Try a different search or fewer filters."
                : <>
                    Try a different search, or{" "}
                    <Link href="/recipes/new" className="text-(--color-accent-deep) underline">
                      log a new recipe
                    </Link>
                    .
                  </>}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {results.map((r) => (
          <SearchResultItem key={r.id} recipe={r} />
        ))}
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
              `Load more (${results.length} of ${data?.pages[0]?.total ?? results.length})`
            )}
          </button>
        )}
        {results.length > 0 && !hasNextPage && (
          <p className="py-6 text-center text-[length:var(--text-meta)] text-(--color-text-secondary)">
            {data?.pages[0]?.total ?? results.length} result
            {(data?.pages[0]?.total ?? results.length) === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {panelOpen && (
        <FilterTagPanel
          nodes={tagNodes ?? []}
          selectedIds={new Set(selectedTagIds)}
          onToggle={toggleTag}
          onClear={() => setSelectedTagIds([])}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}

// Recipe List Item — design.md §2.4 #6: thumbnail (left) + title/meta (right),
// quick-add-to-meal affordance on the cell (§3.2 #4, §4.2), and — when the
// ingredient search is active — the §4.7 match score + missing-ingredients
// line whose "Buy N missing items" CTA upsells into the grocery list
// (development.md §9 step 4).
function SearchResultItem({
  recipe: r,
}: {
  recipe: RecipeSearchResult;
}) {
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const queryClient = useQueryClient();

  const addToGrocery = useMutation({
    mutationFn: () => api.createGroceryList([r.id], {}, "append"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grocery-list"] });
      toast.success(`Added "${r.title}" to your grocery list`);
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiRequestError && err.message
          ? `Couldn't build grocery list — ${err.message}`
          : "Couldn't build grocery list — try again",
      ),
  });

  const missing = r.missing_ingredients ?? [];
  const matchLine =
    r.match_score !== undefined
      ? `${r.matched_main}/${r.total_main} main · ${Math.round(r.match_score * 100)}%`
      : null;

  return (
    <div className="flex items-stretch gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Link
          href={`/recipes/${r.id}`}
          className="group flex min-w-0 flex-1 items-center gap-4 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-3 transition-colors hover:bg-(--color-surface-container)"
        >
          <RecipeCover
            url={r.hero_image_url}
            className="size-16 shrink-0 rounded-(--radius-sm) border border-(--color-border)"
          />
          <div className="min-w-0 flex-1">
            <h3 className="truncate transition-colors group-hover:text-(--color-accent-deep)">
              {r.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-mono text-(--color-text-secondary)">
              <span className="flex items-center gap-1">
                <Clock className="size-3.5" strokeWidth={1.5} />
                {r.total_time_minutes !== null ? `${r.total_time_minutes}m` : "—"}
              </span>
              <span className="flex items-center gap-1">
                <Users className="size-3.5" strokeWidth={1.5} />
                {r.base_servings}
              </span>
              {matchLine && (
                <span className="text-(--color-accent-deep)">{matchLine}</span>
              )}
            </div>
          </div>
        </Link>
        {matchLine && missing.length > 0 && (
          <div className="flex items-center gap-3 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) px-3 py-2">
            <p
              className="min-w-0 flex-1 truncate text-[length:var(--text-meta)] text-(--color-text-secondary)"
              title={missing.map((m) => m.name).join(", ")}
            >
              Missing: {missing.map((m) => m.name).join(", ")}
            </p>
            <button
              type="button"
              onClick={() => addToGrocery.mutate()}
              disabled={addToGrocery.isPending}
              className="flex shrink-0 items-center gap-1.5 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-2.5 py-1.5 text-[length:var(--text-meta)] font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              <ShoppingBasket className="size-3.5" strokeWidth={1.5} />
              Buy {missing.length} missing item{missing.length === 1 ? "" : "s"} to make this
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setQuickAddOpen(true)}
        aria-label={`Add ${r.title} to a meal`}
        title="Add to meal"
        className="flex w-11 shrink-0 items-center justify-center rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) transition-colors hover:border-(--color-accent) hover:text-(--color-accent)"
      >
        <CalendarPlus className="size-5" strokeWidth={1.5} />
      </button>
      {quickAddOpen && (
        <QuickAddModal recipeId={r.id} recipeTitle={r.title} onClose={() => setQuickAddOpen(false)} />
      )}
    </div>
  );
}
