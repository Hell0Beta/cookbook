"use client";

// "Ingredients I have" input — design.md §4.7 / development.md §9 step 2.
// Free-text entry with autocomplete against the Ingredient master table
// (GET /ingredients?q=); picked ingredients become removable chips that drive
// the ingredient-ranked result list.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Apple, X } from "lucide-react";
import type { IngredientOption } from "@cookbook/shared";
import { api, GROCERY_CATEGORY_LABELS } from "@/lib/api";
import { cn } from "@/lib/utils";

export function IngredientHavePicker({
  selected,
  onChange,
}: {
  selected: IngredientOption[];
  onChange: (next: IngredientOption[]) => void;
}) {
  const [input, setInput] = useState("");
  const trimmed = input.trim();

  const { data: options, isFetching } = useQuery({
    queryKey: ["ingredients", "autocomplete", trimmed],
    queryFn: () => api.autocompleteIngredients(trimmed),
    enabled: trimmed.length > 0,
  });
  const suggestions = (options ?? []).filter(
    (o) => !selected.some((s) => s.id === o.id),
  );

  const pick = (option: IngredientOption) => {
    onChange([...selected, option]);
    setInput("");
  };

  return (
    <div className="relative mb-6">
      <div className="rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-3">
        <div className="flex items-center gap-2">
          <Apple className="size-5 shrink-0 text-(--color-text-secondary)" strokeWidth={1.5} />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && suggestions.length > 0) {
                e.preventDefault();
                pick(suggestions[0]!);
              }
            }}
            placeholder="Add an ingredient you have…"
            aria-label="Ingredient you have"
            className="w-full bg-transparent outline-none placeholder:text-(--color-text-secondary)"
          />
          {isFetching && (
            <span className="font-mono text-mono text-(--color-text-secondary)">…</span>
          )}
        </div>

        {selected.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {selected.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-label={`Remove ${s.canonical_name}`}
                onClick={() => onChange(selected.filter((x) => x.id !== s.id))}
                className="flex items-center gap-1 rounded-(--radius-bento) border border-(--color-accent) bg-(--color-surface-container) px-2.5 py-1 text-[length:var(--text-meta)] font-medium"
              >
                {s.canonical_name}
                <X className="size-3" strokeWidth={2} />
              </button>
            ))}
          </div>
        )}
      </div>

      {trimmed.length > 0 && suggestions.length > 0 && (
        <ul
          role="listbox"
          aria-label="Ingredient suggestions"
          className="absolute inset-x-0 top-full z-10 mt-1 max-h-60 overflow-y-auto rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) py-1"
        >
          {suggestions.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => pick(o)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-(--color-surface-container)"
              >
                <span>{o.canonical_name}</span>
                <span className="font-mono text-mono text-(--color-text-secondary)">
                  {GROCERY_CATEGORY_LABELS[o.category] ?? o.category}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
