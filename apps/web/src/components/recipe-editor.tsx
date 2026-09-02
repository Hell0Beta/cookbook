"use client";

// The unified Recipe Reader/Editor — design.md §3.3/§4.3, development.md §7.1.
// Read and edit render the same block components; there is no separate
// "Edit Recipe" screen, only an edit toggle on this page. Saving is a single
// PUT /recipes/:id/blocks batch (development.md §7.1), triggered on toggle-off.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Pencil, Check, Plus, Trash2, ShoppingBasket, ImagePlus, CalendarPlus, Vibrate } from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import type {
  IngredientBlock,
  MetaBlock,
  NoteBlock,
  RecipeBlock,
  RecipeBlocks,
  StepBlock,
} from "@cookbook/shared";
import { api, ApiRequestError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  BlockShell,
  IngredientBlockView,
  MetaBlockView,
  NoteBlockView,
  StepBlockView,
} from "@/components/blocks/block-views";
import { CoverPickerModal, RecipeCover } from "@/components/cover-picker";
import { QuickAddModal } from "@/components/quick-add-modal";
import { useTimerStore } from "@/components/timer/timer-store";
import { requestMotionPermission, useShakeToAdvance } from "@/components/timer/use-shake-to-advance";

let blockIdCounter = 0;
const newBlockId = () => `local-${Date.now()}-${blockIdCounter++}`;

