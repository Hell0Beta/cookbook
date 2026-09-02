"use client";

// Block components — design.md §3.3, development.md §7.1.
// ONE component per block type, rendering both `readonly` and `editable`
// states. The same DOM structure and typography is used in both modes so
// toggling edit causes no layout shift (design.md §4.3): inputs are borderless
// and inherit the exact text styles; chrome appears only in edit mode.

import { useLayoutEffect, useRef } from "react";
import { Minus, Plus, GripVertical, Trash2, Timer, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimerStore } from "@/components/timer/timer-store";
import {
  scaleQuantity,
  type IngredientBlock as IngredientBlockT,
  type MetaBlock as MetaBlockT,
  type NoteBlock as NoteBlockT,
  type StepBlock as StepBlockT,
  type Unit,
} from "@cookbook/shared";

// Read-mode quantity column: "1½", "2 cups", "to taste", or "" for none.
function formatIngredientQuantity(
  block: IngredientBlockT,
  scaled: { display: string; approximate: boolean } | null,
): string {
  if (block.quantity === null) {
    return block.unit === "to_taste" || block.unit === "pinch" ? block.unit.replace("_", " ") : "";
  }
  const unitSuffix =
    block.unit && block.unit !== "to_taste" && block.unit !== "pinch" ? ` ${block.unit}` : "";
  if (scaled) return `${scaled.approximate ? "~" : ""}${scaled.display}${unitSuffix}`;
  return `${block.quantity}${unitSuffix}`;
}

// ── shared bits ───────────────────────────────────────────────────────────────

export const UNIT_OPTIONS: Unit[] = [
  "g", "kg", "ml", "l", "tsp", "tbsp", "cup", "oz", "lb", "piece", "pinch", "to_taste",
];

/**
 * Borderless input that visually matches the surrounding text exactly.
 * `readOnly` renders wrapped plain text (never a scrolling single-line input);
 * `multiline` is a textarea that auto-grows to fit wrapped content.
 */
