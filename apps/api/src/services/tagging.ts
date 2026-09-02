// TaggingService — development.md §6: every ingestion path (manual save,
// public-API import, YouTube import) runs through this before a recipe is
// "done". v1 is rules-only; the LLM pass (§6.1 ambiguous cases) is an
// enhancement layered on later and must never be required (§0).
// Synchronous + idempotent: safe to call on every save.
import type { Unit } from "@cookbook/shared";
import {
  classifyRoleTag,
  difficultyHeuristic,
  inferDietTags,
  systemTagsForRecipe,
  type TagTypeValue,
} from "@cookbook/shared";
import { prisma } from "../db.js";

const SYSTEM_TAG_TYPES: TagTypeValue[] = ["meal_type", "cuisine", "diet", "prep_time", "difficulty"];

/**
 * Recompute and persist rule-based tags for a saved recipe:
 * role_tag per RecipeIngredient, Recipe.dietTags, and system Tag/RecipeTag
 * rows. Only writes rows that actually changed (idempotency, §6.5).
 */
export async function tagRecipe(recipeId: string): Promise<void> {
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { ingredients: true, steps: true, tags: { include: { tag: true } } },
  });
  if (!recipe) return;

  const dietTags = inferDietTags(recipe.ingredients.map((i) => i.rawText));
  const desired = systemTagsForRecipe({
    cuisine: recipe.cuisine,
    mealType: recipe.mealType,
    totalMinutes: recipe.totalTimeMinutes,
    stepCount: recipe.steps.length,
    dietTags,
  });

  await prisma.$transaction(async (tx) => {
    // 1. main/swap role classification (§6.1) — recompute, update only diffs
    for (const ing of recipe.ingredients) {
      const role = classifyRoleTag(
        { name: ing.rawText, quantity: ing.quantity, unit: (ing.unit as Unit | null) ?? null },
        recipe.title,
      );
      if (ing.roleTag !== role) {
        await tx.recipeIngredient.update({ where: { id: ing.id }, data: { roleTag: role } });
      }
    }

    // 2. Recipe.dietTags JSON + difficulty column (§6.3 heuristic)
    const dietJson = JSON.stringify(dietTags);
    const difficulty = difficultyHeuristic(recipe.steps.length, recipe.totalTimeMinutes);
    if (recipe.dietTags !== dietJson || recipe.difficulty !== difficulty) {
      await tx.recipe.update({
        where: { id: recipeId },
        data: { dietTags: dietJson, difficulty },
      });
    }

    // 3. system Tag associations — find-or-create Tag rows (userId null),
    //    then sync RecipeTag rows to the desired set (§6.5: re-tag changed only)
    const existingTags = await tx.tag.findMany({
      where: { userId: null, tagType: { in: SYSTEM_TAG_TYPES } },
    });
    const byKey = new Map(existingTags.map((t) => [tagKey(t.label, t.tagType as TagTypeValue), t]));

    for (const sys of desired) {
      let tag = byKey.get(tagKey(sys.label, sys.tag_type));
      if (!tag) {
        tag = await tx.tag.create({
          data: { label: sys.label, tagType: sys.tag_type, userId: null },
        });
        byKey.set(tagKey(tag.label, tag.tagType as TagTypeValue), tag);
      }
      await tx.recipeTag.upsert({
        where: { recipeId_tagId: { recipeId, tagId: tag.id } },
        create: { recipeId, tagId: tag.id },
        update: {},
      });
    }

    // drop system-type associations that no longer apply (label set changed)
    const desiredKeys = new Set(desired.map((s) => tagKey(s.label, s.tag_type)));
    const stale = recipe.tags.filter((t) => {
      if (t.tag.userId !== null || !SYSTEM_TAG_TYPES.includes(t.tag.tagType as TagTypeValue)) return false;
      return !desiredKeys.has(tagKey(t.tag.label, t.tag.tagType as TagTypeValue));
    });
    for (const t of stale) {
      await tx.recipeTag.deleteMany({ where: { recipeId, tagId: t.tagId } });
    }
  });
}

function tagKey(label: string, type: TagTypeValue): string {
  return `${type}:${label.toLowerCase()}`;
}
