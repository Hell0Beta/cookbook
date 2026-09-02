import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * BentoCell — the atomic unit behind every dashboard/list card (design.md §2.4 #5).
 * Image region (optional) + text region + action region; spans 1x1, 2x1, or 2x2
 * grid units. 6px radius, 1px border, no shadow (§2.1).
 */
export function BentoCell({
  children,
  className,
  span = "1x1",
  onClick,
}: {
  children: ReactNode;
  className?: string;
  span?: "1x1" | "2x1" | "1x2" | "2x2";
  onClick?: () => void;
}) {
  const spanClass = {
    "1x1": "col-span-1 row-span-1",
    "2x1": "col-span-2 row-span-1",
    "1x2": "col-span-1 row-span-2",
    "2x2": "col-span-2 row-span-2",
  }[span];

  return (
    <div
      onClick={onClick}
      className={cn(
        "flex flex-col overflow-hidden rounded-(--radius-bento) border border-(--color-border) bg-(--color-surface) p-(--spacing-cell)",
        onClick && "cursor-pointer hover:border-(--color-accent) transition-colors",
        spanClass,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Diagonal-hatch image placeholder used across all bento cells (design.md §5). */
export function HatchPlaceholder({ className }: { className?: string }) {
  return <div className={cn("hatch min-h-24 w-full rounded-(--radius-sm)", className)} />;
}
