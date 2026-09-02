// YouTube extraction pipeline — development.md §5: description + transcript →
// LLM structured extraction → block draft for the create editor (never a
// saved recipe). Fetches are user-initiated imports (§0 allowlist); the only
// LLM is OpenRouter via ./openrouter.ts. Extraction results are cached
// in-process (§5 step 6 allows database OR in-process cache; no Redis per §0).
import { fetchTranscript } from "youtube-transcript";
import {
  LlmRecipeExtraction,
  classifyRoleTag,
  estimateDurationMinutes,
  extractVideoId,
  type IngredientBlock,
  type LlmRecipeExtraction as LlmExtraction,
  type MetaBlock,
  type RecipeBlock,
  type RecipeBlocks,
  type StepBlock,
  type Unit,
} from "@cookbook/shared";
import { prisma } from "../db.js";
import { ApiError } from "../middleware/error.js";
import { ttlCache } from "./cache.js";
import { saveImageFromUrl } from "./image-store.js";
import { llmJson } from "./openrouter.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Prompt budgets — the free-tier model has a small context; the head of each
// source (where recipes are usually written out) matters most.
const MAX_DESCRIPTION_CHARS = 6000;
const MAX_TRANSCRIPT_CHARS = 14000;

// Descriptions that are too short to hold a recipe, even with a transcript
// missing → prompt manual entry (§5 edge case 1).
const MIN_DESCRIPTION_CHARS = 80;

/** LLM unit strings → our Unit enum; anything unmapped keeps null. */
const UNIT_WORDS: Record<string, Unit> = {
  g: "g", gram: "g", grams: "g", gr: "g",
  kg: "kg", kilogram: "kg", kilograms: "kg",
  ml: "ml", milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml",
  l: "l", liter: "l", liters: "l", litre: "l", litres: "l",
  tsp: "tsp", teaspoon: "tsp", teaspoons: "tsp",
  tbsp: "tbsp", tablespoon: "tbsp", tablespoons: "tbsp",
  cup: "cup", cups: "cup",
  oz: "oz", ounce: "oz", ounces: "oz", fl_oz: "oz",
  lb: "lb", lbs: "lb", pound: "lb", pounds: "lb",
  piece: "piece", pieces: "piece", clove: "piece", cloves: "piece", slice: "piece", slices: "piece",
  pinch: "pinch",
};

// §5 step 6: raw extractions cached in-process (24h) so a re-paste doesn't
// re-hit YouTube or the LLM. Server-restart loses it; one re-extraction is
// an acceptable cost at ≤5 users.
const extractionCache = ttlCache<{ language: string | null; blocks: RecipeBlocks }>(
  24 * 60 * 60 * 1000,
  100,
);

export interface YoutubeImportResult {
  video_id: string;
  language: string | null;
  existing_recipe_id: string | null;
  blocks: RecipeBlocks | null;
}

interface VideoMeta {
  title: string | null;
  description: string | null;
}

/**
 * Extract the first balanced JSON object from a script body. The watch page
 * appends other statements after ytInitialPlayerResponse (`;var meta = …`),
 * so slicing to </script> is not enough — scan braces, respecting strings.
 */
function extractJsonObject(source: string): unknown {
  const start = source.indexOf("{");
  if (start === -1) throw new Error("no object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
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
      if (depth === 0) return JSON.parse(source.slice(start, i + 1));
    }
  }
  throw new Error("unbalanced");
}

/** Watch-page scrape: ytInitialPlayerResponse carries title + full description. */
async function scrapeWatchPage(videoId: string): Promise<VideoMeta | null> {
  let html: string;
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  const marker = "ytInitialPlayerResponse = ";
  const start = html.indexOf(marker);
  if (start === -1) return null;
  const scriptBody = html.slice(start + marker.length);
  let playerResponse: {
    videoDetails?: { title?: string; shortDescription?: string };
  };
  try {
    playerResponse = extractJsonObject(scriptBody) as typeof playerResponse;
  } catch {
    return null;
  }
  return {
    title: playerResponse.videoDetails?.title ?? null,
    description: playerResponse.videoDetails?.shortDescription ?? null,
  };
}

