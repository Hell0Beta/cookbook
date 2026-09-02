"use client";

// Import entry on the create flow — design.md §3.3, development.md §4.
// TheMealDB search → tap a result → imported and opened in the unified editor
// for review/edits. Rule-based; nothing here touches the LLM, so the daily
// quota banner can never block importing.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Loader2, Search as SearchIcon } from "lucide-react";
import { api, ApiRequestError } from "@/lib/api";
import { quotaAwareOnError } from "@/components/llm-quota";
import { BentoCell } from "@/components/bento";

export function ImportPanel() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const search = useQuery({
    queryKey: ["import-search", query],
    queryFn: () => api.searchPublicApi(query),
    enabled: query.trim().length >= 2,
  });

  const importMutation = useMutation({
    mutationFn: (providerRecipeId: string) => api.importPublicApi(providerRecipeId),
    onSuccess: (recipe) => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      toast.success(`Imported "${recipe.title}"`);
      router.push(`/recipes/${recipe.id}`); // review/edits in the editor
    },
    onError: (err) => {
      quotaAwareOnError(err);
      toast.error(
        err instanceof ApiRequestError && err.message
          ? `Import failed — ${err.message}`
          : "Import failed — check your connection and retry",
      );
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(input.trim());
  };

  return (
    <BentoCell className="mb-4">
      <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h3)] font-semibold">
        Import a recipe
      </h2>
      <p className="mt-0.5 text-[length:var(--text-meta)] text-(--color-text-secondary)">
        Search TheMealDB&apos;s free library — imported recipes open here for review.
      </p>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. arrabiata, chicken curry…"
          aria-label="Search recipes to import"
          className="min-w-0 flex-1 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-2 outline-none placeholder:text-(--color-border-strong)/50 focus:border-(--color-accent)"
        />
        <button
          type="submit"
          disabled={input.trim().length < 2 || search.isFetching}
          className="flex shrink-0 items-center gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-2 font-medium hover:border-(--color-accent) disabled:opacity-50"
        >
          {search.isFetching ? (
            <Loader2 className="size-4 animate-spin" strokeWidth={1.5} />
          ) : (
            <SearchIcon className="size-4" strokeWidth={1.5} />
          )}
          Search
        </button>
      </form>

      {query.trim().length >= 2 && (
        <div className="mt-3">
          {search.isFetching && (
            <p className="flex items-center gap-2 py-2 font-mono text-mono text-(--color-text-secondary)">
              <Loader2 className="size-3.5 animate-spin" strokeWidth={1.5} /> Searching…
            </p>
          )}
          {search.isError && (
            <p className="py-2 text-[length:var(--text-meta)] text-(--color-error)">
              Couldn&apos;t reach TheMealDB — check your connection and retry.
            </p>
          )}
          {search.data && search.data.length === 0 && (
            <p className="py-2 font-mono text-mono text-(--color-text-secondary)">
              No matches for “{query}”. Try another dish or ingredient.
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {(search.data ?? []).map((r) => (
              <li key={r.provider_recipe_id}>
                <button
                  type="button"
                  disabled={importMutation.isPending}
                  onClick={() => importMutation.mutate(r.provider_recipe_id)}
                  className="flex w-full items-center gap-3 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) p-2 text-left transition-colors hover:border-(--color-accent) disabled:opacity-50"
                >
                  {r.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.thumbnail_url}
                      alt=""
                      className="size-12 shrink-0 rounded-(--radius-sm) border border-(--color-border) object-cover"
                    />
                  ) : (
                    <div className="hatch size-12 shrink-0 rounded-(--radius-sm) border border-(--color-border)" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="block font-mono text-mono uppercase tracking-wide text-(--color-text-secondary)">
                      {[r.category, r.area].filter(Boolean).join(" · ") || "meal"}
                    </span>
                  </span>
                  {importMutation.isPending && importMutation.variables === r.provider_recipe_id ? (
                    <Loader2 className="size-4 shrink-0 animate-spin text-(--color-accent-deep)" strokeWidth={1.5} />
                  ) : (
                    <Download className="size-4 shrink-0 text-(--color-accent-deep)" strokeWidth={1.5} />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </BentoCell>
  );
}