function InlineInput({
  value,
  onChange,
  className,
  ariaLabel,
  multiline,
  placeholder,
  readOnly,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  ariaLabel: string;
  multiline?: boolean;
  placeholder?: string;
  readOnly?: boolean;
}) {
  const shared = cn(
    "w-full bg-transparent outline-none placeholder:text-(--color-border-strong)/50",
    "rounded-(--radius-sm) focus:bg-(--color-surface-container) focus:px-1 -mx-1",
    className,
  );
  if (readOnly) {
    return (
      <div className={cn(shared, "whitespace-pre-wrap break-words")}>{value}</div>
    );
  }
  if (multiline) {
    return (
      <AutoTextarea
        ariaLabel={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        className={cn(shared, "resize-none overflow-hidden")}
      />
    );
  }
  return (
    <input
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={shared}
    />
  );
}

/** Textarea whose height always fits its wrapped content (no inner scrollbar). */
function AutoTextarea({
  value,
  onChange,
  className,
  ariaLabel,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  ariaLabel: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // re-fit on every render: catches both edits and container resizes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });
  return (
    <textarea
      ref={ref}
      aria-label={ariaLabel}
      value={value}
      placeholder={placeholder}
      rows={1}
      onChange={(e) => onChange(e.target.value)}
      className={className}
    />
  );
}

/** Edit-mode block wrapper: drag handle + remove, per design.md §3.3. */
export function BlockShell({
  editable,
  children,
  handleProps,
  onRemove,
  className,
}: {
  editable: boolean;
  children: React.ReactNode;
  handleProps?: React.HTMLAttributes<HTMLButtonElement>;
  onRemove?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("group flex items-start gap-1 py-1.5", className)}>
      {editable && (
        <div className="flex shrink-0 items-center gap-0.5 pt-1 text-(--color-text-secondary)">
          <button
            type="button"
            aria-label="Drag to reorder"
            className="cursor-grab touch-none opacity-40 group-hover:opacity-100"
            {...handleProps}
          >
            <GripVertical className="size-4" />
          </button>
          {onRemove && (
            <button
              type="button"
              aria-label="Remove block"
              onClick={onRemove}
              className="opacity-40 hover:text-(--color-error) group-hover:opacity-100"
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

// ── Meta block (design.md §3.3: servings stepper, total time, source badge) ──

export function MetaBlockView({
  block,
  editable,
  baseServings,
  displayServings,
  onPatch,
  onDisplayServingsChange,
}: {
  block: MetaBlockT;
  editable: boolean;
  baseServings: number;
  /** Servings the reader is currently displaying (scales quantities live, §4.4). */
  displayServings: number;
  onPatch: (patch: Partial<MetaBlockT>) => void;
  onDisplayServingsChange?: (servings: number) => void;
}) {
  const setServings = (n: number) => {
    const clamped = Math.min(100, Math.max(1, n));
    if (editable) onPatch({ servings: clamped });
    onDisplayServingsChange?.(clamped);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] text-(--color-text-secondary)">
      <span className="flex items-center gap-2">
        <span className="uppercase tracking-wide">Serves</span>
        <span className="flex items-center rounded-(--radius-sm) border border-(--color-border)">
          <button
            type="button"
            aria-label="Fewer servings"
            onClick={() => setServings(displayServings - 1)}
            className="px-1.5 py-0.5 hover:text-(--color-accent-deep)"
          >
            <Minus className="size-3" />
          </button>
          <span className="min-w-6 text-center text-(--color-text-primary)">
            {editable ? block.servings : displayServings}
          </span>
          <button
            type="button"
            aria-label="More servings"
            onClick={() => setServings(displayServings + 1)}
            className="px-1.5 py-0.5 hover:text-(--color-accent-deep)"
          >
            <Plus className="size-3" />
          </button>
        </span>
        {editable && block.servings !== displayServings && (
          <button
            type="button"
            onClick={() => onDisplayServingsChange?.(block.servings)}
            className="underline decoration-dotted"
          >
            reset
          </button>
        )}
      </span>

      {editable ? (
        <label className="flex items-center gap-1">
          <span className="uppercase tracking-wide">Time</span>
          <input
            aria-label="Total time minutes"
            type="number"
            min={0}
            value={block.total_time_minutes ?? ""}
            placeholder="—"
            onChange={(e) =>
              onPatch({ total_time_minutes: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="w-14 rounded-(--radius-sm) border border-(--color-border) bg-transparent px-1 text-right"
          />
          min
        </label>
      ) : (
        block.total_time_minutes !== null && <span>{block.total_time_minutes} min total</span>
      )}

      <SourceBadge sourceType={block.source_type} />
    </div>
  );
}

function SourceBadge({ sourceType }: { sourceType: MetaBlockT["source_type"] }) {
  const label: Record<MetaBlockT["source_type"], string> = {
    manual: "Manual",
    youtube_import: "YouTube",
    public_api: "Imported",
    web_import: "Web import",
    dataset: "Dataset",
  };
  return (
    <span className="rounded-(--radius-sm) border border-(--color-border) px-1.5 py-0.5 uppercase tracking-wide">
      {label[sourceType]}
    </span>
  );
}

// ── Ingredient block (design.md §3.3: qty/unit/name + Main/Swap pill) ────────

export function IngredientBlockView({
  block,
  editable,
  baseServings,
  displayServings,
  onPatch,
}: {
  block: IngredientBlockT;
  editable: boolean;
  baseServings: number;
  displayServings: number;
  onPatch: (patch: Partial<IngredientBlockT>) => void;
}) {
  const scaled =
    !editable && displayServings !== baseServings
      ? scaleQuantity(block.quantity, block.unit, baseServings, displayServings)
      : null;

  // Read mode renders a finished line ("1½ cups flour"); edit mode splits into
  // the three fields. Same typography throughout (§4.3).
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      {editable ? (
        <>
          <input
            aria-label="Quantity"
            type="number"
            step="any"
            min={0}
            value={block.quantity ?? ""}
            placeholder="—"
            onChange={(e) =>
              onPatch({ quantity: e.target.value === "" ? null : Number(e.target.value) })
            }
            className="w-16 shrink-0 rounded-(--radius-sm) border border-(--color-border) bg-transparent px-1 text-right font-[family-name:var(--font-mono)] text-[length:var(--text-meta)]"
          />
          <select
            aria-label="Unit"
            value={block.unit ?? ""}
            onChange={(e) => onPatch({ unit: (e.target.value || null) as Unit | null })}
            className="shrink-0 rounded-(--radius-sm) border border-(--color-border) bg-(--color-surface) px-1 py-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)]"
          >
            <option value="">—</option>
            {UNIT_OPTIONS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </>
      ) : (
        <span className="w-20 shrink-0 text-right font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] text-(--color-text-secondary)">
          {formatIngredientQuantity(block, scaled)}
        </span>
      )}

      <div className="min-w-0 flex-1">
        <InlineInput
          ariaLabel="Ingredient"
          value={block.raw_text}
          onChange={(v) => onPatch({ raw_text: v })}
          multiline
          readOnly={!editable}
          className={cn(
            "font-[family-name:var(--font-body)]",
            !editable && "cursor-default",
          )}
        />
      </div>

      <RoleTagPill
        roleTag={block.role_tag}
        editable={editable}
        onToggle={() => onPatch({ role_tag: block.role_tag === "main" ? "swap" : "main" })}
      />
    </div>
  );
}

// Main/Swap tag pill — green for Main, outlined neutral for Swap
// (Heirloom Kitchen "Chips"). Tappable in both modes (design.md §3.3).
function RoleTagPill({
  roleTag,
  editable,
  onToggle,
}: {
  roleTag: IngredientBlockT["role_tag"];
  editable: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={roleTag === "main"}
      className={cn(
        "shrink-0 rounded-(--radius-sm) px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] uppercase tracking-wide",
        roleTag === "main"
          ? "bg-(--color-secondary-container) text-(--color-secondary)"
          : "border border-(--color-border) text-(--color-text-secondary)",
      )}
      title={editable ? "Toggle main/swap" : `This ingredient is ${roleTag}`}
    >
      {roleTag}
    </button>
  );
}

// ── Step block (design.md §3.3: text + inline timer chip, §3.3.2) ────────────

export function StepBlockView({
  block,
  editable,
  recipeId,
  recipeTitle,
  onPatch,
}: {
  block: StepBlockT;
  editable: boolean;
  /** For the Timer Tool (§3.3.2) — navigating back to this step. */
  recipeId?: string;
  recipeTitle?: string;
  onPatch: (patch: Partial<StepBlockT>) => void;
}) {
  const start = useTimerStore((s) => s.start);
  const toggle = useTimerStore((s) => s.toggle);
  // Selector scoped to THIS step's timer: unrelated timers ticking don't
  // re-render this block.
  const active = useTimerStore((s) =>
    recipeId ? s.timers.find((t) => t.stepId === block.id) : undefined,
  );

  return (
    <div className="flex items-start gap-3 py-1.5">
      <span className="shrink-0 pt-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] text-(--color-text-secondary)">
        {block.step_number}.
      </span>
      <div className="min-w-0 flex-1">
        <InlineInput
          ariaLabel={`Step ${block.step_number}`}
          value={block.instruction_text}
          multiline={editable}
          readOnly={!editable}
          onChange={(v) => onPatch({ instruction_text: v })}
        />
        {editable ? (
          <label className="mt-1 flex items-center gap-1 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] text-(--color-text-secondary)">
            timer
            <input
              aria-label="Step duration minutes"
              type="number"
              min={0}
              value={block.duration_minutes ?? ""}
              placeholder="—"
              onChange={(e) =>
                onPatch({
                  duration_minutes: e.target.value === "" ? null : Number(e.target.value),
                })
              }
              className="w-14 rounded-(--radius-sm) border border-(--color-border) bg-transparent px-1 text-right"
            />
            min
          </label>
        ) : (
          block.duration_minutes !== null &&
          block.duration_minutes > 0 &&
          (active ? (
            // Live countdown state (§3.3.2) — tap to pause/resume.
            <button
              type="button"
              onClick={() => toggle(block.id)}
              aria-label={active.running ? "Pause timer" : "Resume timer"}
              className={cn(
                "mt-1 inline-flex items-center gap-1.5 rounded-(--radius-sm) border px-2 py-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)]",
                active.completed
                  ? "animate-pulse border-(--color-turmeric) bg-(--color-turmeric) text-(--color-text-primary)"
                  : active.running
                    ? "border-(--color-turmeric) bg-(--color-turmeric)/20 text-(--color-text-primary)"
                    : "border-(--color-border) bg-(--color-surface-container) text-(--color-text-secondary)",
              )}
            >
              {active.completed ? <BellRing className="size-3" strokeWidth={1.5} /> : <Timer className="size-3 text-(--color-turmeric)" strokeWidth={1.5} />}
              {active.completed ? "done" : active.running ? `${formatClock(active.remainingSeconds)} left` : `paused ${formatClock(active.remainingSeconds)}`}
            </button>
          ) : (
            // Idle chip — tap starts the countdown (§3.3.2).
            <button
              type="button"
              onClick={() =>
                start({
                  stepId: block.id,
                  recipeId: recipeId!,
                  recipeTitle: recipeTitle ?? "",
                  stepNumber: block.step_number,
                  snippet: block.instruction_text.slice(0, 60),
                  totalSeconds: block.duration_minutes! * 60,
                })
              }
              aria-label={`Start ${block.duration_minutes} minute timer for step ${block.step_number}`}
              className="mt-1 inline-flex items-center gap-1 rounded-(--radius-sm) bg-(--color-surface-container) px-2 py-0.5 font-[family-name:var(--font-mono)] text-[length:var(--text-meta)] text-(--color-text-secondary) transition-colors hover:bg-(--color-surface-container-high)"
            >
              <Timer className="size-3 text-(--color-turmeric)" strokeWidth={1.5} />
              {block.duration_minutes} min
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function formatClock(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Note block ────────────────────────────────────────────────────────────────

export function NoteBlockView({
  block,
  editable,
  onPatch,
}: {
  block: NoteBlockT;
  editable: boolean;
  onPatch: (patch: Partial<NoteBlockT>) => void;
}) {
  return (
    <div className="border-l-2 border-(--color-border) pl-3 text-(--color-text-secondary)">
      <InlineInput
        ariaLabel="Note"
        value={block.text}
        multiline={editable}
        readOnly={!editable}
        placeholder={editable ? "Note — substitution tips, storage…" : ""}
        onChange={(v) => onPatch({ text: v })}
        className={editable ? "" : "cursor-default italic"}
      />
    </div>
  );
}