/** oEmbed gives the title with no key — fallback when the scrape fails. */
async function oembedTitle(videoId: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    );
    if (!res.ok) return null;
    return ((await res.json()) as { title?: string }).title ?? null;
  } catch {
    return null;
  }
}

async function fetchVideoMeta(videoId: string): Promise<VideoMeta> {
  const scraped = await scrapeWatchPage(videoId);
  if (scraped?.description) return scraped;
  const title = scraped?.title ?? (await oembedTitle(videoId));
  return { title, description: scraped?.description ?? null };
}

async function fetchTranscriptText(
  videoId: string,
): Promise<{ text: string; lang: string | null } | null> {
  try {
    const segments = await fetchTranscript(videoId);
    if (segments.length === 0) return null;
    // Auto-captions repeat/duplicate heavily; collapse runs of identical text.
    const seen: string[] = [];
    for (const s of segments) {
      const t = s.text.trim();
      if (t && seen[seen.length - 1] !== t) seen.push(t);
    }
    return { text: seen.join(" "), lang: segments[0]?.lang ?? null };
  } catch {
    // Disabled / unavailable / no captions — description-only is fine (§5).
    return null;
  }
}

/** development.md §5 step 3's structured-extraction prompt. */
function extractionPrompt(meta: VideoMeta, transcript: string | null) {
  const description = (meta.description ?? "").slice(0, MAX_DESCRIPTION_CHARS);
  const transcriptText = (transcript ?? "").slice(0, MAX_TRANSCRIPT_CHARS);
  return [
    {
      role: "system" as const,
      content:
        "You extract structured recipes from YouTube video content. Return ONLY valid JSON, " +
        'no markdown, matching: {"title": string|null, "servings": integer|null, "language": string|null, ' +
        '"ingredients": [{"name": string, "quantity": number|null, "unit": string|null, "raw_text": string}], ' +
        '"steps": [{"instruction": string, "duration_minutes": integer|null}]}. ' +
        "Use null for any value not present — never invent ingredients or quantities. " +
        "Infer step durations in minutes from timing cues where possible. " +
        "The content may be in any language; extract into English and report the source language in \"language\".",
    },
    {
      role: "user" as const,
      content:
        `Video title: ${meta.title ?? "(unknown)"}\n\n` +
        `DESCRIPTION:\n${description || "(empty)"}\n\n` +
        `TRANSCRIPT:\n${transcriptText || "(no captions)"}\n`,
    },
  ];
}

function mapUnit(unit: string | null | undefined): Unit | null {
  if (!unit) return null;
  return UNIT_WORDS[unit.trim().toLowerCase()] ?? null;
}

/** Extraction JSON → block stack (ids are client-local; rows are created on save). */
function buildBlocks(
  videoId: string,
  meta: VideoMeta,
  extraction: LlmExtraction,
): RecipeBlocks {
  const title = extraction.title?.trim() || meta.title?.trim() || "Imported YouTube recipe";
  return extractionToBlocks(extraction, {
    title,
    description: meta.description ?? null,
    sourceType: "youtube_import",
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    idPrefix: "yt",
  });
}

/**
 * Shared LlmRecipeExtraction → RecipeBlocks mapping (YouTube import and the
 * Discover "Log manually" expansion produce the same extraction contract, so
 * they build blocks the same way). Ids are client-local; rows are created on
 * save.
 */
