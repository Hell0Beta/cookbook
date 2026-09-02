// Recipe persistence shared by the REST routes and the import pipeline —
// writeBlocks contract per development.md §7.1 (one batch on save).
import type { RecipeBlocks } from "@cookbook/shared";
import { prisma } from "../db.js";
import { deriveTotalTime } from "./serialize.js";
import { invalidateIngredientIndex } from "../services/ingredient-index.js";

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type MetaBlock = Extract<RecipeBlocks["blocks"][number], { type: "meta" }>;
type StepBlock = Extract<RecipeBlocks["blocks"][number], { type: "step" }>;

export function recipeInclude() {
  return { ingredients: true, steps: true, notes: true } as const;
}

export function metaOf(body: RecipeBlocks): MetaBlock | undefined {
  return body.blocks.find((b): b is MetaBlock => b.type === "meta");
}

export function stepDurationsOf(body: RecipeBlocks): number[] {
  return body.blocks
    .filter((b): b is StepBlock => b.type === "step")
    .map((b) => b.duration_minutes ?? 0);
}

/**
 * Replace the recipe's ingredient/step/note rows with the block array.
 * A full replace inside one transaction is simpler than row-level diffs and
 * payload sizes are small (personal recipes, ≤5 users). Empty draft blocks
 * are dropped rather than persisted as blank rows — the client re-syncs from
 * the response, so its state matches what was stored.
 */
export async function writeBlocks(tx: Tx, recipeId: string, body: RecipeBlocks): Promise<void> {
  await tx.recipeIngredient.deleteMany({ where: { recipeId } });
  await tx.recipeStep.deleteMany({ where: { recipeId } });
  await tx.recipeNote.deleteMany({ where: { recipeId } });

  let ingredientOrder = 0;
  let stepNumber = 0;
  let noteOrder = 0;
  for (const block of body.blocks) {
    if (block.type === "ingredient") {
      if (!block.raw_text.trim()) continue;
      await tx.recipeIngredient.create({
        data: {
          recipeId,
          ingredientId: block.ingredient_id,
          rawText: block.raw_text,
          quantity: block.quantity,
          unit: block.unit,
          roleTag: block.role_tag,
          swapSuggestions: JSON.stringify(block.swap_suggestions),
          sortOrder: ingredientOrder++,
        },
      });
    } else if (block.type === "step") {
      if (!block.instruction_text.trim()) continue;
      await tx.recipeStep.create({
        data: {
          recipeId,
          stepNumber: ++stepNumber,
          instructionText: block.instruction_text,
          durationMinutes: block.duration_minutes,
          imageUrl: block.image_url,
          sortOrder: stepNumber,
        },
      });
    } else if (block.type === "note") {
      if (!block.text.trim()) continue;
      await tx.recipeNote.create({
        data: { recipeId, text: block.text, sortOrder: noteOrder++ },
      });
    }
    // meta is handled at the recipe level by the caller
  }
  // Ingredient rows were rewritten — the search index rebuilds on next use
  // (development.md §9 step 1).
  invalidateIngredientIndex();
}

/**
 * Create a recipe + its block rows in one transaction. `extra` carries
 * provider-derived fields (cuisine, meal_type) that manual saves don't have.
 */
export async function createRecipeFromBlocks(
  userId: string | null,
  body: RecipeBlocks,
  extra?: { cuisine?: string | null; mealType?: string | null },
) {
  return prisma.$transaction(async (tx) => {
    const meta = metaOf(body);
    const created = await tx.recipe.create({
      data: {
        userId,
        title: body.title,
        description: body.description,
        heroImageUrl: body.hero_image_url,
        baseServings: meta?.servings ?? 2,
        totalTimeMinutes: deriveTotalTime(stepDurationsOf(body)),
        sourceType: meta?.source_type ?? "manual",
        sourceUrl: meta?.source_url ?? null,
        cuisine: extra?.cuisine ?? null,
        mealType: extra?.mealType ?? null,
      },
    });
    await writeBlocks(tx, created.id, body);
    return tx.recipe.findUnique({ where: { id: created.id }, include: recipeInclude() });
  });
}
