// YouTube import shapes — development.md §5, §11 (POST /recipes/import/youtube).
// URL parsing is a pure function so web + api share one recognizer, and the
// LLM output schema lives here so the extraction contract is testable without
// hitting OpenRouter (§0: rule-based code first, LLM defensively validated).
import { z } from "zod";
import { RecipeBlocks } from "./entities.js";

// Accepts watch?v=, youtu.be/<id>, /shorts/<id>, /embed/<id>, /live/<id> and
// bare 11-char video ids. Returns null for anything that isn't YouTube.
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const v = url.searchParams.get("v");
  if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
  const parts = url.pathname.split("/").filter(Boolean);
  const [kind, id] = parts;
  if (id && kind && ["shorts", "embed", "live", "v"].includes(kind)) {
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }
  return null;
}

export const YoutubeImportInput = z.object({
  url: z
    .string()
    .trim()
    .min(1, "paste a YouTube link")
    .refine((u) => extractVideoId(u) !== null, "that doesn't look like a YouTube link"),
});
export type YoutubeImportInput = z.infer<typeof YoutubeImportInput>;

// What the extraction LLM is asked to return (development.md §5 step 3).
// Parsed defensively — every field permissive at the boundary, then narrowed:
// the api maps/filters before building blocks, so a weird value degrades one
// ingredient, never the whole import.
export const LlmRecipeExtraction = z.object({
  title: z.string().nullable().catch(null),
  servings: z.number().int().positive().nullable().catch(null),
  language: z.string().nullable().catch(null),
  ingredients: z
    .array(
      z.object({
        name: z.string().default(""),
        quantity: z.number().nullable().catch(null),
        unit: z.string().nullable().catch(null),
        raw_text: z.string().nullable().catch(null),
      }),
    )
    .max(100)
    .catch([]),
  steps: z
    .array(
      z.object({
        instruction: z.string().default(""),
        duration_minutes: z.number().int().positive().nullable().catch(null),
      }),
    )
    .max(100)
    .catch([]),
});
export type LlmRecipeExtraction = z.infer<typeof LlmRecipeExtraction>;

// POST /recipes/import/youtube response: a DRAFT for the create editor —
// nothing is saved until the user reviews and saves (development.md §5 step 5).
// When this video was already imported, `existing_recipe_id` is set and
// `blocks` is null: the UI opens the saved copy instead of pre-filling a
// duplicate.
export const YoutubeExtractionDraft = z.object({
  video_id: z.string(),
  language: z.string().nullable(),
  existing_recipe_id: z.string().nullable(),
  blocks: RecipeBlocks.nullable(),
});
export type YoutubeExtractionDraft = z.infer<typeof YoutubeExtractionDraft>;
