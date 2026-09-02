// Recipe ↔ block-stack serialization (development.md §7.1 "Unified Read/Edit Surface").
// The client models the recipe as an ordered block array; this module maps between
// that and the Recipe/RecipeIngredient/RecipeStep/RecipeNote rows.
import type { RecipeBlock, RecipeBlocks, SourceType, Unit } from "@cookbook/shared";
import type { Recipe, RecipeIngredient, RecipeNote, RecipeStep } from "@prisma/client";

type RecipeWithContent = Recipe & {
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  notes: RecipeNote[];
};

function jsonArray(s: string): string[] {
  try {
    return JSON.parse(s) as string[];
  } catch {
    return [];
  }
}

export function serializeRecipe(recipe: RecipeWithContent): RecipeBlocks {
  const meta: RecipeBlock = {
    id: `${recipe.id}:meta`,
    type: "meta",
    servings: recipe.baseServings,
    total_time_minutes: recipe.totalTimeMinutes,
    source_type: recipe.sourceType as SourceType,
    source_url: recipe.sourceUrl,
  };

  const ingredientBlocks: RecipeBlock[] = recipe.ingredients
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((ing) => ({
      id: ing.id,
      type: "ingredient" as const,
      quantity: ing.quantity,
      unit: ing.unit as Unit | null,
      raw_text: ing.rawText,
      ingredient_id: ing.ingredientId,
      role_tag: ing.roleTag as "main" | "swap",
      swap_suggestions: jsonArray(ing.swapSuggestions),
      sort_order: ing.sortOrder,
    }));

  const stepBlocks: RecipeBlock[] = recipe.steps
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((step) => ({
      id: step.id,
      type: "step" as const,
      step_number: step.stepNumber,
      instruction_text: step.instructionText,
      duration_minutes: step.durationMinutes,
      image_url: step.imageUrl,
    }));

  const noteBlocks: RecipeBlock[] = recipe.notes
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((note) => ({
      id: note.id,
      type: "note" as const,
      text: note.text,
    }));

  return {
    title: recipe.title,
    description: recipe.description,
    hero_image_url: recipe.heroImageUrl,
    blocks: [meta, ...ingredientBlocks, ...stepBlocks, ...noteBlocks],
  };
}

/** Derived per development.md §3: sum of step durations + prep buffer. */
const PREP_BUFFER_MINUTES = 10;

export function deriveTotalTime(stepDurations: number[]): number | null {
  const timed = stepDurations.filter((d) => d > 0);
  if (timed.length === 0) return null;
  return timed.reduce((a, b) => a + b, 0) + PREP_BUFFER_MINUTES;
}
