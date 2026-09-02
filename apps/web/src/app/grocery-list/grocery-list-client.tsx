"use client";

// Grocery List body — design.md §3.6: bento cell per category group, checkbox
// per item, manual add field. Empty state per design.md §5. Items are
// draggable between category cells — the rule-based category (§6.4) is a
// default, the user's drop wins and persists to the Ingredient master row.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, GripVertical, Plus, X } from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CATEGORY_ORDER } from "@cookbook/shared";
import { UNIT_OPTIONS } from "@/components/blocks/block-views";
import { api, GROCERY_CATEGORY_LABELS, type GroceryList } from "@/lib/api";
import { BentoCell } from "@/components/bento";
import { cn } from "@/lib/utils";

const itemDragId = (id: string) => `item:${id}`;
const catDropId = (category: string) => `cat:${category}`;

export function GroceryListClient() {
  const queryClient = useQueryClient();
  const { data: list, isLoading, error } = useQuery({
    queryKey: ["grocery-list"],
    queryFn: api.getActiveGroceryList,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["grocery-list"] });

  if (isLoading) return <p className="text-(--color-text-secondary)">Loading…</p>;
  if (error) {
    return (
      <p className="rounded-(--radius-sm) border border-(--color-error) p-3 text-(--color-error)">
        Couldn&apos;t load your grocery list — is the API running?
      </p>
    );
  }
  if (!list) {
    // Empty state (design.md §5)
    return (
      <BentoCell span="2x1" className="items-start gap-2">
        <p className="font-[family-name:var(--font-display)] font-semibold">No grocery list yet</p>
        <p className="text-(--color-text-secondary)">Select recipes to build your list.</p>
        <Link
          href="/recipes"
          className="mt-2 flex items-center gap-1.5 rounded-(--radius-sm) border border-(--color-accent) px-3 py-1.5 text-[length:var(--text-meta)] font-medium text-(--color-accent-deep) hover:bg-(--color-surface-container)"
        >
          Go to recipes →
        </Link>
      </BentoCell>
    );
  }

  const remaining = list.items.filter((i) => !i.is_purchased).length;
  return (
    <div className="flex flex-col gap-(--spacing-gutter)">
      <p className="text-[length:var(--text-meta)] text-(--color-text-secondary) font-[family-name:var(--font-mono)]">
        {list.name} · {remaining} of {list.items.length} left to buy · drag an item to fix its category
      </p>
      <CategoryGroups list={list} onMutated={invalidate} />
      <ManualAddField listId={list.id} onAdded={invalidate} />
    </div>
  );
}

// ── category groups (§3.6: "bento cells per category group") ────────────────
// All eight categories render — empty ones as dashed drop targets — so any
// item can always be dragged into any category.

function CategoryGroups({ list, onMutated }: { list: GroceryList; onMutated: () => void }) {
  const groups = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: list.items.filter((i) => i.category === category),
    }));
  }, [list.items]);

  const move = useMutation({
    mutationFn: ({ itemId, category }: { itemId: string; category: string }) =>
      api.patchGroceryItem(list.id, itemId, { category }),
    onSuccess: onMutated,
    onError: () => toast.error("Couldn't move that item — try again"),
  });
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragStart = (e: DragStartEvent) => {
    const item = list.items.find((i) => itemDragId(i.id) === String(e.active.id));
    setActiveLabel(item?.label ?? null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveLabel(null);
    if (!e.over) return;
    const itemId = String(e.active.id).slice(itemDragId("").length);
    const category = String(e.over.id).slice(catDropId("").length);
    const item = list.items.find((i) => i.id === itemId);
    if (!item || item.category === category) return;
    move.mutate({ itemId, category });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveLabel(null)}
    >
      {groups.map(({ category, items }) => (
        <CategoryCell key={category} category={category} items={items} listId={list.id} onMutated={onMutated} />
      ))}
      <DragOverlay>
        {activeLabel !== null && (
          <div className="rounded-(--radius-sm) border border-(--color-accent) bg-(--color-surface) px-3 py-1.5 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] opacity-90">
            {activeLabel}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function CategoryCell({
  category,
  items,
  listId,
  onMutated,
}: {
  category: string;
  items: GroceryList["items"];
  listId: string;
  onMutated: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: catDropId(category) });
  const label = GROCERY_CATEGORY_LABELS[category] ?? category;

  if (items.length === 0) {
    // Dashed drop target — keeps every category reachable as a drop zone.
    return (
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-16 items-center justify-between gap-2 rounded-(--radius-bento) border border-dashed px-(--spacing-cell) py-3 transition-colors",
          isOver ? "border-(--color-accent) bg-(--color-surface-container)" : "border-(--color-border)",
        )}
      >
        <span className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold text-(--color-text-secondary)">
          {label}
        </span>
        <span className="font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] uppercase tracking-widest text-(--color-border-strong)">
          drop items here
        </span>
      </div>
    );
  }

  return (
    <BentoCell
      span="2x1"
      className={cn("gap-2 transition-colors", isOver && "border-(--color-accent) bg-(--color-surface-container)")}
    >
      <div ref={setNodeRef} className="flex min-w-0 flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
            {label}
          </h2>
          <span className="text-[length:var(--text-meta)] text-(--color-text-secondary) font-[family-name:var(--font-mono)]">
            {items.filter((i) => i.is_purchased).length}/{items.length}
          </span>
        </div>
        <ul className="flex flex-col">
          {items.map((item) => (
            <GroceryItemRow key={item.id} listId={listId} item={item} onMutated={onMutated} />
          ))}
        </ul>
      </div>
    </BentoCell>
  );
}

