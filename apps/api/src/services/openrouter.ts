// OpenRouter client — development.md §0: the ONLY permitted LLM, model
// nvidia/nemotron-3.5-lightning:free (config-pinned), owner-provided key,
// free tier with daily request limits. Quota exhaustion must surface as
// 429 { error: "llm_quota_exceeded" } so the frontend can show the
// "daily AI requests used up" alert (design.md §5) without breaking core flows.
import { config } from "../config.js";
import { ApiError } from "../middleware/error.js";

const API_URL = "https://openrouter.ai/api/v1/chat/completions";

// Error bodies/messages the free tier returns when the daily budget is gone.
const QUOTA_MARKERS = [
  "quota", "rate limit", "rate_limit", "daily limit", "insufficient",
  "free tier", "credit", "429",
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResult {
  content: string;
}

/** Throws ApiError(429, "llm_quota_exceeded") on daily-limit responses. */
export async function llmComplete(messages: ChatMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<LlmResult> {
  if (!config.openrouter.apiKey) {
    // No key configured → AI features are simply unavailable, never fatal
    // (rule-based paths must work standalone per §6.1).
    throw new ApiError(503, "llm_unavailable", "OPENROUTER_API_KEY is not configured");
  }
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openrouter.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.openrouter.model,
        messages,
        // nemotron is a reasoning model; free-tier responses otherwise dump
        // chain-of-thought into content and truncate before the answer.
        reasoning: { effort: "none", exclude: true },
        max_tokens: opts?.maxTokens ?? 1024,
        temperature: opts?.temperature ?? 0.2,
      }),
    });
  } catch {
    throw new ApiError(502, "llm_request_failed", "Could not reach OpenRouter");
  }

  const body = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: string } }[];
    error?: { message?: string; code?: number } | string;
  } | null;

  if (res.status === 429 || isQuotaError(body)) {
    throw new ApiError(429, "llm_quota_exceeded");
  }
  if (!res.ok) {
    const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
    throw new ApiError(502, "llm_request_failed", detail ?? `OpenRouter returned ${res.status}`);
  }
  const content = body?.choices?.[0]?.message?.content;
  if (!content) throw new ApiError(502, "llm_empty_response");
  return { content };
}

function isQuotaError(body: { error?: { message?: string; code?: number } | string } | null): boolean {
  if (!body?.error) return false;
  const text = (typeof body.error === "string" ? body.error : body.error.message ?? "").toLowerCase();
  return QUOTA_MARKERS.some((m) => text.includes(m));
}

/** First balanced {...} in the text — the free model sometimes rambles after the JSON. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// The free model sometimes emits JS-object-literal syntax instead of JSON.
// Observed shapes (2026-08-31, live): unquoted keys (,summary:"…"), half-
// quoted keys (,summary":), `=` instead of `:` separators, trailing commas,
// and missing brackets (a suggestion object that never closes before `]`).
// All repairs run only on text that already failed JSON.parse, and every
// repaired candidate is re-validated by JSON.parse — a botched repair (e.g.
// quoting a word that sits inside a string value) breaks the parse again and
// is rejected, never silently applied.
function repairJsObjectLiterals(text: string): string {
  return text
    .replace(/([{,]\s*)"?([A-Za-z_][A-Za-z0-9_]*)"?\s*[=:]/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, "$1");
}

/** Stack-based bracket repair: insert missing closers, drop stray ones. */
function repairBrackets(text: string): string {
  const stack: string[] = [];
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      out += ch;
      continue;
    }
    const opener = ch === "}" ? "{" : ch === "]" ? "[" : null;
    if (opener) {
      if (stack.length === 0) continue; // closes nothing — drop it
      if (stack[stack.length - 1] === opener) {
        stack.pop();
        out += ch;
        continue;
      }
      // Mismatched closer: close what the stack expects first, then this one.
      let inserted = "";
      while (stack.length > 0 && stack[stack.length - 1] !== opener) {
        inserted += stack.pop() === "{" ? "}" : "]";
      }
      if (stack.length > 0) {
        stack.pop();
        out += inserted + ch;
      }
      continue; // no matching opener anywhere — drop the stray closer
    }
    out += ch;
  }
  if (inString) out += '"'; // truncated mid-string
  while (stack.length > 0) out += stack.pop() === "{" ? "}" : "]";
  return out;
}

/**
 * Ask the LLM for JSON and parse it. Defensive per development.md §5 step 4:
 * strip markdown fences; if the whole content isn't valid JSON, escalate
 * through repairs — extract the first balanced object (trailing chatter),
 * re-quote JS-literal keys, fix bracket balance. Reject anything else —
 * never silently trust.
 */
export async function llmJson<T>(messages: ChatMessage[], opts?: { maxTokens?: number }): Promise<T> {
  const { content } = await llmComplete(messages, { ...opts, temperature: 0 });
  const stripped = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  // Stage 1: as-is.
  try {
    return JSON.parse(stripped) as T;
  } catch { /* fall through */ }

  // Stages 2-5: increasingly aggressive repairs, each re-validated by parse.
  const keyRepaired = repairJsObjectLiterals(stripped);
  const bracketRepaired = repairBrackets(keyRepaired);
  const candidates = [
    extractFirstJsonObject(stripped),
    keyRepaired,
    extractFirstJsonObject(keyRepaired),
    bracketRepaired,
    extractFirstJsonObject(bracketRepaired),
  ].filter((c): c is string => c !== null);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch { /* try the next stage */ }
  }
  // Log the head of the rejected content — the free model's malformations
  // vary run to run, and this is the only way to spot the next repair shape.
  console.warn(`[llmJson] unparseable response (${content.length} chars):`, content.slice(0, 200));
  throw new ApiError(502, "llm_bad_json", "LLM response was not valid JSON");
}
