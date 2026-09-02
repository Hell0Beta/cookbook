// Grocery list generation + management (development.md §8.2, §11).
// The aggregation math itself lives in @cookbook/shared (integrations-owned);
// this route scales ingredients exactly, calls the pure aggregator, persists,
// and serves the result. One active list per user — generating a new one
// archives the previous.
import { Router, type Request, type Response, type NextFunction } from "express";
import {
  aggregateGroceryList,
  formatQuantity,
  ingredientCategory,
  normalizeIngredientName,
  CATEGORY_ORDER,
  CreateGroceryListInput,
  GroceryItemPatchInput,
  ManualGroceryItemInput,
  type GroceryCategory,
  type GroceryEntry,
  type RoleTag,
  type Unit,
} from "@cookbook/shared";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { ApiError } from "../middleware/error.js";

export const groceryListsRouter = Router();
groceryListsRouter.use(requireAuth);

type ListItem = {
  id: string;
  label: string | null;
  ingredientId: string | null;
  aggregatedQuantity: number | null;
  unit: string | null;
  category: string;
  isPurchased: boolean;
  sourceRecipeIds: string;
};

function serializeItem(item: ListItem) {
  const quantity = item.aggregatedQuantity;
  const unit = (item.unit as Unit | null) ?? null;
  const formatted =
    quantity !== null ? formatQuantity(quantity, unit) : { display: "", approximate: false };
  const recipeIds = JSON.parse(item.sourceRecipeIds) as string[];
  return {
    id: item.id,
    label: item.label ?? "",
    ingredient_id: item.ingredientId,
    quantity,
    unit,
    display: formatted.display,
    approximate: formatted.approximate,
    category: item.category as GroceryCategory,
    is_purchased: item.isPurchased,
    source_recipe_ids: recipeIds,
    recipe_count: new Set(recipeIds).size,
  };
}

function serializeList(list: { id: string; name: string; status: string; createdAt: Date; items: ListItem[] }) {
  const categoryIndex = (c: string) => CATEGORY_ORDER.indexOf(c as GroceryCategory);
  return {
    id: list.id,
    name: list.name,
    status: list.status,
    created_at: list.createdAt.toISOString(),
    items: list.items
      .slice()
      .sort((a, b) => categoryIndex(a.category) - categoryIndex(b.category) || (a.label ?? "").localeCompare(b.label ?? ""))
      .map(serializeItem),
  };
}

async function getOwnList(id: string, userId: string) {
  const list = await prisma.groceryList.findUnique({ where: { id }, include: { items: true } });
  if (!list) throw new ApiError(404, "grocery_list_not_found");
  if (list.userId !== userId) throw new ApiError(403, "forbidden");
  return list;
}

