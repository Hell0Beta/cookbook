// Recipe CRUD + block batch update + scaling (development.md §11).
import { Router, type Request, type Response, type NextFunction } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  RecipeBlocksUpdate,
  scaleIngredients,
  scoreIngredientMatch,
  type RoleTag,
} from "@cookbook/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { ApiError } from "../middleware/error.js";
import { serializeRecipe, deriveTotalTime } from "../recipes/serialize.js";
import { createRecipeFromBlocks, recipeInclude, writeBlocks, metaOf, stepDurationsOf } from "../recipes/persist.js";
import { tagRecipe } from "../services/tagging.js";
import { candidateRecipeIds, invalidateIngredientIndex } from "../services/ingredient-index.js";

export const recipesRouter = Router();
recipesRouter.use(requireAuth);

async function getOwnRecipe(id: string, userId: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { id },
    include: recipeInclude(),
  });
  if (!recipe) throw new ApiError(404, "recipe_not_found");
  // Private per-user library; userId-null recipes are shared imports.
  if (recipe.userId && recipe.userId !== userId) {
    throw new ApiError(403, "forbidden");
  }
  return recipe;
}

// ── POST /recipes — manual create (development.md §11) ───────────────────────
recipesRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = RecipeBlocksUpdate.parse(req.body);
    const created = await createRecipeFromBlocks(req.userId ?? null, body);
    await tagRecipe(created!.id); // §6: every save passes through the engine
    const fresh = await prisma.recipe.findUnique({ where: { id: created!.id }, include: recipeInclude() });
    res.status(201).json({ id: fresh!.id, ...serializeRecipe(fresh!) });
  } catch (err) {
    next(err);
  }
});

// ── GET /recipes?tags=&q=&ingredients=&page= — combined filter query
// (development.md §9, §11), paginated (the 13.5k dataset made whole-list
// responses untenable). Includes shared imports (userId null) alongside the
// caller's own recipes. With ?ingredients= (comma-separated master Ingredient
// ids), results carry match-score + missing-ingredient data and are ranked by
// matched_main / total_main. ─────────────────────────────────────────────────
const PAGE_SIZE = 24;

function csvParam(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pageOf(query: unknown): number {
  const n = typeof query === "string" ? Number(query) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

recipesRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const tagIds = csvParam(req.query.tags);
    const ingredientIds = csvParam(req.query.ingredients);
    const page = pageOf(req.query.page);
    const scoring = ingredientIds.length > 0;

    const where: Prisma.RecipeWhereInput = { OR: [{ userId: req.userId }, { userId: null }] };
    // Selected tags combine with AND — picking "Dinner" + "Vegetarian" narrows.
    if (tagIds.length > 0) {
      where.AND = tagIds.map((id) => ({ tags: { some: { tagId: id } } }));
    }

    const summarySelect = {
      id: true,
      title: true,
      heroImageUrl: true,
      baseServings: true,
      totalTimeMinutes: true,
      sourceType: true,
    } as const;

    // Candidate narrowing via the in-memory inverted index (§9 step 1). The
    // pantry's canonical names also feed name-based matching so manual recipes
    // (no linked master rows) stay searchable.
    if (!scoring) {
      const whereQ: Prisma.RecipeWhereInput = q
        ? { ...where, title: { contains: q } }
        : where;
      // Prisma-side substring + pagination — no full-table reads.
      const [total, rows] = await Promise.all([
        prisma.recipe.count({ where: whereQ }),
        prisma.recipe.findMany({
          where: whereQ,
          orderBy: { updatedAt: "desc" },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE,
          select: summarySelect,
        }),
      ]);
      res.json({
        items: rows.map(summaryOf),
        total,
        page,
        page_size: PAGE_SIZE,
        has_more: page * PAGE_SIZE < total,
      });
      return;
    }

    const ingredientIdsSet = new Set(ingredientIds);
    const masters = await prisma.ingredient.findMany({
      where: { id: { in: ingredientIds } },
      select: { id: true, canonicalName: true },
    });
    const haveNames = masters.map((m) => m.canonicalName);
    const candidates = await candidateRecipeIds(
      masters.map((m) => m.id),
      haveNames,
    );
    if (candidates.size === 0) {
      res.json({ items: [], total: 0, page, page_size: PAGE_SIZE, has_more: false });
      return;
    }
    where.id = { in: [...candidates] };

    const recipes = await prisma.recipe.findMany({
      where: {
        ...where,
        ...(q ? { title: { contains: q } } : {}),
      },
      orderBy: { updatedAt: "desc" },
      select: {
        ...summarySelect,
        ingredients: {
          select: {
            ingredientId: true,
            rawText: true,
            roleTag: true,
            sortOrder: true,
            ingredient: { select: { canonicalName: true } },
          },
        },
      },
    });

    const scored = recipes
      .map((r) => ({
        recipe: r,
        match: scoreIngredientMatch(
          r.ingredients
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((i) => ({
              ingredient_id: i.ingredientId,
              name: i.ingredient?.canonicalName ?? i.rawText,
              role_tag: i.roleTag as RoleTag,
            })),
          { ingredient_ids: ingredientIdsSet, names: haveNames },
        ),
      }))
      // Only recipes the pantry actually touches — a 0-match long tail is noise.
      .filter(({ match }) => match.matched_main > 0)
      .sort(
        (a, b) =>
          b.match.match_score - a.match.match_score ||
          a.match.missing.length - b.match.missing.length ||
          a.recipe.title.localeCompare(b.recipe.title),
      );

    // Ingredient-mode pagination happens after scoring (rank order must be
    // global). The candidate set is bounded by the inverted index already.
    const total = scored.length;
    const pageRows = scored.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    res.json({
      items: pageRows.map(({ recipe: r, match }) => ({
        ...summaryOf(r),
        match_score: match.match_score,
        matched_main: match.matched_main,
        total_main: match.total_main,
        missing_ingredients: match.missing,
      })),
      total,
      page,
      page_size: PAGE_SIZE,
      has_more: page * PAGE_SIZE < total,
    });
  } catch (err) {
    next(err);
  }
});

