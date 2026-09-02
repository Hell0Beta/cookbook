"use client";

// Diet Preferences form — design.md §3.7, development.md §3/§10. Feeds the
// Tier 1 recommendation filter (allergies/exclusions hard-filter, diet types
// and cuisines score/rank). Schemas from @cookbook/shared; the API normalizes
// allergies against KNOWN_ALLERGENS on save, so round-tripping shows the
// canonical names.
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import {
  CUISINE_OPTIONS,
  DIET_TYPE_LABELS,
  KNOWN_ALLERGENS,
  type DietProfileOut,
  type DietType,
} from "@cookbook/shared";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";

const DIET_TYPES = Object.keys(DIET_TYPE_LABELS) as DietType[];

const EMPTY_PROFILE: DietProfileOut = {
  diet_types: [],
  allergies: [],
  excluded_ingredients: [],
  preferred_cuisines: [],
};

export function DietProfileForm() {
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: api.meWithProfile,
  });

  const [dietTypes, setDietTypes] = useState<DietType[]>([]);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [excludedDraft, setExcludedDraft] = useState("");

  // Load the saved profile once it arrives (not on every render — the user's
  // in-progress edits must survive query refetches).
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (me && loadedFor.current !== me.id) {
      loadedFor.current = me.id;
      const p = me.diet_profile ?? EMPTY_PROFILE;
      setDietTypes(p.diet_types.filter((d): d is DietType => d in DIET_TYPE_LABELS));
      setAllergies(p.allergies);
      setExcluded(p.excluded_ingredients);
      setCuisines(p.preferred_cuisines);
    }
  }, [me]);

  const save = useMutation({
    mutationFn: () =>
      api.putDietProfile({
        diet_types: dietTypes,
        allergies,
        excluded_ingredients: excluded,
        preferred_cuisines: cuisines,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["me"] });
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      toast.success("Diet preferences saved");
    },
    onError: (err) =>
      toast.error(err instanceof ApiRequestError ? err.message : "Couldn't save — try again"),
  });

  const toggle = <T,>(list: T[], value: T, set: (v: T[]) => void) => {
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  };

  const addExcluded = () => {
    const value = excludedDraft.trim().toLowerCase();
    if (!value) return;
    if (!excluded.includes(value)) setExcluded([...excluded, value]);
    setExcludedDraft("");
  };

  if (isLoading) return <p className="text-(--color-text-secondary)">…</p>;

  const isDirty =
    JSON.stringify([dietTypes, allergies, excluded, cuisines]) !==
    JSON.stringify([
      me?.diet_profile?.diet_types ?? [],
      me?.diet_profile?.allergies ?? [],
      me?.diet_profile?.excluded_ingredients ?? [],
      me?.diet_profile?.preferred_cuisines ?? [],
    ]);

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Section title="Diet types" hint="Filters what the recommendation engine suggests">
        <div className="flex flex-wrap gap-2">
          {DIET_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              aria-pressed={dietTypes.includes(type)}
              onClick={() => toggle(dietTypes, type, setDietTypes)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[length:var(--text-meta)] font-medium transition-colors",
                dietTypes.includes(type)
                  ? "border-(--color-accent) bg-(--color-accent)/15 text-(--color-accent)"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) hover:border-(--color-accent)",
              )}
            >
              {DIET_TYPE_LABELS[type]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Allergies" hint="Recipes containing these are never recommended">
        <div className="flex flex-wrap gap-2">
          {KNOWN_ALLERGENS.map((allergen) => (
            <button
              key={allergen}
              type="button"
              aria-pressed={allergies.includes(allergen)}
              onClick={() => toggle(allergies, allergen, setAllergies)}
              className={cn(
                "flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-[length:var(--text-meta)] font-medium capitalize transition-colors",
                allergies.includes(allergen)
                  ? "border-(--color-error) bg-(--color-error)/10 text-(--color-error)"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) hover:border-(--color-error)",
              )}
            >
              {allergies.includes(allergen) && <Check className="size-3.5" strokeWidth={2} />}
              {allergen}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Disliked / excluded ingredients" hint="Free text — matched against recipe ingredient lines">
        <div className="flex flex-wrap gap-2">
          {excluded.map((item) => (
            <span
              key={item}
              className="flex items-center gap-1 rounded-full border border-(--color-border) bg-(--color-surface-container) px-3 py-1.5 text-[length:var(--text-meta)] text-(--color-text-secondary)"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                onClick={() => setExcluded(excluded.filter((v) => v !== item))}
                className="text-(--color-text-secondary) transition-colors hover:text-(--color-error)"
              >
                <X className="size-3.5" strokeWidth={2} />
              </button>
            </span>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={excludedDraft}
            onChange={(e) => setExcludedDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addExcluded();
              }
            }}
            placeholder="e.g. cilantro, olives…"
            aria-label="Add an excluded ingredient"
            className="min-w-0 flex-1 rounded-(--radius-sm) border border-(--color-border) bg-(--color-bg) px-3 py-2 text-[length:var(--text-body)] outline-none focus:border-(--color-accent)"
          />
          <button
            type="button"
            onClick={addExcluded}
            aria-label="Add excluded ingredient"
            className="flex items-center gap-1 rounded-(--radius-sm) border border-(--color-border) px-3 py-2 text-[length:var(--text-meta)] font-medium hover:border-(--color-accent)"
          >
            <Plus className="size-4" strokeWidth={1.5} /> Add
          </button>
        </div>
      </Section>

      <Section title="Preferred cuisines" hint="Boosts matching recipes in your recommendations">
        <div className="flex flex-wrap gap-2">
          {CUISINE_OPTIONS.map((cuisine) => (
            <button
              key={cuisine}
              type="button"
              aria-pressed={cuisines.includes(cuisine)}
              onClick={() => toggle(cuisines, cuisine, setCuisines)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[length:var(--text-meta)] font-medium transition-colors",
                cuisines.includes(cuisine)
                  ? "border-(--color-accent) bg-(--color-accent)/15 text-(--color-accent)"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) hover:border-(--color-accent)",
              )}
            >
              {cuisine}
            </button>
          ))}
        </div>
      </Section>

      <div className="sticky bottom-20 flex justify-end">
        <button
          type="submit"
          disabled={save.isPending || !isDirty}
          className="rounded-(--radius-sm) bg-(--color-accent) px-5 py-2.5 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {save.isPending ? "Saving…" : "Save preferences"}
        </button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)">
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-0.5 mb-3 text-[length:var(--text-meta)] text-(--color-text-secondary)">{hint}</p>
      {children}
    </section>
  );
}
