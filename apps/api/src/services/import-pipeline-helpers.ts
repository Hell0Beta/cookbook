// Ingredient-master linking shared by the import pipelines (public API,
// dataset) — §4 step 3. Extracted so scripts/ can use it without pulling in
// the whole provider-coupled pipeline.
import {
  ingredientCategory,
  normalizeIngredientName,
} from "@cookbook/shared";
import { prisma } from "../db.js";

/** Find-or-create the Ingredient master row (fuzzy via normalize). */
export async function linkIngredientMaster(rawText: string): Promise<string | null> {
  const canonical = normalizeIngredientName(rawText);
  if (!canonical) return null;
  const existing = await prisma.ingredient.findUnique({ where: { canonicalName: canonical } });
  if (existing) return existing.id;
  const created = await prisma.ingredient.create({
    data: {
      canonicalName: canonical,
      category: ingredientCategory(rawText), // §6.4: lookup table (MealDB has no aisle)
    },
  });
  return created.id;
}
