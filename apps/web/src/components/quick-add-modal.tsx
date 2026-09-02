"use client";

// Quick Add to Meal modal — design.md §3.4, development.md §7.2. One component
// parameterized by recipe_id, triggered from the Recipe Reader AND Search
// result cells (design.md §4.2). Slot previews come from the shared pure
// resolver so the modal shows exactly what POST /meal-plans/quick-add persists.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CalendarDays,
  Croissant,
  Minus,
  Plus,
  Sandwich,
  Timer,
  UtensilsCrossed,
  X,
  Zap,
} from "lucide-react";
import { resolveQuickAddTarget, type MealSlot } from "@cookbook/shared";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";

const SLOT_OPTIONS: { slot: MealSlot; icon: typeof Croissant }[] = [
  { slot: "breakfast", icon: Croissant },
  { slot: "lunch", icon: Sandwich },
  { slot: "dinner", icon: UtensilsCrossed },
];

export function QuickAddModal({
  recipeId,
  recipeTitle,
  plannerDate,
  onClose,
}: {
  recipeId: string;
  recipeTitle?: string;
  /** Planner context: target day for slot rows (design.md §3.5 sidebar taps). */
  plannerDate?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [minutes, setMinutes] = useState(30);

  const add = useMutation({
    mutationFn: (body: Parameters<typeof api.quickAddMeal>[0]) => api.quickAddMeal(body),
    onSuccess: (_entry, body) => {
      // The label mirrors what the backend resolved (shared pure function).
      const target = resolveQuickAddTarget(body.mode, body);
      queryClient.invalidateQueries({ queryKey: ["meal-plans"] });
      toast.success(`Added "${recipeTitle ?? "recipe"}" — ${target.label}`);
      onClose();
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiRequestError && err.message
          ? `Couldn't add — ${err.message}`
          : "Couldn't add to the meal plan — try again",
      ),
  });

  const addNow = () => add.mutate({ recipe_id: recipeId, mode: "now" });
  const addSlot = (slot: MealSlot) =>
    add.mutate({ recipe_id: recipeId, mode: "slot", slot, ...(plannerDate ? { date: plannerDate } : {}) });
  const addMinutes = () => add.mutate({ recipe_id: recipeId, mode: "custom_minutes", minutes });

  return (
    <div
      className="fixed inset-0 z-20 flex items-end justify-center bg-black/30 p-(--spacing-margin) sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Quick add to meal"
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
              Add to meal
            </h2>
            {recipeTitle && (
              <p className="mt-0.5 truncate text-[length:var(--text-meta)] text-(--color-text-secondary)">
                {recipeTitle}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-(--color-text-secondary)"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-col gap-1.5">
          {/* Right now / #Upcoming — design.md §3.4 */}
          <QuickAddRow
            icon={<Zap className="size-4" strokeWidth={1.5} />}
            label="Right now"
            hint=""
            // preview={resolveQuickAddTarget("now").label}
            preview={""}
            busy={add.isPending}
            onClick={addNow}
          />

          {/* Slot rows — next-occurrence resolution previewed live (§7.2) */}
          {SLOT_OPTIONS.map(({ slot, icon: Icon }) => (
            <QuickAddRow
              key={slot}
              icon={<Icon className="size-4" strokeWidth={1.5} />}
              label={slot.charAt(0).toUpperCase() + slot.slice(1)}
              // preview={resolveQuickAddTarget("slot", {
              //   slot,
              //   ...(plannerDate ? { date: plannerDate } : {}),
              // }).label}
              preview={""}
              busy={add.isPending}
              // busy={add.isPending}
              onClick={() => addSlot(slot)}
            />
          ))}

          {/* In next [X] minutes — ad hoc custom time (design.md §3.4) */}
          <div className="flex items-center gap-3 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-2.5">
            <Timer className="size-4 shrink-0 text-(--color-text-secondary)" strokeWidth={1.5} />
            {/* <span className="flex-1 font-small">In next</span> */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Fewer minutes"
                onClick={() => setMinutes((m) => Math.max(5, m - 5))}
                className="flex size-7 items-center justify-center rounded-(--radius-sm) border border-(--color-border) hover:bg-(--color-surface-container)"
              >
              <Minus className="size-3.5" strokeWidth={1.5} />
              </button>
              <input
                type="number"
                min={5}
                max={1440}
                step={5}
                value={minutes}
                onChange={(e) =>
                  setMinutes(Math.min(24 * 60, Math.max(1, Number(e.target.value) || 1)))
                }
                aria-label="Minutes from now"
                className="w-14 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-2 py-1 text-center font-mono outline-none focus:border-(--color-accent)"
              />
              <button
                type="button"
                aria-label="More minutes"
                onClick={() => setMinutes((m) => Math.min(24 * 60, m + 5))}
                className="flex size-7 items-center justify-center rounded-(--radius-sm) border border-(--color-border) hover:bg-(--color-surface-container)"
              >
                <Plus className="size-3.5" strokeWidth={1.5} />
              </button>
              <span className="w-8 font-mono text-mono text-(--color-text-secondary)">min</span>
            </div>
            <button
              type="button"
              onClick={addMinutes}
              disabled={add.isPending}
              className="ml-auto shrink-0 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-2 py-1.5 text-[length:var(--text-meta)] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="size-3.5" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Open full planner — anything more specific (design.md §3.4) */}
        <button
          type="button"
          onClick={() => {
            onClose();
            router.push("/planner");
          }}
          className="flex items-center justify-center gap-2 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) py-2.5 font-medium text-(--color-text-secondary) hover:border-(--color-accent)"
        >
          <CalendarDays className="size-4" strokeWidth={1.5} />
          Open full planner →
        </button>
      </div>
    </div>
  );
}

function QuickAddRow({
  icon,
  label,
  hint,
  preview,
  busy,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  preview: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "flex items-center gap-3 rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-2.5 text-left",
        "hover:border-(--color-accent) disabled:opacity-50",
      )}
    >
      <span className="shrink-0 text-(--color-text-secondary)">{icon}</span>
      <span className="flex-1">
        <span className="font-medium">{label}</span>
        {hint && (
          <span className="ml-2 font-mono text-mono text-(--color-text-secondary)">{hint}</span>
        )}
      </span>
      {/* <span className="shrink-0 font-mono text-mono text-(--color-text-secondary)">
        adds to: {preview}
      </span> */}
    </button>
  );
}
