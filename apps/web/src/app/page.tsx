import { TopAppBar, BottomTabBar } from "@/components/app-shell";
import { DashboardGrid } from "@/components/dashboard-grid";
import { DiscoverSection } from "@/components/discover-section";

// Dashboard (Home) — design.md §3.1. Meal-plan-backed cells render empty
// states until the planner lands in Phase 5 (see dashboard-grid.tsx).
// Discover (§10 Tier 2) renders as a distinct section below the grid —
// never mixed into the bento cells' core results.
export default function DashboardPage() {
  return (
    <div className="min-h-dvh pb-24">
      <TopAppBar title="CookBook" />
      <main className="mx-auto max-w-3xl px-(--spacing-margin) py-6">
        <DashboardGrid />
        <div className="mt-(--spacing-gutter)">
          <DiscoverSection />
        </div>
      </main>
      <BottomTabBar />
    </div>
  );
}
