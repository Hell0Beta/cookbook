// Discover — Tier 2 suggestions drawn from the LOCAL dataset (development.md
// §10, revised 2026-09-01: the LLM refresh was replaced by selecting
// profile-matching dataset recipes; zero network, zero quota). Suggestion
// rows persist per user with the same ~24h cadence and wholesale-replacement
// semantics; each carries recipe_id so the card links to the full recipe.
import { prisma } from "../db.js";
import {
  DISCOVER_REFRESH_MS,
  type DiscoverResponse,
  type DiscoverSuggestionOut,
  type RankProfile,
} from "@cookbook/shared";

// How many dataset recipes each refresh surfaces (card grid is 2-wide).
const DISCOVER_COUNT = 6;

// Scan-window bound (perf, 2026-09-01): hydrating ingredient rows for the
// whole 13.5k dataset took seconds per refresh. The window is placed at a
// RANDOM offset each refresh, so every part of the dataset rotates through
// Discover over time instead of only the first N rows.
const CANDIDATE_LIMIT = 1000;

// Concurrent-refresh guard: two dashboard loads in the same tick share one
// in-flight refresh promise instead of double-running the selector.
const inflight = new Map<string, Promise<void>>();

/**
 * Serve Discover for a user — refreshes (dataset selection, no LLM) when the
 * newest row is older than DISCOVER_REFRESH_MS, then returns whatever rows
 * are persisted. Never throws for selection reasons.
 */
export async function getDiscoverForUser(userId: string): Promise<DiscoverResponse> {
  if (await needsRefresh(userId)) {
    let refresh = inflight.get(userId);
    if (!refresh) {
      refresh = runRefresh(userId).finally(() => inflight.delete(userId));
      inflight.set(userId, refresh);
    }
    await refresh.catch(() => {}); // refresh failures keep existing rows
  }

  const rows = await prisma.discoverSuggestion.findMany({
    where: { userId },
    orderBy: { generatedAt: "desc" },
  });

  const suggestions: DiscoverSuggestionOut[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    why_recommended: r.whyRecommended,
    recipe_id: r.recipeId,
    image_url: r.imageUrl,
  }));
  return {
    suggestions,
    quota_exhausted: false, // no LLM in this path anymore — always false
    refreshed_at: rows[0]?.generatedAt.toISOString() ?? null,
  };
}

async function needsRefresh(userId: string): Promise<boolean> {
  const newest = await prisma.discoverSuggestion.findFirst({
    where: { userId },
    orderBy: { generatedAt: "desc" },
    select: { generatedAt: true },
  });
  return !newest || Date.now() - newest.generatedAt.getTime() >= DISCOVER_REFRESH_MS;
}

/** Never-rejecting wrapper — selection failures degrade to existing rows. */
async function runRefresh(userId: string): Promise<void> {
  try {
    await refreshDiscoverSuggestions(userId);
  } catch (err) {
    console.warn("[discover] refresh failed; keeping existing suggestions:", err);
  }
}

/**
 * Why-recommendation strings — rule-based per §0 (the LLM pass is gone, so
 * the copy must be derivable from data we actually have).
 */
function whyFor(
  r: { dietTags: string; cuisine: string | null; totalTimeMinutes: number | null },
  profile: RankProfile | null,
): string {
  const reasons: string[] = [];
  const diets = JSON.parse(r.dietTags) as string[];
  if (profile && profile.preferred_cuisines.length > 0 && r.cuisine) {
    const match = profile.preferred_cuisines.find((c) => r.cuisine!.toLowerCase().includes(c.toLowerCase()));
    if (match) reasons.push(`matches your love of ${r.cuisine} food`);
  }
  const diet = diets.find((d) => profile?.diet_types.includes(d as never));
  if (diet) reasons.push(`fits your ${diet} diet`);
  if (reasons.length === 0) {
    if (r.totalTimeMinutes !== null && r.totalTimeMinutes <= 45) reasons.push("ready in under 45 minutes");
    else reasons.push("from your offline recipe library");
  }
  return reasons[0]!;
}

/**
 * Deterministic daily rotation: seed the PRNG from the date + user id so the
 * same day serves the same shuffle to the same user (accordion re-opens,
 * phone + desktop agree) but every day differs. xorshift32 — no deps.
 */
