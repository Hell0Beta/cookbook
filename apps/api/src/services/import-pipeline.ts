// Public-API import pipeline — development.md §4 (MealDB default; Spoonacular
// stays behind its config flag). Fetch → map to internal blocks → Ingredient
// master matching → persist → TaggingService. Provider tags inform cuisine/
// meal_type fields but never become RecipeTag rows directly (§4 step 4).
import { parseIngredient } from "parse-ingredient";
import {
  estimateDurationMinutes,
  type RecipeBlocks,
  type Unit,
} from "@cookbook/shared";
import { prisma } from "../db.js";
import { ApiError } from "../middleware/error.js";
import { deriveTotalTime } from "../recipes/serialize.js";
import { tagRecipe } from "./tagging.js";
import { saveImageFromUrl } from "./image-store.js";
import {
  lookupMealDbMeal,
  mealDbIngredients,
  mealDbMealType,
  type MealDbMeal,
} from "./mealdb.js";
import { createRecipeFromBlocks } from "../recipes/persist.js";
import { linkIngredientMaster } from "./import-pipeline-helpers.js";

function fetchRecipe(id: string) {
  return prisma.recipe.findUnique({
    where: { id },
    include: { ingredients: { orderBy: { sortOrder: "asc" } }, steps: true, notes: true },
  });
}

// parse-ingredient unitOfMeasureID → our Unit enum (entities.ts). Anything
// unmappable keeps a null unit — the grocery aggregator handles unitless items.
const UOM_TO_UNIT: Record<string, Unit> = {
  tablespoon: "tbsp",
  teaspoon: "tsp",
  cup: "cup",
  fluidOunce: "oz",
  ounce: "oz",
  pound: "lb",
  gram: "g",
  kilogram: "kg",
  milliliter: "ml",
  liter: "l",
  each: "piece",
};

/** Provider ingredient string ("2 cups plain flour") → structured block fields. */
function parseProviderIngredient(name: string, measure: string) {
  const parsed = parseIngredient(`${measure} ${name}`.trim()).find((p) => !p.isGroupHeader);
  const quantity = parsed?.quantity ?? null;
  const unit = parsed?.unitOfMeasureID ? (UOM_TO_UNIT[parsed.unitOfMeasureID] ?? null) : null;
  // "Salt to taste" style — quantity-less, flagged as such
  const toTaste = /\bto taste\b/i.test(name) || /\bto taste\b/i.test(measure);
  return {
    quantity: toTaste ? null : quantity,
    unit: toTaste ? ("to_taste" as Unit) : unit,
    raw_text: name,
  };
}

/** Split MealDB's single instructions blob into step texts. */
function splitInstructions(text: string | null): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** MealDb meal → internal RecipeBlocks (no ids yet — rows are created on save). */
export async function buildMealDbBlocks(meal: MealDbMeal): Promise<RecipeBlocks> {
  const steps = splitInstructions(meal.strInstructions).map((text, i) => ({
    id: `import-s${i}`,
    type: "step" as const,
    step_number: i + 1,
    instruction_text: text,
    duration_minutes: estimateDurationMinutes(text), // §4 step 2: estimate when provider lacks
    image_url: null,
  }));

  const ingredients = mealDbIngredients(meal).map((ing, i) => {
    const parsed = parseProviderIngredient(ing.name, ing.measure);
    return {
      id: `import-i${i}`,
      type: "ingredient" as const,
      quantity: parsed.quantity,
      unit: parsed.unit,
      raw_text: ing.name,
      ingredient_id: null, // master linking happens at persist
      role_tag: "main" as const, // TaggingService recomputes (§6.1)
      swap_suggestions: [] as string[],
      sort_order: i,
    };
  });

  const hero = meal.strMealThumb ? await saveImageFromUrl(meal.strMealThumb) : null;

  return {
    title: meal.strMeal,
    description: meal.strTags ? meal.strTags.split(",").map((t) => t.trim()).join(", ") : null,
    hero_image_url: hero,
    blocks: [
      {
        id: "meta",
        type: "meta",
        servings: 4, // MealDB has no servings — typical recipe default
        total_time_minutes: deriveTotalTime(steps.map((s) => s.duration_minutes ?? 0)),
        source_type: "public_api",
        source_url: meal.strSource ?? `https://www.themealdb.com/dish/${meal.idMeal}`,
      },
      ...ingredients,
      ...steps,
    ],
  };
}

/**
 * Import a provider recipe as a SHARED recipe (userId null — visible to every
 * account per §3's shared-import rule) and run the Tagging Engine (§4 step 4).
 * Idempotent: re-importing the same provider recipe returns the existing row.
 */
export async function importPublicApiRecipe(provider: "mealdb", providerRecipeId: string) {
  const meal = await lookupMealDbMeal(providerRecipeId);
  const sourceUrl = meal.strSource ?? `https://www.themealdb.com/dish/${meal.idMeal}`;

  const existing = await prisma.recipe.findFirst({ where: { sourceType: "public_api", sourceUrl } });
  if (existing) return fetchRecipe(existing.id);

  const blocks = await buildMealDbBlocks(meal);
  const created = await createRecipeFromBlocks(null, blocks, {
    cuisine: meal.strArea,
    mealType: mealDbMealType(meal.strCategory),
  });
  const recipeId = created!.id;

  // §4 step 3: link ingredients to the master table now that rows exist
  const ingredientBlocks = blocks.blocks.filter((b) => b.type === "ingredient");
  const saved = await fetchRecipe(recipeId);
  for (const [i, row] of saved!.ingredients.entries()) {
    const block = ingredientBlocks[i];
    if (!block || block.type !== "ingredient") continue;
    const masterId = await linkIngredientMaster(block.raw_text);
    if (masterId && row.ingredientId !== masterId) {
      await prisma.recipeIngredient.update({ where: { id: row.id }, data: { ingredientId: masterId } });
    }
  }

  await tagRecipe(recipeId); // role tags, diet tags, system Tag rows
  return fetchRecipe(recipeId);
}

/** Guard used by the route: keep unknown providers a 400, not a 500. */
export function assertProvider(provider: string): asserts provider is "mealdb" {
  if (provider !== "mealdb") {
    throw new ApiError(400, "unsupported_provider", "Only 'mealdb' is enabled (spoonacular is behind a config flag)");
  }
}