function GroceryItemRow({
  listId,
  item,
  onMutated,
}: {
  listId: string;
  item: GroceryList["items"][number];
  onMutated: () => void;
}) {
  const toggle = useMutation({
    mutationFn: () => api.patchGroceryItem(listId, item.id, { is_purchased: !item.is_purchased }),
    onSuccess: onMutated,
  });
  const remove = useMutation({
    mutationFn: () => api.deleteGroceryItem(listId, item.id),
    onSuccess: onMutated,
    onError: () => toast.error(`Couldn't remove ${item.label} — try again`),
  });
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: itemDragId(item.id) });

  return (
    <li
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-3 border-b border-(--color-border)/40 py-1.5 last:border-b-0",
        isDragging && "opacity-40",
      )}
    >
      {/* Drag handle, not the whole row: touch needs `touch-action: none` for
          dnd-kit to see the gesture, but the row must stay scrollable — so
          only the handle opts out of the browser's scroll claim. */}
      <button
        type="button"
        aria-label={`Drag ${item.label} to another category`}
        title="Drag to another category"
        {...attributes}
        {...listeners}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-(--radius-sm) text-(--color-border-strong) active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" strokeWidth={1.5} />
      </button>

      <button
        type="button"
        aria-label={item.is_purchased ? `Mark ${item.label} as not purchased` : `Mark ${item.label} as purchased`}
        aria-pressed={item.is_purchased}
        onClick={() => toggle.mutate()}
        disabled={toggle.isPending}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-(--radius-sm) border",
          item.is_purchased
            ? "border-(--color-secondary) bg-(--color-secondary) text-white"
            : "border-(--color-border-strong) hover:border-(--color-secondary)",
        )}
      >
        {item.is_purchased && <Check className="size-3.5" />}
      </button>

      <span
        className={cn(
          "min-w-0 flex-1",
          item.is_purchased && "text-(--color-text-secondary) line-through",
        )}
      >
        {item.label}
        {item.recipe_count > 1 && (
          <span className="ml-1.5 text-[length:var(--text-meta)] text-(--color-text-secondary)">
            (from {item.recipe_count} recipes)
          </span>
        )}
      </span>

      {item.display && (
        <span className="shrink-0 text-right font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] text-(--color-text-secondary)">
          {item.approximate && "~"}
          {item.display}
          {item.unit && item.unit !== "piece" && item.unit !== "to_taste" && ` ${item.unit}`}
        </span>
      )}

      <button
        type="button"
        aria-label={`Remove ${item.label} from list`}
        title="Remove from list"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
        className="flex size-6 shrink-0 items-center justify-center rounded-(--radius-sm) text-(--color-border-strong) transition-colors hover:text-(--color-error) disabled:opacity-50"
      >
        <X className="size-3.5" strokeWidth={1.5} />
      </button>
    </li>
  );
}

// ── manual add field (§3.6) ──────────────────────────────────────────────────

function ManualAddField({ listId, onAdded }: { listId: string; onAdded: () => void }) {
  const [label, setLabel] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");

  const add = useMutation({
    mutationFn: () =>
      api.addGroceryItem(listId, {
        label: label.trim(),
        quantity: quantity === "" ? null : Number(quantity),
        unit: unit || null,
      }),
    onSuccess: () => {
      setLabel("");
      setQuantity("");
      setUnit("");
      onAdded();
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (label.trim()) add.mutate();
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2 rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)"
    >
      <input
        aria-label="Add item"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Add an item…"
        className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-(--color-border-strong)/50"
      />
      <input
        aria-label="Quantity"
        type="number"
        step="any"
        min={0}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        placeholder="—"
        className="w-14 rounded-(--radius-sm) border border-(--color-border) bg-transparent px-1 text-right font-[family-name:var(--font-mono)] text-[length:var(--text-meta)]"
      />
      <select
        aria-label="Unit"
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        className="rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-1 py-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)]"
      >
        <option value="">—</option>
        {UNIT_OPTIONS.map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!label.trim() || add.isPending}
        aria-label="Add item to grocery list"
        className="flex items-center gap-1 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) px-2.5 py-1.5 text-[length:var(--text-meta)] font-medium text-white disabled:opacity-40"
      >
        <Plus className="size-3.5" /> Add
      </button>
    </form>
  );
}
