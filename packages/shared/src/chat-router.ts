// Intent router — development.md §14.2. A PURE function run client-side before
// anything is sent: recipe-bound intents (step control, ingredient lookup,
// timer control) resolve locally with zero server round-trips and zero LLM
// quota; everything else falls through to the LLM turn. The router saves
// quota and latency — it never gatekeeps: an unrecognized query falls through
// (`{ intent: "llm" }`), and ambiguous matches err toward the LLM.
import { scaleIngredients } from "./scaling.js";
import type { Unit } from "./entities.js";
import type { ActiveTimerContext } from "./chat.js";

// ── context types ────────────────────────────────────────────────────────────

export interface RouterStep {
  id: string;
  step_number: number;
  instruction_text: string;
  duration_minutes: number | null;
}

export interface RouterIngredient {
  raw_text: string;
  quantity: number | null;
  unit: Unit | null;
}

export interface RouterContext {
  recipe_title: string;
  base_servings: number;
  /** Servings the client is currently rendering (§8.1 scaling). */
  servings: number;
  steps: RouterStep[];
  ingredients: RouterIngredient[];
  current_step_number: number | null;
  active_timers: ActiveTimerContext[];
}

// ── results ──────────────────────────────────────────────────────────────────
// `reply` is what gets spoken/shown/persisted; the accompanying fields are the
// action the client executes against the reader + timer store (§14.2).

export type StepAction = "next" | "previous" | "repeat" | "goto";

export type CookingIntent =
  | { intent: "step_control"; action: StepAction; step_number: number | null; reply: string }
  | { intent: "ingredient_lookup"; reply: string }
  | { intent: "timer"; action: "start" | "status"; duration_seconds: number | null; reply: string }
  | { intent: "llm" };

// ── helpers ──────────────────────────────────────────────────────────────────

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "") // "what's" → "whats" — apostrophes never carry meaning here
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(text: string): number {
  return text.split(" ").filter(Boolean).length;
}