export function RecipeEditor({
  initial,
  recipeId,
}: {
  initial: RecipeBlocks;
  recipeId?: string; // absent → create mode
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [blocks, setBlocks] = useState<RecipeBlock[]>(initial.blocks);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(initial.hero_image_url);
  const [coverPickerOpen, setCoverPickerOpen] = useState(false);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [editable, setEditable] = useState(!recipeId); // new recipes start in edit mode
  // Shake-to-advance toggle (§3.3.3) — opt-in, remembered per browser.
  const [shakeOn, setShakeOn] = useState(() => {
    try {
      return localStorage.getItem("cookbook:shakeToAdvance") === "on";
    } catch {
      return false;
    }
  });
  const [displayServings, setDisplayServingsState] = useState(() =>
    initial.blocks.find((b): b is MetaBlock => b.type === "meta")?.servings ?? 2,
  );

  const baseServings = useMemo(
    () => blocks.find((b): b is MetaBlock => b.type === "meta")?.servings ?? 2,
    [blocks],
  );

  const saveMutation = useMutation({
    mutationFn: (body: RecipeBlocks) =>
      recipeId ? api.updateRecipeBlocks(recipeId, body) : api.createRecipe(body),
    onSuccess: (saved) => {
      toast.success(recipeId ? "Recipe saved" : "Recipe created");
      // Re-sync from the server response: dropped empty blocks disappear,
      // step numbering is corrected, and row ids refresh.
      setBlocks(saved.blocks);
      setTitle(saved.title);
      setDescription(saved.description ?? "");
      setHeroImageUrl(saved.hero_image_url);
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["recipe", recipeId] });
      if (!recipeId && saved.id) {
        router.replace(`/recipes/${saved.id}`);
      }
    },
    onError: (err) =>
      toast.error(
        err instanceof ApiRequestError && err.message
          ? `Save failed — ${err.message}`
          : "Save failed — check your connection and retry",
      ),
  });

  // "Add to grocery list" from the Reader (design.md §3.6 entry point) —
  // APPENDS to the active list, merging quantities, instead of replacing it.
  const toGroceryMutation = useMutation({
    mutationFn: () =>
      api.createGroceryList([recipeId!], { [recipeId!]: displayServings }, "append"),
    onSuccess: (list) => {
      queryClient.invalidateQueries({ queryKey: ["grocery-list"] });
      toast.success(`Added to grocery list — ${list.items.length} items`, {
        action: { label: "View", onClick: () => router.push("/grocery-list") },
      });
    },
    onError: () => toast.error("Couldn't build the grocery list — try again"),
  });

  const setDisplayServings = (n: number) =>
    setDisplayServingsState((prev) => Math.min(100, Math.max(1, n)));

  const payload = (): RecipeBlocks => ({
    title,
    description: description || null,
    hero_image_url: heroImageUrl,
    blocks,
  });

  const save = () => saveMutation.mutate(payload());

  const toggleEditMode = () => {
    if (editable) {
      // Toggle off → batch-save (development.md §7.1: on save/blur, not per keystroke)
      setEditable(false);
      save();
    } else {
      setEditable(true);
    }
  };

  const pointerSensor = useSensor(PointerSensor, { activationConstraint: { distance: 4 } });
  const keyboardSensor = useSensor(KeyboardSensor);
  const sensors = useSensors(pointerSensor, keyboardSensor);

  // ── block mutations ──────────────────────────────────────────────────────
  const patchBlock = <T extends RecipeBlock>(id: string, patch: Partial<T>) =>
    setBlocks((bs) =>
      bs.map((b) => (b.id === id ? ({ ...b, ...patch } as RecipeBlock) : b)),
    );

  const removeBlock = (id: string) => setBlocks((bs) => bs.filter((b) => b.id !== id));

  const insertBlock = (afterIndex: number, type: Exclude<RecipeBlock["type"], "meta">) => {
    const block: RecipeBlock =
      type === "ingredient"
        ? ({
            id: newBlockId(),
            type: "ingredient",
            quantity: null,
            unit: null,
            raw_text: "",
            ingredient_id: null,
            role_tag: "main",
            swap_suggestions: [],
            sort_order: 0,
          } satisfies IngredientBlock)
        : type === "step"
          ? ({
              id: newBlockId(),
              type: "step",
              step_number: 0, // renumbered on render
              instruction_text: "",
              duration_minutes: null,
              image_url: null,
            } satisfies StepBlock)
          : ({
              id: newBlockId(),
              type: "note",
              text: "",
            } satisfies NoteBlock);
    setBlocks((bs) => [...bs.slice(0, afterIndex + 1), block, ...bs.slice(afterIndex + 1)]);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setBlocks((bs) => {
        const oldIndex = bs.findIndex((b) => b.id === active.id);
        const newIndex = bs.findIndex((b) => b.id === over.id);
        return arrayMove(bs, oldIndex, newIndex);
      });
    }
  };

  // Steps are numbered by their position among steps (order in the stack may
  // mix blocks — ingredient order and step order are each derived by position).
  let stepCounter = 0;
  const numbered = blocks.map((b) =>
    b.type === "step" ? { ...b, step_number: ++stepCounter } : b,
  );

  // Timer pill "return to step" (design.md §3.3.2): /recipes/:id#step-<blockId>
  // scrolls the step into view once the reader mounts.
  useEffect(() => {
    const scrollToHash = () => {
      const hash = window.location.hash;
      if (!hash.startsWith("#step-")) return;
      document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, []);

  // ── shake-to-advance (design.md §3.3.3, development.md §7.4) ──────────────
  // Scoping per §7.4: read (cooking) mode + recipe exists + toggled on; the
  // hook itself ignores events while the tab is backgrounded.

  const advanceStep = () => {
    const steps = numbered.filter((b): b is StepBlock => b.type === "step");
    if (steps.length === 0) return;
    // "Current" = the last step at/above the viewport midpoint, so a shake
    // continues from wherever the reader is scrolled.
    const mid = window.innerHeight / 2;
    let currentIdx = -1;
    steps.forEach((s, i) => {
      const el = document.getElementById(`step-${s.id}`);
      if (el && el.getBoundingClientRect().top <= mid) currentIdx = i;
    });
    if (currentIdx === steps.length - 1) {
      toast.info("That's the last step");
      return;
    }
    const next = steps[currentIdx + 1]!;
    document
      .getElementById(`step-${next.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
    // Auto-start the step's timer unless one already lives for it (§3.3.3).
    if (
      recipeId &&
      next.duration_minutes &&
      next.duration_minutes > 0 &&
      !useTimerStore.getState().get(next.id)
    ) {
      useTimerStore.getState().start({
        stepId: next.id,
        recipeId,
        recipeTitle: title,
        stepNumber: next.step_number,
        snippet: next.instruction_text.slice(0, 60),
        totalSeconds: next.duration_minutes * 60,
      });
    }
  };

  useShakeToAdvance(advanceStep, shakeOn && !editable && !!recipeId);

  const setShake = (on: boolean) => {
    setShakeOn(on);
    try {
      localStorage.setItem("cookbook:shakeToAdvance", on ? "on" : "off");
    } catch {
      // private mode — the toggle still works for this session
    }
  };

  const toggleShake = async () => {
    if (shakeOn) {
      setShake(false);
      return;
    }
    // iOS gates devicemotion behind a permission prompt that must run inside
    // this click gesture (development.md §7.4).
    const motion = await requestMotionPermission();
    if (motion === "unsupported") {
      // Browsers hide the motion APIs on insecure origins (plain-http LAN
      // access) — no prompt ever appears, so say that instead of "blocked".
      toast.error("Motion sensors need a secure connection — open the app on localhost or via HTTPS to use shake to advance");
      return;
    }
    if (motion === "denied") {
      toast.error("Motion access was denied — shake to advance stays off");
      return;
    }
    setShake(true);
    toast.success(
      window.isSecureContext
        ? "Shake to advance is on"
        : "Shake to advance is on — if shakes don't register, this browser blocks motion sensors on plain HTTP",
    );
  };

  return (
    <div className="mx-auto max-w-2xl px-(--spacing-margin) pb-24 pt-(--spacing-margin)">
      {/* Edit toggle — the only mode switch, no separate edit screen (§3.3).
          Read mode also carries the grocery-list (§3.6) and quick-add-to-meal
          (§3.4) affordances. */}
      <div className="mb-4 flex items-center justify-end gap-2">
        {recipeId && !editable && (
          <>
            {/* Shake-to-advance toggle (§3.3.3) — turmeric when armed. */}
            <button
              type="button"
              onClick={() => void toggleShake()}
              aria-pressed={shakeOn}
              aria-label={shakeOn ? "Turn off shake to advance" : "Turn on shake to advance"}
              title={shakeOn ? "Shake to advance: on" : "Shake to advance: off"}
              className={cn(
                "flex items-center gap-1.5 rounded-(--radius-sm) border px-3 py-1.5 font-medium transition-colors",
                shakeOn
                  ? "border-(--color-turmeric) bg-(--color-turmeric)/20 text-(--color-turmeric)"
                  : "border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) hover:border-(--color-secondary) hover:text-(--color-secondary)",
              )}
            >
              <Vibrate className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              aria-label="Add this recipe to a meal"
              className="flex items-center gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 font-medium text-(--color-text-secondary) hover:border-(--color-secondary) hover:text-(--color-secondary)"
            >
            <CalendarPlus className="size-4" />
              {/* Plan */}
            </button>
            <button
              type="button"
              onClick={() => toGroceryMutation.mutate()}
              disabled={toGroceryMutation.isPending}
              aria-label="Generate grocery list for this recipe"
              className="flex items-center gap-1.5 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 font-medium text-(--color-text-secondary) hover:border-(--color-secondary) hover:text-(--color-secondary) disabled:opacity-50"
            >
              <ShoppingBasket className="size-4" />
              {toGroceryMutation.isPending ? "" : ""}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={toggleEditMode}
          disabled={saveMutation.isPending}
          className={cn(
            "flex items-center gap-1.5 rounded-(--radius-sm) border px-3 py-1.5 font-medium",
            editable
              ? "border-(--color-secondary) bg-(--color-secondary) text-white"
              : "border-(--color-border) bg-(--color-surface) text-(--color-text-primary)",
          )}
        >
          {editable ? <Check className="size-4" /> : <Pencil className="size-4" />}
          {editable ? "Done" : ""}
        </button>
      </div>

      {/* Cover image block — gallery / camera / icon-library picker
          (design.md §3.3 cover block, §5 hatch placeholder). */}
      {editable ? (
        <button
          type="button"
          aria-label={heroImageUrl ? "Change cover image" : "Add cover image"}
          onClick={() => setCoverPickerOpen(true)}
          className="group mb-4 block w-full"
        >
          {heroImageUrl ? (
            <RecipeCover
              url={heroImageUrl}
              className="aspect-video w-full rounded-(--radius-bento) border border-(--color-border)"
            />
          ) : (
            <div className="flex aspect-video w-full items-center justify-center rounded-(--radius-bento) border border-dashed border-(--color-border-strong) bg-(--color-surface)">
              <span className="flex items-center gap-1.5 font-mono text-mono uppercase tracking-wide text-(--color-text-secondary)/70 group-hover:text-(--color-accent-deep)">
                <ImagePlus className="size-4" strokeWidth={1.5} /> Add cover
              </span>
            </div>
          )}
        </button>
      ) : (
        heroImageUrl && (
          <RecipeCover url={heroImageUrl} className="mb-4 aspect-video w-full rounded-(--radius-bento)" />
        )
      )}
      {coverPickerOpen && (
        <CoverPickerModal
          currentUrl={heroImageUrl}
          onSelect={setHeroImageUrl}
          onClose={() => setCoverPickerOpen(false)}
        />
      )}
      {quickAddOpen && recipeId && (
        <QuickAddModal
          recipeId={recipeId}
          recipeTitle={title}
          onClose={() => setQuickAddOpen(false)}
        />
      )}

      {/* Title block */}
      <input
        aria-label="Recipe title"
        value={title}
        readOnly={!editable}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Recipe title"
        className="w-full bg-transparent font-[family-name:var(--font-display)] text-[length:var(--text-display)] font-bold outline-none placeholder:text-(--color-border-strong)/50 rounded-(--radius-sm) focus:bg-(--color-surface-container) focus:px-1 -mx-1"
      />
      {editable && (
        <input
          aria-label="Short description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Short description (optional)"
          className="mt-1 w-full bg-transparent text-(--color-text-secondary) outline-none placeholder:text-(--color-border-strong)/50"
        />
      )}

      {/* Block stack */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={numbered.map((b) => b.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="mt-4 flex flex-col">
            {numbered.map((block, i) => (
              <SortableBlock
                key={block.id}
                block={block}
                editable={editable}
                baseServings={baseServings}
                displayServings={displayServings}
                recipeId={recipeId}
                recipeTitle={title}
                onPatch={patchBlock}
                onRemove={() => removeBlock(block.id)}
                onInsertAfter={(type) => insertBlock(i, type)}
                onDisplayServingsChange={setDisplayServings}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {editable && (
        <div className="mt-6 flex gap-2">
          <InsertButton label="Ingredient" onClick={() => insertBlock(blocks.length - 1, "ingredient")} />
          <InsertButton label="Step" onClick={() => insertBlock(blocks.length - 1, "step")} />
          <InsertButton label="Note" onClick={() => insertBlock(blocks.length - 1, "note")} />
        </div>
      )}

      {recipeId && !editable && (
        <DeleteButton
          onClick={async () => {
            if (!confirm("Delete this recipe?")) return;
            await api.deleteRecipe(recipeId);
            queryClient.invalidateQueries({ queryKey: ["recipes"] });
            router.push("/recipes");
          }}
        />
      )}
    </div>
  );
}

// ── per-block wrapper wiring dnd-kit + the "+" inserter (design.md §3.3) ─────

function SortableBlock({
  block,
  editable,
  baseServings,
  displayServings,
  recipeId,
  recipeTitle,
  onPatch,
  onRemove,
  onInsertAfter,
  onDisplayServingsChange,
}: {
  block: RecipeBlock;
  editable: boolean;
  baseServings: number;
  displayServings: number;
  recipeId?: string;
  recipeTitle?: string;
  onPatch: (id: string, patch: Partial<RecipeBlock>) => void;
  onRemove: () => void;
  onInsertAfter: (type: Exclude<RecipeBlock["type"], "meta">) => void;
  onDisplayServingsChange: (servings: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
    disabled: !editable || block.type === "meta",
  });

  return (
    <div
      ref={setNodeRef}
      id={block.type === "step" ? `step-${block.id}` : undefined}
      style={{ transform: transform ? `translateY(${transform.y}px)` : undefined, transition }}
      className={cn(isDragging && "z-10 opacity-60")}
    >
      <BlockShell
        editable={editable && block.type !== "meta"}
        handleProps={{ ...attributes, ...listeners } as React.HTMLAttributes<HTMLButtonElement>}
        onRemove={onRemove}
      >
        {block.type === "meta" ? (
          <MetaBlockView
            block={block}
            editable={editable}
            baseServings={baseServings}
            displayServings={displayServings}
            onPatch={(p) => onPatch(block.id, p)}
            onDisplayServingsChange={onDisplayServingsChange}
          />
        ) : block.type === "ingredient" ? (
          <IngredientBlockView
            block={block}
            editable={editable}
            baseServings={baseServings}
            displayServings={displayServings}
            onPatch={(p) => onPatch(block.id, p)}
          />
        ) : block.type === "step" ? (
          <StepBlockView
            block={block}
            editable={editable}
            recipeId={recipeId}
            recipeTitle={recipeTitle}
            onPatch={(p) => onPatch(block.id, p)}
          />
        ) : (
          <NoteBlockView block={block} editable={editable} onPatch={(p) => onPatch(block.id, p)} />
        )}
      </BlockShell>

      {/* "+" inserter between blocks, Notion-style (design.md §3.3) */}
      {editable && (
        <div className="group relative h-4">
          <button
            type="button"
            aria-label="Insert block"
            onClick={() => {
              const type = block.type === "meta" ? "ingredient" : block.type;
              onInsertAfter(type as Exclude<RecipeBlock["type"], "meta">);
            }}
            className="absolute left-0 top-0 flex size-4 items-center justify-center rounded-(--radius-sm) text-(--color-text-secondary) opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function InsertButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-3 py-1.5 text-[length:var(--text-meta)] font-medium text-(--color-text-secondary) hover:border-(--color-accent)"
    >
      <Plus className="size-3.5" /> {label}
    </button>
  );
}

function DeleteButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-8 flex items-center gap-1.5 rounded-(--radius-sm) border border-(--color-error)/40 px-3 py-1.5 text-[length:var(--text-meta)] font-medium text-(--color-error) hover:bg-(--color-error)/5"
    >
      <Trash2 className="size-3.5" /> Delete recipe
    </button>
  );
}
