// Voice assistant schemas mirroring docs/development.md §3 ("CookingSession",
// "ChatMessage") and §11 (/chat/* routes). Field names are contractual — a
// rename here requires updating that doc.
import { z } from "zod";

// ── Enums (development.md §3) ────────────────────────────────────────────────

export const ChatRole = z.enum(["user", "assistant"]);
export type ChatRole = z.infer<typeof ChatRole>;

// Which router branch produced the reply (development.md §3, §14.2): rule-based
// intents (step_control, ingredient_lookup, timer) cost zero quota; `llm` marks
// OpenRouter turns; `llm_fallback` marks the quota-exhausted spoken notice;
// `quota_notice` marks any other system-spoken quota messaging.
export const ChatIntent = z.enum([
  "step_control",
  "ingredient_lookup",
  "timer",
  "llm",
  "llm_fallback",
  "quota_notice",
]);
export type ChatIntent = z.infer<typeof ChatIntent>;

// ── Entities (development.md §3) ─────────────────────────────────────────────

export const ChatMessage = z.object({
  id: z.string(),
  cooking_session_id: z.string(),
  role: ChatRole,
  // Text only — transcribed speech is stored as its transcript, audio is
  // never persisted (development.md §14.4).
  content: z.string(),
  intent: ChatIntent.nullable(),
  created_at: z.string(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const CookingSession = z.object({
  id: z.string(),
  user_id: z.string(),
  recipe_id: z.string(),
  // Matches the meal-occasion identity the Reader already uses (?date=&slot= /
  // ?upcoming=1 params) — one conversation per (user, occasion).
  occasion_key: z.string().nullable(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  last_seen_at: z.string(),
});
export type CookingSession = z.infer<typeof CookingSession>;

// ── API shapes (development.md §11) ──────────────────────────────────────────

export const CreateChatSessionInput = z.object({
  recipe_id: z.string().min(1),
  occasion_key: z.string().max(200).nullish(),
  // "Start fresh" (design.md §3.3.4): end today's matching open session and
  // create a new one instead of resuming it.
  fresh: z.boolean().optional(),
});
export type CreateChatSessionInput = z.infer<typeof CreateChatSessionInput>;

export const ChatSessionResponse = z.object({
  session: CookingSession,
  messages: z.array(ChatMessage),
  resumed: z.boolean(), // false = freshly created, true = today's session reloaded
});
export type ChatSessionResponse = z.infer<typeof ChatSessionResponse>;

// Client-sent cooking context for an LLM turn (development.md §14.3): step
// position and timer state live client-side, so the client reports them.
export const ActiveTimerContext = z.object({
  step_id: z.string(),
  label: z.string(), // short human label, e.g. "Simmer"
  remaining_seconds: z.number().int(),
});
export type ActiveTimerContext = z.infer<typeof ActiveTimerContext>;

export const ChatTurnContext = z.object({
  current_step_id: z.string().nullable(),
  active_timers: z.array(ActiveTimerContext),
  // Servings the client is currently rendering (servings scaling, §8.1).
  servings: z.number().int().positive().optional(),
});
export type ChatTurnContext = z.infer<typeof ChatTurnContext>;

export const ChatMessageInput = z.object({
  content: z.string().min(1).max(2000),
  // The recipe the client is currently viewing (multi-recipe tabs, design.md
  // §3.3.1): overrides the session's anchor recipe for this turn and becomes
  // the new anchor — one transcript per occasion, context follows the tab.
  recipe_id: z.string().min(1).optional(),
  context: ChatTurnContext,
});
export type ChatMessageInput = z.infer<typeof ChatMessageInput>;

export const ChatLlmTurnResponse = z.object({
  user_message: ChatMessage,
  reply: ChatMessage,
});
export type ChatLlmTurnResponse = z.infer<typeof ChatLlmTurnResponse>;

// POST /chat/sessions/:id/log — fire-and-forget persistence of client-resolved
// router turns + proactive notices (development.md §14.2); never calls the LLM.
export const ChatLogInput = z.object({
  role: ChatRole,
  content: z.string().min(1).max(2000),
  intent: ChatIntent,
});
export type ChatLogInput = z.infer<typeof ChatLogInput>;

// ── LLM turn prompt assembly (development.md §14.3) ──────────────────────────
// Pure: the backend's chat route hydrates the recipe, the builder here turns
// it + client context + persisted history into the message array for the
// OpenRouter call. Budget: current step ± neighbors (not the whole recipe),
// full ingredient list at current scale, timer summary, last ~8 session turns.

/** Spoken/shown when an LLM turn hits the daily quota (design.md §5) — the
 *  client renders this exact text so it matches what the server persisted. */
export const CHAT_QUOTA_NOTICE =
  "Daily AI requests used up — I can still read steps, check ingredients, and set timers.";

export const CHAT_HISTORY_TURNS = 8;

export interface ChatStepContext {
  step_number: number;
  instruction_text: string;
  duration_minutes: number | null;
}

/** Recipe context for one LLM turn — everything the assistant may reference. */
export interface ChatRecipeContext {
  title: string;
  base_servings: number;
  /** Servings the client is currently rendering (scaling, §8.1). */
  servings: number;
  /** Already-scaled display lines, e.g. "2 cups flour" (see scaleIngredients). */
  ingredients: string[];
  steps: ChatStepContext[];
  current_step_number: number | null;
  active_timers: ActiveTimerContext[];
}

export interface ChatTurnMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function formatTimer(t: ActiveTimerContext): string {
  const mins = Math.floor(t.remaining_seconds / 60);
  const secs = t.remaining_seconds % 60;
  const remaining = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  return `"${t.label}" (${t.step_id}): ${remaining} left`;
}

function stepLine(s: ChatStepContext): string {
  const dur = s.duration_minutes !== null ? ` [${s.duration_minutes} min]` : "";
  return `Step ${s.step_number}${dur}: ${s.instruction_text}`;
}

/**
 * Build the OpenRouter message array for a cooking-chat turn.
 * The system prompt fixes the persona (development.md §14.3): terse,
 * kitchen-appropriate, this-recipe-first, at most 2 sentences.
 */
export function buildCookingChatMessages(
  context: ChatRecipeContext,
  history: readonly ChatTurnMessage[],
  userMessage: string,
): ChatTurnMessage[] {
  const parts: string[] = [
    "You are a voice cooking assistant helping someone cook right now. They may be mid-recipe with messy hands.",
    "Answer in at most 2 short sentences, spoken aloud — no lists, no markdown, no emojis.",
    "Questions about this recipe come first: use the provided context before general knowledge.",
    `Recipe: ${context.title} (serves ${context.servings}).`,
  ];

  if (context.current_step_number !== null) {
    // Current step ± neighbors only — prompt budget (§14.3), not the whole recipe.
    const idx = context.steps.findIndex((s) => s.step_number === context.current_step_number);
    if (idx !== -1) {
      const window = context.steps.slice(Math.max(0, idx - 1), idx + 2);
      parts.push(`Steps around the current position:\n${window.map(stepLine).join("\n")}`);
      parts.push(`The cook is currently on step ${context.current_step_number}.`);
    }
  } else {
    parts.push("The cook has not started a specific step yet.");
  }

  if (context.ingredients.length > 0) {
    parts.push(`Ingredients (scaled for ${context.servings} servings):\n${context.ingredients.join("\n")}`);
  }
  if (context.active_timers.length > 0) {
    parts.push(`Active timers:\n${context.active_timers.map(formatTimer).join("\n")}`);
  }

  const system = parts.join("\n\n");
  // History arrives newest-last from the route; keep only the budgeted window.
  const trimmed = history.slice(-CHAT_HISTORY_TURNS);
  return [{ role: "system", content: system }, ...trimmed, { role: "user", content: userMessage }];
}
