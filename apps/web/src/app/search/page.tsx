import { TopAppBar, BottomTabBar } from "@/components/app-shell";
import { SearchClient } from "./search-client";

// Search screen — design.md §3.2. Tag-based filters and the Filter Tag Panel
// (§2.4 #4) land with the tagging engine (Phase 3) / Phase 8.
export default function SearchPage() {
  return (
    <div className="min-h-dvh pb-24">
      <TopAppBar title="Search" />
      <main className="mx-auto max-w-3xl px-(--spacing-margin) py-4">
        <SearchClient />
      </main>
      <BottomTabBar />
    </div>
  );
}
