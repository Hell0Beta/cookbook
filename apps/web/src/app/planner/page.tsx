import { TopAppBar, BottomTabBar } from "@/components/app-shell";
import { PlannerClient } from "./planner-client";

// Meal Planner — design.md §3.5 (Phase 6: 3-panel page with drag-and-drop).
export default function PlannerPage() {
  return (
    <div className="min-h-dvh pb-20">
      <TopAppBar title="Meal Planner" />
      <main className="mx-auto max-w-5xl px-(--spacing-margin) pt-(--spacing-margin)">
        <PlannerClient />
      </main>
      <BottomTabBar />
    </div>
  );
}
