import { TopAppBar, BottomTabBar } from "@/components/app-shell";
import { GroceryListClient } from "./grocery-list-client";

// Grocery List — design.md §3.6. Aggregated, de-duplicated items grouped by
// grocery category as bento cells; checkbox per item; manual add field.
export default function GroceryListPage() {
  return (
    <div className="min-h-dvh pb-20">
      <TopAppBar title="Grocery List" />
      <main className="mx-auto max-w-3xl px-(--spacing-margin) pt-(--spacing-margin)">
        <GroceryListClient />
      </main>
      <BottomTabBar />
    </div>
  );
}
