// Voice assistant chat service — ai-pipeline-owned logic (development.md
// §14.3), hosted by the backend's /chat routes: recipe hydration + context
// assembly + one plain (non-streaming, §0) OpenRouter completion.
import {
  scaleIngredients,
  buildCookingChatMessages,
  type ChatRecipeContext,
  type ChatStepContext,
  type ChatTurnContext,
  type ChatTurnMessage,
} from "@cookbook/shared";
import { prisma } from "../db.js";
import { recipeInclude } from "../recipes/persist.js";
import { llmComplete } from "./openrouter.js";

export async function getVisibleRecipe(userId: string, recipeId: string) {
  // Own recipes + shared imports (userId null) — the same visibility rule the
  // reader applies.
  return prisma.recipe.findFirst({
    where: { id: recipeId, OR: [{ userId }, { userId: null }] },
    include: recipeInclude(),
  });
}

/**
 * Build the ChatRecipeContext from the recipe row + client-reported cooking
 * state. Ingredient lines pair the original raw text with its scaled quantity
 * (same shape as GET /recipes/:id/scale) so "how much flour?" answers match
 * what the reader is rendering at the current servings (§8.1).
 */
export function buildRecipeContext(
  recipe: NonNullable<Awaited<ReturnType<typeof getVisibleRecipe>>>,
  turn: ChatTurnContext,
): ChatRecipeContext {
  const servings = turn.servings ?? recipe.baseServings;
  const scaled = scaleIngredients(
    recipe.ingredients
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((i) => ({
        quantity: i.quantity,
        unit: i.unit as never,
        raw_text: i.rawText,
      })),
    recipe.baseServings,
    servings,
  );
  const ingredients = scaled.map((i) =>
    i.quantity === null
      ? i.raw_text // "to taste" / "a pinch" never scales
      : `${i.raw_text} → ${i.scaled.display}${i.unit ? ` ${i.unit}` : ""} (for ${servings} servings)`,
  );

  const steps: ChatStepContext[] = recipe.steps.map((s) => ({
    step_number: s.stepNumber,
    instruction_text: s.instructionText,
    duration_minutes: s.durationMinutes,
  }));
  const currentRow = turn.current_step_id
    ? recipe.steps.find((rs) => rs.id === turn.current_step_id)
    : undefined;

  return {
    title: recipe.title,
    base_servings: recipe.baseServings,
    servings,
    ingredients,
    steps,
    current_step_number: currentRow?.stepNumber ?? null,
    active_timers: turn.active_timers,
  };
}

/** One non-streaming chat completion (§0: no streaming-heavy LLM patterns). */
export async function generateChatReply(
  context: ChatRecipeContext,
  history: readonly ChatTurnMessage[],
  userMessage: string,
): Promise<string> {
  const messages = buildCookingChatMessages(context, history, userMessage);
  const { content } = await llmComplete(messages, { maxTokens: 220, temperature: 0.4 });
  return content.trim();
}