function summaryOf(r: {
  id: string;
  title: string;
  heroImageUrl: string | null;
  baseServings: number;
  totalTimeMinutes: number | null;
  sourceType: string;
}) {
  return {
    id: r.id,
    title: r.title,
    hero_image_url: r.heroImageUrl,
    base_servings: r.baseServings,
    total_time_minutes: r.totalTimeMinutes,
    source_type: r.sourceType,
  };
}

// ── GET /recipes/favorites — the Meal Planner's "Saved & Favorited" sidebar
// (development.md §11). Registered before /:id so "favorites" can't be read
// as an id (same ordering rule as /recipes/import above).
recipesRouter.get("/favorites", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recipes = await prisma.recipe.findMany({
      where: { favorites: { some: { userId: req.userId } } },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        title: true,
        heroImageUrl: true,
        baseServings: true,
        totalTimeMinutes: true,
        sourceType: true,
      },
    });
    res.json(
      recipes.map((r) => ({
        id: r.id,
        title: r.title,
        hero_image_url: r.heroImageUrl,
        base_servings: r.baseServings,
        total_time_minutes: r.totalTimeMinutes,
        source_type: r.sourceType,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ── POST / DELETE /recipes/:id/favorite — star toggle (development.md §11).
// POST is idempotent (upsert); DELETE of a non-favorite is a no-op 204.
recipesRouter.post("/:id/favorite", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recipe = await getOwnRecipe(req.params.id!, req.userId!);
    await prisma.favorite.upsert({
      where: { userId_recipeId: { userId: req.userId!, recipeId: recipe.id } },
      create: { userId: req.userId!, recipeId: recipe.id },
      update: {},
    });
    res.status(201).json({ id: recipe.id, favorited: true });
  } catch (err) {
    next(err);
  }
});

recipesRouter.delete("/:id/favorite", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.favorite.deleteMany({
      where: { userId: req.userId!, recipeId: req.params.id },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── GET /recipes/:id ──────────────────────────────────────────────────────────
recipesRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const recipe = await getOwnRecipe(req.params.id!, req.userId!);
    res.json(serializeRecipe(recipe));
  } catch (err) {
    next(err);
  }
});

// ── PUT /recipes/:id and PUT /recipes/:id/blocks — batch block update ─────────
// development.md §7.1: one request on save/blur, not one per keystroke.
async function putBlocks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = RecipeBlocksUpdate.parse(req.body);
    const existing = await getOwnRecipe(req.params.id!, req.userId!);
    await prisma.$transaction(async (tx) => {
      await tx.recipe.update({
        where: { id: existing.id },
        data: {
          title: body.title,
          description: body.description,
          heroImageUrl: body.hero_image_url,
          totalTimeMinutes: deriveTotalTime(stepDurationsOf(body)),
          ...(metaOf(body)
            ? {
                baseServings: metaOf(body)!.servings,
                sourceType: metaOf(body)!.source_type,
                sourceUrl: metaOf(body)!.source_url,
              }
            : {}),
        },
      });
      await writeBlocks(tx, existing.id, body);
    });
    await tagRecipe(existing.id); // re-tag on edit (§6.5 idempotent)
    const updated = await prisma.recipe.findUnique({ where: { id: existing.id }, include: recipeInclude() });
    res.json({ id: updated!.id, ...serializeRecipe(updated!) });
  } catch (err) {
    next(err);
  }
}

recipesRouter.put("/:id", putBlocks);
recipesRouter.put("/:id/blocks", putBlocks);

// ── DELETE /recipes/:id ───────────────────────────────────────────────────────
recipesRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnRecipe(req.params.id!, req.userId!);
    await prisma.recipe.delete({ where: { id: req.params.id } });
    invalidateIngredientIndex(); // cascaded RecipeIngredient rows left the index
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── GET /recipes/:id/scale?servings=6 — scaled ingredient list (§11) ─────────
recipesRouter.get("/:id/scale", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const servings = z.coerce.number().int().positive().max(100).parse(req.query.servings);
    const recipe = await getOwnRecipe(req.params.id!, req.userId!);
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
    res.json({
      recipe_id: recipe.id,
      base_servings: recipe.baseServings,
      target_servings: servings,
      ingredients: scaled.map((ing) => ({
        raw_text: ing.raw_text,
        quantity: ing.scaled.quantity,
        display: ing.scaled.display,
        approximate: ing.scaled.approximate,
        unit: ing.unit,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /recipes/:id/cooked — cooking-mode open signal (development.md §10:
// "track when a meal-planned recipe is actually opened in cooking mode").
// Fire-and-forget from the reader; idempotent-ish (one row per open, the
// ranking window dedupes by recency). Powers Tier 1's cooked-recency signal.
recipesRouter.post("/:id/cooked", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnRecipe(req.params.id!, req.userId!);
    await prisma.cookedEvent.create({
      data: { userId: req.userId!, recipeId: req.params.id! },
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── helpers ───────────────────────────────────────────────────────────────────
// (metaOf / stepDurationsOf / writeBlocks live in recipes/persist.ts, shared
// with the import pipeline.)
