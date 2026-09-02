// Public-API import routes — development.md §4, §11. Mounted at /recipes/import
// (before /recipes) so the paths don't collide with /recipes/:id.
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { PublicApiImportInput, YoutubeImportInput } from "@cookbook/shared";
import { requireAuth } from "../auth/session.js";
import { searchMealDb } from "../services/mealdb.js";
import { assertProvider, importPublicApiRecipe } from "../services/import-pipeline.js";
import { importYoutubeRecipe } from "../services/youtube.js";
import { serializeRecipe } from "../recipes/serialize.js";

export const importRouter = Router();
importRouter.use(requireAuth);

// GET /recipes/import/public-api/search?q=&provider=mealdb
importRouter.get("/public-api/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z.string().trim().min(2, "search needs at least 2 characters").max(60).parse(req.query.q ?? "");
    const provider = z.enum(["mealdb"]).default("mealdb").parse(req.query.provider ?? "mealdb");
    assertProvider(provider);
    res.json(await searchMealDb(q));
  } catch (err) {
    next(err);
  }
});

// POST /recipes/import/youtube — { url }. Returns an extraction DRAFT for the
// create editor; nothing is saved until the user reviews and saves
// (development.md §5 step 5). Already-imported URLs short-circuit to
// existing_recipe_id. LLM quota exhaustion surfaces as 429 llm_quota_exceeded.
importRouter.post("/youtube", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = YoutubeImportInput.parse(req.body);
    res.json(await importYoutubeRecipe(body.url));
  } catch (err) {
    next(err);
  }
});

// POST /recipes/import/public-api — { provider, provider_recipe_id }.
// Imports as a shared (userId-null) recipe and runs the Tagging Engine;
// idempotent on (source_type, source_url).
importRouter.post("/public-api", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = PublicApiImportInput.parse(req.body);
    assertProvider(body.provider);
    const recipe = await importPublicApiRecipe("mealdb", body.provider_recipe_id);
    res.status(201).json({ id: recipe!.id, ...serializeRecipe(recipe!) });
  } catch (err) {
    next(err);
  }
});
