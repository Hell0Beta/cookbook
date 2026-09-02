// Ingredient master autocomplete — development.md §9 step 2 ("user inputs
// their available ingredients", matched against the Ingredient master table).
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";

export const ingredientsRouter = Router();
ingredientsRouter.use(requireAuth);

// GET /ingredients?q= — canonical-name autocomplete, prefix matches ranked
// first. SQLite's LIKE is ASCII-case-insensitive, so `contains` matches
// "Chicken" for "chick" without a mode flag.
ingredientsRouter.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z.string().max(60).parse(String(req.query.q ?? "").trim());
    const rows = await prisma.ingredient.findMany({
      where: q ? { canonicalName: { contains: q } } : {},
      orderBy: { canonicalName: "asc" },
      take: 50,
      select: { id: true, canonicalName: true, category: true },
    });
    const needle = q.toLowerCase();
    const ranked = rows
      .filter((r) => r.canonicalName)
      .sort(
        (a, b) =>
          Number(b.canonicalName.toLowerCase().startsWith(needle)) -
            Number(a.canonicalName.toLowerCase().startsWith(needle)) ||
          a.canonicalName.localeCompare(b.canonicalName),
      )
      .slice(0, 20);
    res.json(
      ranked.map((r) => ({ id: r.id, canonical_name: r.canonicalName, category: r.category })),
    );
  } catch (err) {
    next(err);
  }
});
