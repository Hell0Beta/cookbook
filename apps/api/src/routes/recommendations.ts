// GET /recommendations/internal, GET /recommendations/discover
// (development.md §11, §10). Tier 1 ranking logic is the pure shared
// function; discover logic (the local-dataset selector service) hangs off
// the same router.
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import {
  DietProfileInput,
  rankInternalRecommendations,
  type CookedSignal,
  type InternalRecommendationsResponse,
  type RecommendationCandidate,
} from "@cookbook/shared";
import { getDiscoverForUser } from "../services/discover.js";

export const recommendationsRouter = Router();
recommendationsRouter.use(requireAuth);

// Tier 1 — deterministic (development.md §10). Library filtered by the user's
// DietProfile, ranked by cooked-recency similarity / cuisine / newness. Zero
// LLM calls.
// Candidate bound (perf, 2026-09-01): the dataset made the library 13.5k
// recipes — hydrating every candidate's ingredient rows took ~24s per
// dashboard load. Rank the user's OWN library in full (personal libraries are
// small) plus a bounded window of shared recipes; "Suggested for you" only
// surfaces a handful, so a 500-recipe shared sample loses nothing.
const SHARED_CANDIDATE_LIMIT = 500;

recommendationsRouter.get("/internal", async (req, res, next) => {
  try {
    const [profile, own, shared, cooked] = await Promise.all([
      prisma.dietProfile.findUnique({ where: { userId: req.userId! } }),
      prisma.recipe.findMany({
        where: { userId: req.userId },
        include: { ingredients: { select: { rawText: true } } },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.recipe.findMany({
        where: { userId: null },
        include: { ingredients: { select: { rawText: true } } },
        orderBy: { updatedAt: "desc" },
        take: SHARED_CANDIDATE_LIMIT,
      }),
      prisma.cookedEvent.findMany({
        where: { userId: req.userId!, cookedAt: { gte: new Date(Date.now() - 45 * 86_400_000) } },
        include: { recipe: { include: { ingredients: { select: { rawText: true } } } } },
        orderBy: { cookedAt: "desc" },
      }),
    ]);
    const candidates = [...own, ...shared];

    const rankProfile = profile
      ? {
          diet_types: DietProfileInput.shape.diet_types.parse(JSON.parse(profile.dietTypes)),
          allergies: JSON.parse(profile.allergies) as string[],
          excluded_ingredients: JSON.parse(profile.excludedIngredients) as string[],
          preferred_cuisines: JSON.parse(profile.preferredCuisines) as string[],
        }
      : null;

    const recs = rankInternalRecommendations(
      candidates.map((r): RecommendationCandidate => ({
        recipe_id: r.id,
        title: r.title,
        hero_image_url: r.heroImageUrl,
        cuisine: r.cuisine,
        diet_tags: JSON.parse(r.dietTags) as string[],
        ingredient_text: r.ingredients.map((i) => i.rawText),
        updated_at: r.updatedAt.toISOString(),
      })),
      rankProfile,
      cooked.map((c): CookedSignal => ({
        recipe_id: c.recipeId,
        cooked_at: c.cookedAt.toISOString(),
        cuisine: c.recipe.cuisine,
        ingredient_text: c.recipe.ingredients.map((i) => i.rawText),
      })),
    );

    const response: InternalRecommendationsResponse = {
      recommendations: recs,
      profile_configured: profile !== null,
    };
    res.json(response);
  } catch (err) {
    next(err);
  }
});

// Tier 2 — "Discover" from the local dataset (development.md §10, revised):
// ~24h refresh selects profile-matching dataset recipes; no LLM call, no
// network — can never fail for quota reasons.
recommendationsRouter.get("/discover", async (req, res, next) => {
  try {
    res.json(await getDiscoverForUser(req.userId!));
  } catch (err) {
    next(err);
  }
});