function seededShuffle<T>(items: T[], seed: number): T[] {
  let state = seed || 1;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

async function refreshDiscoverSuggestions(userId: string): Promise<void> {
  const [profile, cooked, saved] = await Promise.all([
    prisma.dietProfile.findUnique({ where: { userId } }),
    prisma.cookedEvent.findMany({
      where: { userId },
      orderBy: { cookedAt: "desc" },
      take: 30,
      select: { recipeId: true },
    }),
    prisma.recipe.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { id: true },
    }),
  ]);

  const rankProfile: RankProfile | null = profile
    ? {
        diet_types: JSON.parse(profile.dietTypes),
        allergies: JSON.parse(profile.allergies),
        excluded_ingredients: JSON.parse(profile.excludedIngredients),
        preferred_cuisines: JSON.parse(profile.preferredCuisines),
      }
    : null;

  const excludeIds = new Set<string>([
    ...cooked.map((c) => c.recipeId),
    ...saved.map((r) => r.id),
  ]);

  // Dataset candidates — shared (userId null) dataset recipes only, from a
  // random scan window (see CANDIDATE_LIMIT). Filtered by profile hard
  // constraints (allergies/exclusions via ingredient text, diet via the
  // tagging engine's diet tags), then scored.
  const datasetCount = await prisma.recipe.count({
    where: { sourceType: "dataset", userId: null },
  });
  const skip = datasetCount > CANDIDATE_LIMIT
    ? Math.floor(Math.random() * (datasetCount - CANDIDATE_LIMIT))
    : 0;
  const candidates = await prisma.recipe.findMany({
    where: { sourceType: "dataset", userId: null },
    select: {
      id: true,
      title: true,
      description: true,
      heroImageUrl: true,
      cuisine: true,
      dietTags: true,
      totalTimeMinutes: true,
      ingredients: { select: { rawText: true } },
    },
    orderBy: { createdAt: "asc" },
    skip,
    take: CANDIDATE_LIMIT,
  });

  const filtered = candidates.filter((r) => {
    if (excludeIds.has(r.id)) return false;
    if (!rankProfile) return true;
    const text = r.ingredients.map((i) => i.rawText).join(" ").toLowerCase();
    // Hard filters only — cuisine/diet are soft (scoring handles preference).
    if (rankProfile.allergies.some((a) => text.includes(a.toLowerCase()))) return false;
    if (rankProfile.excluded_ingredients.some((x) => text.includes(x.toLowerCase()))) return false;
    return true;
  });

  // Soft scoring: cuisine preference + diet match, then deterministic daily
  // shuffle among equals.
  const scoreOf = (r: (typeof candidates)[number]) => {
    let score = 0;
    if (rankProfile) {
      if (r.cuisine && rankProfile.preferred_cuisines.some((c) => r.cuisine!.toLowerCase().includes(c.toLowerCase()))) score += 2;
      const diets = JSON.parse(r.dietTags) as string[];
      if (diets.some((d) => rankProfile.diet_types.includes(d as never))) score += 2;
    }
    return score;
  };
  const byScore = new Map<number, typeof candidates>();
  for (const r of filtered) {
    const s = scoreOf(r);
    const bucket = byScore.get(s) ?? [];
    bucket.push(r);
    byScore.set(s, bucket);
  }

  const day = Math.floor(Date.now() / DISCOVER_REFRESH_MS);
  const seed = hashString(`${day}:${userId}`);
  // Highest-score bucket first; each bucket is shuffled with the daily seed.
  const ordered = [...byScore.entries()]
    .sort((a, b) => b[0] - a[0])
    .flatMap(([, bucket]) => seededShuffle(bucket, seed));
  const picked = ordered.slice(0, DISCOVER_COUNT);

  const generatedAt = new Date();
  // Dataset rows carry description: null — build the summary from the first
  // instruction line before the transaction (mixed sync/async would tangle).
  const withSummaries = await Promise.all(
    picked.map(async (r) => ({
      ...r,
      summary: (r.description ?? (await firstStepPreview(r.id))).slice(0, 400),
    })),
  );
  await prisma.$transaction([
    prisma.discoverSuggestion.deleteMany({ where: { userId } }),
    ...withSummaries.map((r) =>
      prisma.discoverSuggestion.create({
        data: {
          userId,
          title: r.title,
          summary: r.summary,
          whyRecommended: capitalize(whyFor(r, rankProfile)),
          imageUrl: r.heroImageUrl,
          recipeId: r.id,
          generatedAt,
        },
      }),
    ),
  ]);
}

/** First instruction line, fetched lazily only when description is null. */
const stepPreviewCache = new Map<string, string>();
async function firstStepPreview(recipeId: string): Promise<string> {
  const cached = stepPreviewCache.get(recipeId);
  if (cached) return cached;
  const step = await prisma.recipeStep.findFirst({
    where: { recipeId },
    orderBy: { stepNumber: "asc" },
    select: { instructionText: true },
  });
  const preview = (step?.instructionText ?? "A recipe from your offline library.").slice(0, 400);
  stepPreviewCache.set(recipeId, preview);
  return preview;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
