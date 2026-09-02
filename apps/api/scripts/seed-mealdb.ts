// Seed a demo library from TheMealDB's free tier — development.md §4 /
// phase-03 todo. Idempotent: re-running skips already-imported source URLs.
// Run: pnpm --filter @cookbook/api exec tsx scripts/seed-mealdb.ts [count]
import { importPublicApiRecipe } from "../src/services/import-pipeline.js";
import { lookupMealDbMeal, searchMealDb } from "../src/services/mealdb.js";
import { prisma } from "../src/db.js";

async function main() {
  const count = Math.min(Number(process.argv[2] ?? 12), 25);

  // Search-feed sweep (latest.php is Patreon-gated). Results carry
  // provider_recipe_id — lookup.php fills in the full meal.
  const queries = ["chicken", "pasta", "soup", "salad", "cake", "curry"];
  const results = (await Promise.all(queries.map((q) => searchMealDb(q)))).flat().slice(0, count);

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  for (const result of results) {
    try {
      const full = await lookupMealDbMeal(result.provider_recipe_id);
      const sourceUrl = full.strSource ?? `https://www.themealdb.com/dish/${full.idMeal}`;
      const before = await prisma.recipe.findFirst({
        where: { sourceType: "public_api", sourceUrl },
      });
      if (before) {
        skipped++;
        continue;
      }
      const recipe = await importPublicApiRecipe("mealdb", result.provider_recipe_id);
      console.log(`[seed] ${recipe?.title}`);
      imported++;
    } catch (err) {
      failed++;
      console.warn(`[seed] ${result.title} failed:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`[seed] done: ${imported} imported, ${skipped} already present, ${failed} failed`);
}

main()
  .catch((err) => {
    console.error("[seed] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