// ── POST /grocery-lists — generate from selected recipes (§8.2, §11) ────────
// mode "replace" archives the active list and creates a fresh one;
// mode "append" merges into the active list (Reader entry point) — existing
// items re-enter aggregation so quantities re-sum, and purchased state is
// carried across for items that survive the merge.
groceryListsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = CreateGroceryListInput.parse(req.body);
    const userId = req.userId!;

    const recipes = await prisma.recipe.findMany({
      where: { id: { in: body.recipe_ids }, OR: [{ userId }, { userId: null }] },
      include: { ingredients: { include: { ingredient: true } } },
    });
    if (recipes.length !== new Set(body.recipe_ids).size) {
      throw new ApiError(404, "recipe_not_found");
    }

    // Exact scaling per recipe (target/base); rounding happens once inside
    // the aggregator after summing (development.md §8.2 #2).
    // Category chain: linked master row → master row matched by normalized
    // name (manual recipes link nothing, but drag-corrections upsert master
    // rows keyed on the same names — §6.4) → §6.4 rule-based lookup. A user's
    // dragged correction beats the rules; the rules fill the gaps.
    const unlinkedNames = new Set<string>();
    for (const recipe of recipes) {
      for (const ing of recipe.ingredients) {
        if (!ing.ingredientId) unlinkedNames.add(normalizeIngredientName(ing.rawText));
      }
    }
    const correctedByName = new Map<string, string>();
    if (unlinkedNames.size > 0) {
      const rows = await prisma.ingredient.findMany({
        where: { canonicalName: { in: [...unlinkedNames] } },
        select: { canonicalName: true, category: true },
      });
      for (const row of rows) correctedByName.set(row.canonicalName, row.category);
    }

    const entries: GroceryEntry[] = [];
    for (const recipe of recipes) {
      const targetServings = body.servings_overrides[recipe.id] ?? recipe.baseServings;
      const ratio = targetServings / recipe.baseServings;
      for (const ing of recipe.ingredients) {
        const masterCategory = (ing.ingredient?.category ??
          correctedByName.get(normalizeIngredientName(ing.rawText))) as GroceryCategory | undefined;
        const category =
          masterCategory && masterCategory !== "other"
            ? masterCategory
            : ingredientCategory(ing.rawText);
        entries.push({
          ingredient_id: ing.ingredientId,
          display_name: ing.ingredient?.canonicalName ?? ing.rawText,
          quantity: ing.quantity === null ? null : ing.quantity * ratio,
          unit: (ing.unit as Unit | null) ?? null,
          category,
          role_tag: ing.roleTag as RoleTag,
          source_recipe_id: recipe.id,
          recipe_title: recipe.title,
        });
      }
    }

    const active = await prisma.groceryList.findFirst({
      where: { userId, status: "active" },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    });

    if (body.mode === "append" && active) {
      // Existing items re-enter aggregation as one entry per source recipe,
      // each carrying an even share of the summed quantity — the sum is what
      // matters, and per-recipe shares keep recipe_count truthful.
      for (const item of active.items) {
        const recipeIds = JSON.parse(item.sourceRecipeIds) as string[];
        const sources = recipeIds.length > 0 ? recipeIds : [item.id]; // manual adds
        const share = item.aggregatedQuantity === null ? null : item.aggregatedQuantity / sources.length;
        for (const sourceId of sources) {
          entries.push({
            ingredient_id: item.ingredientId,
            display_name: item.label ?? "",
            quantity: share,
            unit: (item.unit as Unit | null) ?? null,
            category: item.category as GroceryCategory,
            role_tag: "main", // not used by the aggregator; filler for the type
            source_recipe_id: sourceId,
            recipe_title: "",
          });
        }
      }
    }

    const items = aggregateGroceryList(entries);

    // Purchased state carried across the rewrite: match on ingredient
    // identity + unit (the aggregation grouping keys).
    const purchasedBefore = new Set<string>();
    if (active) {
      for (const item of active.items) {
        if (item.isPurchased) purchasedBefore.add(`${item.ingredientId ?? `name:${item.label?.toLowerCase() ?? ""}`}|${item.unit ?? ""}`);
      }
    }

    const list = await prisma.$transaction(async (tx) => {
      let listId: string;
      if (body.mode === "append" && active) {
        listId = active.id;
        await tx.groceryListItem.deleteMany({ where: { groceryListId: active.id } });
      } else {
        await tx.groceryList.updateMany({
          where: { userId, status: "active" },
          data: { status: "archived" },
        });
        const created = await tx.groceryList.create({
          data: {
            userId,
            name: new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          },
        });
        listId = created.id;
      }
      for (const item of items) {
        await tx.groceryListItem.create({
          data: {
            groceryListId: listId,
            ingredientId: item.ingredient_id,
            label: item.label,
            aggregatedQuantity: item.quantity,
            unit: item.unit,
            category: item.category,
            sourceRecipeIds: JSON.stringify(item.source_recipe_ids),
            isPurchased: purchasedBefore.has(
              `${item.ingredient_id ?? `name:${item.label.toLowerCase()}`}|${item.unit ?? ""}`,
            ),
          },
        });
      }
      return tx.groceryList.findUnique({ where: { id: listId }, include: { items: true } });
    });

    res.status(201).json(serializeList(list!));
  } catch (err) {
    next(err);
  }
});

