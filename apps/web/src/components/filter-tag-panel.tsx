"use client";

// Filter Tag Panel — design.md §2.4 #4 + §4.6. Slide-out panel with a
// "Select Filter Tags" title: expandable groups ("Active Item ⌄") revealing
// indented nested rows, plus flat default rows. Works on the flat system-tag
// tree (grouped by tag_type) and on genuinely one-level-nested custom tags.
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import type { TagNode } from "@cookbook/shared";
import { cn } from "@/lib/utils";

// Group order for flat roots — mirrors how the TaggingEngine populates them.
const TYPE_LABELS: Record<string, string> = {
  meal_type: "Meal Type",
  cuisine: "Cuisine",
  diet: "Diet",
  prep_time: "Prep Time",
  difficulty: "Difficulty",
  ingredient_based: "Ingredient Based",
  custom: "Custom",
};
const TYPE_ORDER = Object.keys(TYPE_LABELS);

export function FilterTagPanel({
  nodes,
  selectedIds,
  onToggle,
  onClear,
  onClose,
}: {
  nodes: TagNode[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  // Roots with children keep their own nesting; flat roots group by tag_type
  // so the panel still reads as expandable sections (design.md §2.4 #4).
  const groups = useMemo(() => {
    const nested = nodes.filter((n) => n.children.length > 0);
    const byType = new Map<string, TagNode[]>();
    for (const node of nodes) {
      if (node.children.length > 0) continue;
      const list = byType.get(node.tag_type) ?? [];
      list.push(node);
      byType.set(node.tag_type, list);
    }
    const flatGroups = [...byType.entries()]
      .sort((a, b) => {
        const ai = TYPE_ORDER.indexOf(a[0]);
        const bi = TYPE_ORDER.indexOf(b[0]);
        return (ai === -1 ? TYPE_ORDER.length : ai) - (bi === -1 ? TYPE_ORDER.length : bi);
      })
      .map(([type, tags]) => ({
        key: `type:${type}`,
        label: TYPE_LABELS[type] ?? type,
        tags,
      }));
    return [
      ...nested.map((n) => ({ key: n.id, label: n.label, tags: [n] })),
      ...flatGroups,
    ];
  }, [nodes]);

  return (
    <div className="fixed inset-0 z-20 bg-black/30" onClick={onClose}>
      <div
        className="absolute right-0 top-0 flex h-full w-full max-w-xs flex-col border-l border-(--color-border) bg-(--color-surface)"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Select filter tags"
      >
        <div className="flex items-center justify-between gap-2 border-b border-(--color-border) p-(--spacing-cell)">
          <h2 className="font-[family-name:var(--font-display)] text-[length:var(--text-h2)] font-semibold">
            Select Filter Tags
          </h2>
          <button type="button" aria-label="Close filter panel" onClick={onClose} className="text-(--color-text-secondary)">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-(--spacing-cell)">
          {groups.length === 0 && (
            <p className="text-[length:var(--text-meta)] text-(--color-text-secondary)">
              No tags yet — tags appear as recipes are saved and auto-tagged.
            </p>
          )}
          <div className="flex flex-col gap-1">
            {groups.map((group) => (
              <TagGroup
                key={group.key}
                label={group.label}
                tags={group.tags}
                selectedIds={selectedIds}
                onToggle={onToggle}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-(--color-border) p-(--spacing-cell)">
          {selectedIds.size > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="rounded-(--radius-sm) border border-(--color-border) bg-(--color-page) px-3 py-2 text-[length:var(--text-meta)] font-medium text-(--color-text-secondary) hover:border-(--color-accent)"
            >
              Clear all
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-(--radius-sm) border border-(--color-accent) bg-(--color-accent) py-2 font-medium text-white hover:opacity-90"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Expandable "Active Item ⌄" section holding its tag rows (design.md §2.4 #4). */
function TagGroup({
  label,
  tags,
  selectedIds,
  onToggle,
}: {
  label: string;
  tags: TagNode[];
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedCount = tags.reduce(
    (n, t) => n + (selectedIds.has(t.id) ? 1 : 0) + t.children.filter((c) => selectedIds.has(c.id)).length,
    0,
  );
  return (
    <div className="rounded-(--radius-sm) border border-(--color-border) bg-(--color-page)">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-(--color-text-secondary)" strokeWidth={1.5} />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-(--color-text-secondary)" strokeWidth={1.5} />
        )}
        <span className="flex-1 font-medium">{label}</span>
        {selectedCount > 0 && (
          <span className="font-mono text-mono text-(--color-accent-deep)">{selectedCount}</span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-0.5 px-3 pb-2.5">
          {tags.map((tag) =>
            tag.children.length > 0 ? (
              <NestedTagRow key={tag.id} node={tag} selectedIds={selectedIds} onToggle={onToggle} />
            ) : (
              <TagRow key={tag.id} node={tag} selectedIds={selectedIds} onToggle={onToggle} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** A tag with children: selectable itself, expandable to indented child rows. */
function NestedTagRow({
  node,
  selectedIds,
  onToggle,
}: {
  node: TagNode;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="flex items-center">
        <button
          type="button"
          aria-pressed={selectedIds.has(node.id)}
          onClick={() => onToggle(node.id)}
          className={cn(
            "flex-1 rounded-(--radius-sm) px-2 py-2 text-left text-[length:var(--text-body)] transition-colors",
            selectedIds.has(node.id)
              ? "bg-(--color-accent) text-white"
              : "hover:bg-(--color-surface-container)",
          )}
        >
          {node.label}
        </button>
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Expand ${node.label}`}
          onClick={() => setOpen((o) => !o)}
          className="flex size-8 shrink-0 items-center justify-center rounded-(--radius-sm) text-(--color-text-secondary) hover:bg-(--color-surface-container)"
        >
          {open ? (
            <ChevronDown className="size-4" strokeWidth={1.5} />
          ) : (
            <ChevronRight className="size-4" strokeWidth={1.5} />
          )}
        </button>
      </div>
      {open && (
        <div className="ml-4 flex flex-col gap-0.5 border-l border-(--color-border) pl-2">
          {node.children.map((child) => (
            <TagRow key={child.id} node={child} selectedIds={selectedIds} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}

function TagRow({
  node,
  selectedIds,
  onToggle,
}: {
  node: TagNode;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const selected = selectedIds.has(node.id);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onToggle(node.id)}
      className={cn(
        "flex items-center justify-between rounded-(--radius-sm) px-2 py-2 text-left transition-colors",
        selected ? "bg-(--color-accent) text-white" : "hover:bg-(--color-surface-container)",
      )}
    >
      <span>{node.label}</span>
      {selected && <Check className="size-4" strokeWidth={2} />}
    </button>
  );
}
