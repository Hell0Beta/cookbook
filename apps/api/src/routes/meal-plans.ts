// Meal planning endpoints — development.md §11 meal-plans surface, §7.2 "Quick
// Add to Meal". Multiple rows per (date, meal_slot) occasion — no Meal grouping
// entity (§3): readers query by occasion and render tabs (design.md §3.3.1).
// Slot resolution itself lives in @cookbook/shared (pure, unit-tested) so the
// Quick Add modal previews exactly what this route persists.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  QuickAddInput,
  MealPlanCreateInput,
  MealPlanEntryUpdate,
  resolveQuickAddTarget,
  parseIsoDate,
  toIsoDate,
  weekRange,
  type MealPlanEntryOut,
  type MealSlot,
} from "@cookbook/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { ApiError } from "../middleware/error.js";

export const mealPlansRouter = Router();
mealPlansRouter.use(requireAuth);

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be yyyy-mm-dd");
const SlotParam = z.enum(["breakfast", "lunch", "dinner", "snack"]);

// ── serialization ────────────────────────────────────────────────────────────

type EntryRow = {
  id: string;
  userId: string;
  date: string;
  mealSlot: string | null;
  recipeId: string;
  servingsPlanned: number;
  scheduledAt: Date | null;
  isUpcomingPin: boolean;
  createdAt: Date;
  recipe: {
    id: string;
    title: string;
    heroImageUrl: string | null;
    baseServings: number;
    totalTimeMinutes: number | null;
    sourceType: string;
  };
};

function serializeEntry(entry: EntryRow): MealPlanEntryOut {
  return {
    id: entry.id,
    user_id: entry.userId,
    date: entry.date,
    meal_slot: entry.mealSlot as MealSlot | null,
    recipe_id: entry.recipeId,
    servings_planned: entry.servingsPlanned,
    scheduled_at: entry.scheduledAt ? entry.scheduledAt.toISOString() : null,
    is_upcoming_pin: entry.isUpcomingPin,
    created_at: entry.createdAt.toISOString(),
    recipe: {
      id: entry.recipe.id,
      title: entry.recipe.title,
      hero_image_url: entry.recipe.heroImageUrl,
      base_servings: entry.recipe.baseServings,
      total_time_minutes: entry.recipe.totalTimeMinutes,
      source_type: entry.recipe.sourceType,
    },
  };
}

const entryInclude = {
  recipe: {
    select: {
      id: true,
      title: true,
      heroImageUrl: true,
      baseServings: true,
      totalTimeMinutes: true,
      sourceType: true,
    },
  },
} as const;

/** Recipes are plannable if they're the caller's own or a shared import. */
async function getPlannableRecipe(id: string, userId: string) {
  const recipe = await prisma.recipe.findUnique({ where: { id } });
  if (!recipe) throw new ApiError(404, "recipe_not_found");
  if (recipe.userId && recipe.userId !== userId) throw new ApiError(403, "forbidden");
  return recipe;
}

/** An entry the caller owns — 404 for missing AND other users' rows alike. */
async function getOwnEntry(id: string, userId: string) {
  const entry = await prisma.mealPlanEntry.findUnique({ where: { id } });
  if (!entry || entry.userId !== userId) throw new ApiError(404, "entry_not_found");
  return entry;
}

// ── POST /meal-plans/quick-add — development.md §7.2 ─────────────────────────
mealPlansRouter.post("/quick-add", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = QuickAddInput.parse(req.body);
    const recipe = await getPlannableRecipe(body.recipe_id, req.userId!);
    const target = resolveQuickAddTarget(body.mode, body, new Date());
    const entry = await prisma.mealPlanEntry.create({
      data: {
        userId: req.userId!,
        date: target.date,
        mealSlot: target.meal_slot,
        recipeId: body.recipe_id,
        // default to the recipe's base servings — the planner can adjust later
        servingsPlanned: recipe.baseServings,
        scheduledAt: target.scheduled_at ? new Date(target.scheduled_at) : null,
        isUpcomingPin: target.is_upcoming_pin,
      },
      include: entryInclude,
    });
    res.status(201).json(serializeEntry(entry));
  } catch (err) {
    next(err);
  }
});