// ── GET /grocery-lists/active — the user's current list (or 404) ────────────
groceryListsRouter.get("/active", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await prisma.groceryList.findFirst({
      where: { userId: req.userId!, status: "active" },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    });
    if (!list) throw new ApiError(404, "no_active_grocery_list");
    res.json(serializeList(list));
  } catch (err) {
    next(err);
  }
});

// ── GET /grocery-lists/:id ───────────────────────────────────────────────────
groceryListsRouter.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await getOwnList(req.params.id!, req.userId!);
    res.json(serializeList(list));
  } catch (err) {
    next(err);
  }
});

// ── PATCH /grocery-lists/:id/items/:itemId — toggle purchased / edit qty / recategorize ──
groceryListsRouter.patch("/:id/items/:itemId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = GroceryItemPatchInput.parse(req.body);
    const list = await getOwnList(req.params.id!, req.userId!);
    const item = list.items.find((i) => i.id === req.params.itemId);
    if (!item) throw new ApiError(404, "grocery_item_not_found");

    const updated = await prisma.groceryListItem.update({
      where: { id: item.id },
      data: {
        ...(body.is_purchased !== undefined ? { isPurchased: body.is_purchased } : {}),
        ...(body.quantity !== undefined ? { aggregatedQuantity: body.quantity } : {}),
        ...(body.unit !== undefined ? { unit: body.unit } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
      },
    });

    // Drag-to-recategorize: persist the correction to the Ingredient master
    // row so it survives regeneration (§6.4 — the user's drop beats the
    // rules). Linked items update their master row; free-text items upsert
    // one keyed on the normalized label, which the generate route matches by
    // name for unlinked recipe ingredients.
    if (body.category !== undefined) {
      if (item.ingredientId) {
        await prisma.ingredient.update({
          where: { id: item.ingredientId },
          data: { category: body.category },
        });
      } else {
        const canonical = normalizeIngredientName(item.label ?? "");
        if (canonical) {
          await prisma.ingredient.upsert({
            where: { canonicalName: canonical },
            update: { category: body.category },
            create: { canonicalName: canonical, category: body.category },
          });
        }
      }
    }

    res.json(serializeItem({ ...updated, label: updated.label ?? item.label }));
  } catch (err) {
    next(err);
  }
});

// ── DELETE /grocery-lists/:id/items/:itemId — remove an item (§8.2 #6) ───────
// Note: regenerating the list re-derives every item from recipe ingredients,
// so a deleted item reappears on regenerate — that's inherent to the
// generate-from-recipes model; deleting covers manual removals and trims.
groceryListsRouter.delete("/:id/items/:itemId", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await getOwnList(req.params.id!, req.userId!);
    const item = list.items.find((i) => i.id === req.params.itemId);
    if (!item) throw new ApiError(404, "grocery_item_not_found");
    await prisma.groceryListItem.delete({ where: { id: item.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ── POST /grocery-lists/:id/items — manual add (§8.2 #6) ─────────────────────
groceryListsRouter.post("/:id/items", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = ManualGroceryItemInput.parse(req.body);
    const list = await getOwnList(req.params.id!, req.userId!);

    // Category chain mirrors the generate route: explicit > drag-corrected
    // master row (matched by normalized name) > §6.4 rule lookup.
    const canonical = normalizeIngredientName(body.label);
    const corrected = canonical
      ? await prisma.ingredient.findUnique({ where: { canonicalName: canonical }, select: { category: true } })
      : null;

    const created = await prisma.groceryListItem.create({
      data: {
        groceryListId: list.id,
        label: body.label,
        aggregatedQuantity: body.quantity ?? null,
        unit: body.unit ?? null,
        category:
          body.category ??
          (corrected && corrected.category !== "other" ? corrected.category : ingredientCategory(body.label)),
        sourceRecipeIds: "[]",
      },
    });
    res.status(201).json(serializeItem(created));
  } catch (err) {
    next(err);
  }
});
