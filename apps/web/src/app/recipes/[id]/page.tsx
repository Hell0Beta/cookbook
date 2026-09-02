import { notFound } from "next/navigation";
import { TopAppBar, BottomTabBar } from "@/components/app-shell";
import { RecipeReaderPage } from "./reader-client";

// Recipe Reader/Editor — design.md §3.3: one page, read mode by default,
// edit toggle on the same surface (no separate edit screen).
// Query params scope the reader to a meal occasion (design.md §4.1): ?date=&slot=
// opens all dishes planned for that slot; ?upcoming=1 opens the #Upcoming pins.
export default async function RecipePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!id) notFound();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (
    <div className="min-h-dvh pb-24">
      <TopAppBar title="Recipe" />
      <RecipeReaderPage
        recipeId={id}
        occasion={
          one(sp.date) && one(sp.slot)
            ? { kind: "slot", date: one(sp.date)!, slot: one(sp.slot)! }
            : one(sp.upcoming)
              ? { kind: "upcoming" }
              : null
        }
      />
      <BottomTabBar />
    </div>
  );
}
