"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, CalendarDays, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

// Top App Bar — design.md §2.4 #1: app name (left), avatar/profile circle
// (right). h-16 with hairline bottom border (dashboard mockup).
export function TopAppBar({ title }: { title?: string }) {
  return (
    <header className="sticky top-0 z-10 border-b border-(--color-border) bg-(--color-page)/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-(--spacing-margin)">
        <h1 className="font-[family-name:var(--font-display)] text-[length:var(--text-display)] font-bold">
          {title ?? "KitchenScale"}
        </h1>
        <Link
          href="/profile"
          aria-label="Profile"
          className="flex size-9 items-center justify-center rounded-full border border-(--color-border) bg-(--color-surface) text-(--color-text-secondary) transition-colors hover:bg-(--color-surface-container)"
        >
          <UserRound className="size-5" strokeWidth={1.5} />
        </Link>
      </div>
    </header>
  );
}

// Bottom Tab Bar — design.md §2.4 #9: Home, Search, Meal Planner, Profile;
// active tab gets the accent color + underline.
const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/profile", label: "Profile", icon: UserRound },
];

export function BottomTabBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-(--color-border) bg-(--color-page)/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl">
        {TABS.map((tab) => {
          const active =
            tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-1 py-2 text-[length:var(--text-meta)] font-medium transition-colors",
                active ? "text-(--color-accent-deep)" : "text-(--color-text-secondary)",
              )}
            >
              <tab.icon
                className="size-5"
                strokeWidth={1.5}
                fill={active ? "currentColor" : "none"}
                fillOpacity={0.15}
              />
              <span className="relative">
                {tab.label}
                {active && (
                  <span className="absolute -bottom-1 left-0 h-0.5 w-full bg-(--color-accent)" />
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