function stepReply(s: RouterStep): string {
  return `Step ${s.step_number}: ${s.instruction_text}`;
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds % 60 === 0 && totalSeconds >= 60) {
    const m = totalSeconds / 60;
    return `${m} minute${m === 1 ? "" : "s"}`;
  }
  if (totalSeconds >= 60) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m} minute${m === 1 ? "" : "s"} ${s} second${s === 1 ? "" : "s"}`;
  }
  return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
}

// "set a timer for 5 minutes" → 300. Returns null when no number is present.
function parseDurationSeconds(text: string): number | null {
  const re = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|minutes?|mins?|m\b|seconds?|secs?|s\b)?/;
  const m = re.exec(text);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (m[2] ?? "m").trim(); // bare number ("timer for 5") = minutes
  if (unit.startsWith("h")) return Math.round(value * 3600);
  if (unit.startsWith("s")) return Math.round(value);
  return Math.round(value * 60);
}

/** Significant query words for ingredient matching (stopwords out). */
const STOPWORDS = new Set([
  "how", "much", "many", "of", "the", "a", "an", "do", "i", "need", "should",
  "use", "is", "are", "there", "in", "for", "recipe", "this", "me", "again",
  "please", "and", "what", "about", "much's",
]);

function significantWords(text: string): string[] {
  return text.split(" ").filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

/**
 * Find the ingredient a "how much X?" query refers to. Word-overlap matching
 * (any significant query word appearing in the raw text) — kitchen vocabulary
 * is small and the penalty for falling through to the LLM is just one quota
 * unit, so prefer recall over precision.
 */
function matchIngredient(query: string, ingredients: RouterIngredient[]): RouterIngredient | null {
  const words = significantWords(query);
  if (words.length === 0) return null;
  for (const word of words) {
    const hit = ingredients.find((i) => i.raw_text.toLowerCase().includes(word));
    if (hit) return hit;
  }
  return null;
}

// Bare-keyword step commands only count as such when the utterance is short —
// "what should I make next time?" is a general question, not "next".
const BARE_COMMAND_MAX_WORDS = 5;

// ── the router ───────────────────────────────────────────────────────────────

export function routeCookingIntent(rawText: string, ctx: RouterContext): CookingIntent {
  const text = normalize(rawText);
  if (!text) return { intent: "llm" };

  const currentIdx =
    ctx.current_step_number === null
      ? -1
      : ctx.steps.findIndex((s) => s.step_number === ctx.current_step_number);
  const current = currentIdx >= 0 ? ctx.steps[currentIdx] : undefined;

  // ── timer control (explicit "timer"/"time left" vocabulary) ───────────────

  if (/\b(set|start|put on|put)\b.*\btimer\b/.test(text) || /^timer\b/.test(text)) {
    const seconds = parseDurationSeconds(text);
    if (seconds !== null) {
      return { intent: "timer", action: "start", duration_seconds: seconds, reply: `Timer set — ${formatDuration(seconds)}.` };
    }
    // "start the timer" with no duration: the current step's own duration, if
    // it has one — otherwise fall through to the LLM rather than guess.
    if (current?.duration_minutes && current.duration_minutes > 0) {
      const seconds = current.duration_minutes * 60;
      return { intent: "timer", action: "start", duration_seconds: seconds, reply: `Timer set — ${formatDuration(seconds)} for step ${current.step_number}.` };
    }
    return { intent: "llm" };
  }

  // Timer status: only when the query explicitly references time REMAINING —
  // "how long do I cook the pasta" is a general question, not a status check.
  const asksTimeLeft =
    /\bhow (long|much time)\b.*\bleft\b/.test(text) ||
    /\btime left\b/.test(text) ||
    /\bhow much longer\b/.test(text) ||
    /\bhow long (until|till)\b/.test(text);
  if (asksTimeLeft) {
    const running = ctx.active_timers.filter((t) => t.remaining_seconds > 0);
    if (running.length === 0) {
      return { intent: "timer", action: "status", duration_seconds: null, reply: "No timers running." };
    }
    const summary = running.map((t) => `${formatDuration(t.remaining_seconds)} on ${t.label}`).join(", ");
    return { intent: "timer", action: "status", duration_seconds: null, reply: `${running.length === 1 ? "There's" : "There are"} ${summary}.` };
  }

  // ── step control ──────────────────────────────────────────────────────────

  const gotoMatch = /\bstep\s+(\d+)/.exec(text);
  if (gotoMatch) {
    const n = Number(gotoMatch[1]);
    const target = ctx.steps.find((s) => s.step_number === n);
    if (target) {
      return { intent: "step_control", action: "goto", step_number: n, reply: stepReply(target) };
    }
    return {
      intent: "step_control",
      action: "goto",
      step_number: null,
      reply: ctx.steps.length > 0 ? `There are only ${ctx.steps.length} steps in this recipe.` : "This recipe has no steps.",
    };
  }

  if (wordCount(text) <= BARE_COMMAND_MAX_WORDS) {
    if (/^(next|whats next|what is next|continue|keep going|go on)$/.test(text)) {
      // currentIdx is -1 before the first step, so steps[0] is correctly "next".
      const next = ctx.steps[currentIdx + 1];
      if (next) {
        return { intent: "step_control", action: "next", step_number: next.step_number, reply: stepReply(next) };
      }
      return { intent: "step_control", action: "next", step_number: null, reply: "You're on the last step." };
    }
    if (/^(repeat( that| it| the step)?|again|say that again|what was that|what does it say|read (that|it|the step)( again)?)$/.test(text)) {      if (current) {
        return { intent: "step_control", action: "repeat", step_number: current.step_number, reply: stepReply(current) };
      }
      const first = ctx.steps[0];
      return first
        ? { intent: "step_control", action: "repeat", step_number: first.step_number, reply: stepReply(first) }
        : { intent: "step_control", action: "repeat", step_number: null, reply: "This recipe has no steps." };
    }
    if (/^(back|go back|previous|previous step|last step|go back a step)$/.test(text)) {
      const prev = currentIdx > 0 ? ctx.steps[currentIdx - 1] : undefined;
      if (prev) {
        return { intent: "step_control", action: "previous", step_number: prev.step_number, reply: stepReply(prev) };
      }
      return { intent: "step_control", action: "previous", step_number: null, reply: "You're at the first step." };
    }
  }

  // ── ingredient lookup ─────────────────────────────────────────────────────

  if (/^(how much|how many)\b/.test(text)) {
    const query = text.replace(/^(how much|how many)\b/, "").trim();
    const hit = matchIngredient(query, ctx.ingredients);
    if (hit) {
      if (hit.quantity === null) {
        return { intent: "ingredient_lookup", reply: `${hit.raw_text} — no fixed amount, it's to taste.` };
      }
      const [scaled] = scaleIngredients([hit], ctx.base_servings, ctx.servings);
      if (!scaled) return { intent: "llm" }; // unreachable for a 1-element input
      const unit = hit.unit && hit.unit !== "piece" ? ` ${hit.unit}` : "";
      return {
        intent: "ingredient_lookup",
        reply: `${scaled.scaled.approximate ? "About " : ""}${scaled.scaled.display}${unit} of ${hit.raw_text} for ${ctx.servings} servings.`,
      };
    }
    // No ingredient matched — fail soft to the LLM (§14.2).
    return { intent: "llm" };
  }

  // Everything else — substitutions, technique, general cooking questions —
  // is an LLM turn (owner decision: general questions in scope).
  return { intent: "llm" };
}
