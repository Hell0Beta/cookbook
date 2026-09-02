// Server entry — apps/api (development.md §0, §11).
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { config, corsOriginAllowed } from "./config.js";
import { authRouter } from "./routes/auth.js";
import { usersRouter } from "./routes/users.js";
import { recipesRouter } from "./routes/recipes.js";
import { ingredientsRouter } from "./routes/ingredients.js";
import { importRouter } from "./routes/import.js";
import { tagsRouter } from "./routes/tags.js";
import { groceryListsRouter } from "./routes/grocery-lists.js";
import { mealPlansRouter } from "./routes/meal-plans.js";
import { recommendationsRouter } from "./routes/recommendations.js";
import { imagesRouter } from "./routes/images.js";
import { errorHandler } from "./middleware/error.js";

const app = express();

app.use(
  cors({
    // WEB_ORIGIN allowlist + any localhost/private-IP origin (§0 trusted home
    // network — phones reach the server by whichever interface is handy).
    origin: (origin, cb) => cb(null, !origin || corsOriginAllowed(origin, config.webOrigins)),
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/users", usersRouter);
app.use("/recipes/import", importRouter); // before /recipes so :id can't swallow it
app.use("/recipes", recipesRouter);
app.use("/ingredients", ingredientsRouter); // autocomplete (development.md §9 step 2)
app.use("/tags", tagsRouter);
app.use("/grocery-lists", groceryListsRouter);
app.use("/meal-plans", mealPlansRouter);
app.use("/recommendations", recommendationsRouter);
app.use("/images", imagesRouter);

app.use(errorHandler);

app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`);
  console.log(`[api] data dir: ${config.dataDir}`);
});