// ── GET /meal-plans/upcoming — Dashboard "Upcoming Recipe" (design.md §3.1 #2).
// Query the flag directly, never infer from date/time (development.md §3); the
// "Right now / #Upcoming" quick-add path can pin several dishes at once.
mealPlansRouter.get("/upcoming", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const entries = await prisma.mealPlanEntry.findMany({
      where: { userId: req.userId, isUpcomingPin: true },
      orderBy: { createdAt: "desc" },
      include: entryInclude,
    });
    res.json(entries.map(serializeEntry));
  } catch (err) {
    next(err);
  }
});

// ── GET /meal-plans/for-slot?date=&slot= — one meal occurrence's dishes,
// driving the Recipe Reader's multi-recipe tabs (design.md §3.3.1).
mealPlansRouter.get("/for-slot", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const date = IsoDate.parse(req.query.date);
    const slot = SlotParam.parse(req.query.slot);
    const entries = await prisma.mealPlanEntry.findMany({
      where: { userId: req.userId, date, mealSlot: slot },
      orderBy: { createdAt: "asc" },
      include: entryInclude,
    });
    res.json(entries.map(serializeEntry));
  } catch (err) {
    next(err);
  }
});

// ── GET /meal-plans?date= / ?week= — base queries (development.md §11): the
// planner's day sidebar (?date=) and calendar body (?week=).
mealPlansRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (typeof req.query.date === "string") {
      const date = IsoDate.parse(req.query.date);
      const entries = await prisma.mealPlanEntry.findMany({
        where: { userId: req.userId, date },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: entryInclude,
      });
      res.json(entries.map(serializeEntry));
      return;
    }
    if (typeof req.query.week === "string") {
      const week = IsoDate.parse(req.query.week);
      const { from, to } = weekRange(week);
      const entries = await prisma.mealPlanEntry.findMany({
        where: { userId: req.userId, date: { gte: from, lte: to } },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
        include: entryInclude,
      });
      res.json(entries.map(serializeEntry));
      return;
    }
    throw new ApiError(400, "date_or_week_required", "Pass ?date=yyyy-mm-dd or ?week=yyyy-mm-dd");
  } catch (err) {
    next(err);
  }
});

// ── POST /meal-plans — direct assignment to a date/slot (drag-and-drop target
// for the Phase 6 planner; development.md §11).
mealPlansRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = MealPlanCreateInput.parse(req.body);
    const recipe = await getPlannableRecipe(body.recipe_id, req.userId!);
    const entry = await prisma.mealPlanEntry.create({
      data: {
        userId: req.userId!,
        date: body.date,
        mealSlot: body.meal_slot ?? null,
        recipeId: body.recipe_id,
        servingsPlanned: body.servings_planned ?? recipe.baseServings,
        isUpcomingPin: body.is_upcoming_pin ?? false,
      },
      include: entryInclude,
    });
    res.status(201).json(serializeEntry(entry));
  } catch (err) {
    next(err);
  }
});

// ── PATCH /meal-plans/:id — reassign/remove support (planner drag-and-drop;
// development.md §11). Supplying date or meal_slot is an explicit placement:
// the entry stops being an "upcoming" pin / custom-time occasion.
mealPlansRouter.patch("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = MealPlanEntryUpdate.parse(req.body);
    await getOwnEntry(req.params.id!, req.userId!);
    const placed = body.date !== undefined || body.meal_slot !== undefined;
    const entry = await prisma.mealPlanEntry.update({
      where: { id: req.params.id },
      data: {
        ...(body.date !== undefined ? { date: body.date } : {}),
        ...(body.meal_slot !== undefined ? { mealSlot: body.meal_slot } : {}),
        ...(body.servings_planned !== undefined ? { servingsPlanned: body.servings_planned } : {}),
        ...(placed ? { isUpcomingPin: false, scheduledAt: null } : {}),
      },
      include: entryInclude,
    });
    res.json(serializeEntry(entry));
  } catch (err) {
    next(err);
  }
});

// ── DELETE /meal-plans/:id — remove a planned dish ────────────────────────────
mealPlansRouter.delete("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    await getOwnEntry(req.params.id!, req.userId!);
    await prisma.mealPlanEntry.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