export function extractionToBlocks(
  extraction: LlmExtraction,
  opts: {
    title: string;
    description: string | null;
    sourceType: MetaBlock["source_type"];
    sourceUrl: string | null;
    idPrefix: string;
    heroImageUrl?: string | null;
  },
): RecipeBlocks {
  const title = opts.title.trim() || "Untitled recipe";

  const ingredients: IngredientBlock[] = extraction.ingredients
    .filter((i) => (i.raw_text ?? i.name).trim().length > 0)
    .map((i, idx) => {
      const rawText = (i.raw_text ?? i.name).trim();
      const unit = mapUnit(i.unit);
      return {
        id: `${opts.idPrefix}-i${idx}`,
        type: "ingredient" as const,
        quantity: i.quantity,
        unit,
        raw_text: rawText,
        ingredient_id: null,
        // §5 step 4: rule-based role classification (LLM pass is a Phase 9+ enhancement)
        role_tag: classifyRoleTag({ name: rawText, quantity: i.quantity, unit }, title),
        swap_suggestions: [],
        sort_order: idx,
      };
    });

  const steps: StepBlock[] = extraction.steps
    .filter((s) => s.instruction.trim().length > 0)
    .map((s, idx) => ({
      id: `${opts.idPrefix}-s${idx}`,
      type: "step" as const,
      step_number: idx + 1,
      instruction_text: s.instruction.trim(),
      duration_minutes: s.duration_minutes ?? estimateDurationMinutes(s.instruction),
      image_url: null,
    }));

  const total = steps.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
  const metaBlock: RecipeBlock = {
    id: "meta",
    type: "meta",
    servings: extraction.servings ?? 4,
    total_time_minutes: total > 0 ? total : null,
    source_type: opts.sourceType,
    source_url: opts.sourceUrl,
  };

  return {
    title,
    description: opts.description ? opts.description.slice(0, 500) : null,
    hero_image_url: opts.heroImageUrl ?? null,
    blocks: [metaBlock, ...ingredients, ...steps],
  };
}

/**
 * Full YouTube import: fetch → LLM extract → validate → block draft.
 * Returns a DRAFT (nothing saved — the user reviews in the create editor,
 * §5 step 5). Re-pasting an already-imported URL short-circuits to the saved
 * recipe's id; repeat extractions within the cache TTL skip YouTube + the LLM.
 */
export async function importYoutubeRecipe(url: string): Promise<YoutubeImportResult> {
  const videoId = extractVideoId(url);
  if (!videoId) throw new ApiError(400, "invalid_youtube_url", "That doesn't look like a YouTube link");
  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  const existing = await prisma.recipe.findFirst({
    where: { sourceType: "youtube_import", sourceUrl: canonicalUrl },
    select: { id: true },
  });
  if (existing) {
    return { video_id: videoId, language: null, existing_recipe_id: existing.id, blocks: null };
  }

  const cached = extractionCache.get(videoId);
  if (cached) {
    return { video_id: videoId, language: cached.language, existing_recipe_id: null, blocks: cached.blocks };
  }

  const [meta, transcript] = await Promise.all([
    fetchVideoMeta(videoId),
    fetchTranscriptText(videoId),
  ]);

  const descriptionLength = (meta.description ?? "").trim().length;
  if (descriptionLength < MIN_DESCRIPTION_CHARS && !transcript) {
    // §5 edge case 1: no captions AND a sparse/no description
    throw new ApiError(
      422,
      "no_recipe_content",
      "This video has no usable description or captions — enter the recipe manually",
    );
  }

  const raw = await llmJson(extractionPrompt(meta, transcript?.text ?? null), { maxTokens: 2048 });
  const parsed = LlmRecipeExtraction.safeParse(raw);
  if (!parsed.success) {
    // §5 step 4: reject, never silently trust a malformed extraction
    throw new ApiError(502, "llm_bad_extraction", "The AI response didn't contain a usable recipe — try again");
  }
  const extraction = parsed.data;
  if (extraction.ingredients.length === 0 && extraction.steps.length === 0) {
    throw new ApiError(
      422,
      "no_recipe_content",
      "No recipe could be found in this video — enter it manually",
    );
  }

  const blocks = buildBlocks(videoId, meta, extraction);
  const hero = await saveImageFromUrl(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
  if (hero) blocks.hero_image_url = hero;

  const language = extraction.language ?? transcript?.lang ?? null;
  extractionCache.set(videoId, { language, blocks });
  return { video_id: videoId, language, existing_recipe_id: null, blocks };
}
