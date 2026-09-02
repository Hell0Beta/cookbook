"use client";

// Dashboard "Grocery List" summary cell — design.md §3.1 #5 → full screen (§3.6).
// Styling follows the dashboard mockup: secondary-fixed icon square, category
// count chips, "View List" action.
import { useQuery } from "@tanstack/react-query";
import { ShoppingBasket } from "lucide-react";
import Link from "next/link";
import { api, GROCERY_CATEGORY_LABELS } from "@/lib/api";

export function GroceryListSummaryCell() {
  const { data: list } = useQuery({
    queryKey: ["grocery-list"],
    queryFn: api.getActiveGroceryList,
  });

  const remaining = list?.items.filter((i) => !i.is_purchased) ?? [];
  const remainingByCategory = new Map<string, number>();
  for (const item of remaining) {
    remainingByCategory.set(item.category, (remainingByCategory.get(item.category) ?? 0) + 1);
  }
  const topCategories = [...remainingByCategory.entries()].slice(0, 3);

  return (
    <div className="col-span-2 flex flex-col gap-4 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell) sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-(--radius-sm) bg-(--color-secondary-fixed) text-(--color-on-secondary-fixed)">
          <ShoppingBasket className="size-5" strokeWidth={1.5} />
        </div>
        <div>
          <h3 className="font-semibold">Active Grocery List</h3>
          <p className="text-[length:var(--text-meta)] text-(--color-text-secondary)">
            {list
              ? `${remaining.length} item${remaining.length === 1 ? "" : "s"} left to buy`
              : "Select recipes to build your list"}
          </p>
        </div>
      </div>

      {topCategories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {topCategories.map(([category, count]) => (
            <span
              key={category}
              className="rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface-container) px-2 py-1 font-mono text-mono"
            >
              {GROCERY_CATEGORY_LABELS[category] ?? category} ({count})
            </span>
          ))}
        </div>
      )}

      <Link
        href="/grocery-list"
        className="flex shrink-0 items-center justify-center whitespace-nowrap rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-4 py-2 text-[length:var(--text-meta)] font-medium text-white transition-opacity hover:opacity-90"
      >
        View List
      </Link>
    </div>
  );
}
