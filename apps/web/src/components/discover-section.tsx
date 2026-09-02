"use client";

// Discover — Tier 2 suggestions as a DISTINCT dashboard section
// (development.md §10: "surface as a distinct 'Discover' section rather than
// mixing into core dashboard results"; design.md §3.1/§5). Since the local
// dataset switch, every suggestion IS a full recipe — cards link straight
// to the reader (no expansion, no LLM, works offline).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ChevronDown, Sparkles, UtensilsCrossed } from "lucide-react";
import type { DiscoverSuggestionOut } from "@cookbook/shared";
import { api, apiAsset } from "@/lib/api";

// Quota-consuming path historically (LLM refresh); the dataset selector
// costs nothing now, but the cadence + staleTime stay — a re-open within the
// window reuses cache instead of re-querying. A remount inside that window
// reuses the cache too.
const DISCOVER_STALE_MS = 5 * 60_000;

// Collapsed by default — the accordion remembers the last choice so a user
// who wants Discover on their dashboard keeps it, everyone else gets the
// leaner dashboard.
const DISCOVER_OPEN_KEY = "discover-open";

function readStoredOpen(): boolean {
  try {
    return localStorage.getItem(DISCOVER_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function DiscoverSection() {
  const [open, setOpen] = useState(readStoredOpen);

  const { data, isLoading } = useQuery({
    queryKey: ["discover"],
    queryFn: api.getDiscover,
    staleTime: DISCOVER_STALE_MS,
    // Collapsed = not asked for — the fetch waits for an explicit expand.
    enabled: open,
  });

  const toggleOpen = () => {
    setOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(DISCOVER_OPEN_KEY, next ? "1" : "0");
      } catch {
        // preference just isn't remembered — the toggle still works
      }
      return next;
    });
  };

  const suggestions = data?.suggestions ?? [];

  return (
    <section className="mt-6" aria-label="Discover">
      <button
        type="button"
        onClick={toggleOpen}
        aria-expanded={open}
        className="mb-3 flex w-full items-center justify-between gap-2 rounded-(--radius-bento) px-1 py-1 text-left transition-colors hover:text-(--color-accent-deep)"
      >
        <h2 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
          <Sparkles className="size-4 text-(--color-accent)" strokeWidth={1.5} />
          Discover
        </h2>
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-mono text-mono uppercase text-(--color-text-secondary)">
            {data?.refreshed_at
              ? `Updated ${new Date(data.refreshed_at).toLocaleDateString()}`
              : "Fresh ideas daily"}
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-(--color-text-secondary) transition-transform duration-200${open ? " rotate-180" : ""}`}
            strokeWidth={1.5}
          />
        </span>
      </button>

      {open && (
        <>
          {isLoading ? (
            // hatch skeleton (design.md §5)
            <div className="grid grid-cols-2 gap-(--spacing-gutter)">
              <div className="hatch h-44 rounded-(--radius-bento) border border-(--color-border)" />
              <div className="hatch h-44 rounded-(--radius-bento) border border-(--color-border)" />
            </div>
          ) : suggestions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 rounded-(--radius-bento) border border-dashed border-(--color-border-strong) bg-(--color-surface-container) px-4 py-8 text-center">
              <Sparkles className="size-6 text-(--color-text-secondary) opacity-60" strokeWidth={1.5} />
              <p className="font-medium">No Discover ideas yet</p>
              <p className="text-[length:var(--text-meta)] text-(--color-text-secondary)">
                New suggestions appear here every day. Set your diet preferences in
                Profile for more personalized ideas.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-(--spacing-gutter)">
              {suggestions.map((s) => (
                <DiscoverCard key={s.id} suggestion={s} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// One bento cell per suggestion — image-first, whole card links to the
// recipe (the suggestion IS a dataset recipe since the LLM switch-off).
function DiscoverCard({ suggestion }: { suggestion: DiscoverSuggestionOut }) {
  return (
    <Link
      href={suggestion.recipe_id ? `/recipes/${suggestion.recipe_id}` : "/search"}
      className="flex flex-col overflow-hidden rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) transition-colors hover:border-(--color-accent)"
    >
      <div className="relative aspect-[4/3] border-b border-(--color-border) bg-(--color-surface-container)">
        {suggestion.image_url ? (
          // apiAsset: /images/... lives on the API origin — a raw path would
          // 404 against the web origin.
          // eslint-disable-next-line @next/next/no-img-element -- local API-served file, not a remote host
          <img
            src={apiAsset(suggestion.image_url)}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          // Dataset rows always carry an image, but a missing file degrades
          // to this quiet placeholder.
          <div className="flex size-full items-center justify-center">
            <UtensilsCrossed
              className="size-8 text-(--color-text-secondary) opacity-40"
              strokeWidth={1.5}
            />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 font-[family-name:var(--font-display)] text-[length:var(--text-body)] font-semibold leading-snug">
          {suggestion.title}
        </h3>
        <p className="line-clamp-1 text-[length:var(--text-meta)] italic text-(--color-text-secondary)">
          {suggestion.why_recommended}
        </p>
      </div>
    </Link>
  );
}
