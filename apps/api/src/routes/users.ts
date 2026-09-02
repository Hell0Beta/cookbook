// GET /users/me, PUT /users/me/diet-profile (development.md §11).
import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/session.js";
import { DietProfileInput, normalizeAllergenList, type DietProfileOut } from "@cookbook/shared";

export const usersRouter = Router();
usersRouter.use(requireAuth);

function profileOut(profile: { dietTypes: string; allergies: string; excludedIngredients: string; preferredCuisines: string }): DietProfileOut {
  return {
    diet_types: DietProfileInput.shape.diet_types.parse(JSON.parse(profile.dietTypes)),
    allergies: JSON.parse(profile.allergies) as string[],
    excluded_ingredients: JSON.parse(profile.excludedIngredients) as string[],
    preferred_cuisines: JSON.parse(profile.preferredCuisines) as string[],
  };
}

usersRouter.get("/me", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: { dietProfile: true },
    });
    if (!user) {
      res.status(404).json({ error: "user_not_found" });
      return;
    }
    res.json({
      id: user.id,
      username: user.username,
      display_name: user.displayName,
      avatar_url: user.avatarUrl,
      created_at: user.createdAt.toISOString(),
      diet_profile: user.dietProfile ? profileOut(user.dietProfile) : null,
    });
  } catch (err) {
    next(err);
  }
});

// Upsert the caller's DietProfile (development.md §3, §10). Allergies are
// normalized against the known-allergen list before storing (§3); the rest
// pass through validated. Sending an all-empty body deletes the profile row
// (back to "no restrictions") — an empty profile IS the no-profile state.
usersRouter.put("/me/diet-profile", async (req, res, next) => {
  try {
    const body = DietProfileInput.parse(req.body);
    const allEmpty =
      body.diet_types.length === 0 &&
      body.allergies.length === 0 &&
      body.excluded_ingredients.length === 0 &&
      body.preferred_cuisines.length === 0;
    if (allEmpty) {
      await prisma.dietProfile.deleteMany({ where: { userId: req.userId } });
      res.json({ diet_profile: null });
      return;
    }
    const data = {
      dietTypes: JSON.stringify(body.diet_types),
      allergies: JSON.stringify(normalizeAllergenList(body.allergies)),
      excludedIngredients: JSON.stringify(body.excluded_ingredients.map((e) => e.trim()).filter(Boolean)),
      preferredCuisines: JSON.stringify(body.preferred_cuisines.map((c) => c.trim()).filter(Boolean)),
    };
    const profile = await prisma.dietProfile.upsert({
      where: { userId: req.userId! },
      update: data,
      create: { userId: req.userId!, ...data },
    });
    res.json({ diet_profile: profileOut(profile) });
  } catch (err) {
    next(err);
  }
});
