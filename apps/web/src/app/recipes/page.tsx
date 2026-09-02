import { TopAppBar, BottomTabBar } from "@/components/app-shell";
import { RecipesBrowser } from "@/components/recipes-browser";

// Recipe list — Phase 1 scope; becomes the full Search screen in Phase 8
// (design.md §3.2: search input + filter chip row + result list).
export default function RecipesPage() {
  return (
    <div className="min-h-dvh pb-20">
      <TopAppBar title="My Recipes" />
      <main className="mx-auto max-w-3xl px-(--spacing-margin) pt-(--spacing-margin)">
        <RecipesBrowser />
      </main>
      <BottomTabBar />
    </div>
  );
}
