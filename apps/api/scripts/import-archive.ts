// Import the local "archive" recipe dataset (Epicurious-derived CSV + local
// hero images) as SHARED recipes — development.md §4-style pipeline with
// source_type "dataset". Replaces the external seed source for Discover (§10)
// and makes the 13.5k recipes searchable offline.
//
// CSV quirk: Instructions contain embedded newlines, so row-per-line reading
// is wrong — this walks the file as a minimal CSV state machine (quotes,
// doubled "" escapes) rather than line-splitting. Ingredients arrive as a
// Python-list string ("['2 cups flour', …]") — parsed with a regex split that
// handles the same quote escapes.
//
// Run: pnpm --filter @cookbook/api exec tsx scripts/import-archive.ts [archiveDir]
// Idempotent: dataset://<slug> source URLs skip on re-run.
// NOTE (2026-09-02 cleanup): archive/Food Images/ was deleted after the
// successful import — every image already lives in DATA_DIR/images as
// dataset-<slug>.jpg. Re-running against the CSV alone still works but
// produces imageless recipes (copyHero degrades to null).
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { parseIngredient } from "parse-ingredient";
import {
  estimateDurationMinutes,
  type RecipeBlocks,
  type Unit,
} from "@cookbook/shared";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { createRecipeFromBlocks } from "../src/recipes/persist.js";
import { tagRecipe } from "../src/services/tagging.js";
import { linkIngredientMaster } from "../src/services/import-pipeline-helpers.js";

// parse-ingredient unitOfMeasureID → our Unit enum (same map as the
// public-API import; anything unmappable keeps a null unit).
const UOM_TO_UNIT: Record<string, Unit> = {
  tablespoon: "tbsp",
  teaspoon: "tsp",
  cup: "cup",
  fluidOunce: "oz",
  ounce: "oz",
  pound: "lb",
  gram: "g",
  kilogram: "kg",
  milliliter: "ml",
  liter: "l",
  each: "piece",
};

/** Full-file CSV parse (header row → records), newline-safe. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch === "\r") {
      // CRLF — the \n branch handles the record split
    } else {
      field += ch;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

/** "['a', 'b']" → ["a", "b"] (handles '' and "" quotes + escapes). */
export function parsePythonList(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (!inner) return [];
  const items: string[] = [];
  let cur = "";
  let inS: "single" | "double" | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inS === "double") {
      if (ch === '"' && inner[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inS = null;
      } else cur += ch;
    } else if (inS === "single") {
      if (ch === "'") inS = null;
      else cur += ch;
    } else if (ch === '"') inS = "double";
    else if (ch === "'") inS = "single";
    else if (ch === ",") {
      items.push(cur);
      cur = "";
    } else cur += ch;
  }
  items.push(cur);
  return items.map((s) => s.trim()).filter(Boolean);
}

interface DatasetRow {
  index: number;
  title: string;
  ingredients: string[];
  instructions: string;
  imageName: string | null;
}

/** Row records → recipe records (record = only lines starting with a row id). */
export function toRecipes(rows: string[][]): DatasetRow[] {
  const out: DatasetRow[] = [];
  for (const r of rows.slice(1)) {
    if (r.length < 6 || !/^\d+$/.test(r[0] ?? "")) continue;
    let image = r[4]?.trim();
    // `#NAME?` is Excel's formula-error artifact — 30 different recipes
    // share that bogus slug. Treating it as a name would collide their
    // idempotency keys AND image lookups; null routes them to the row-index
    // key instead (unique per recipe).
    if (!image || image === "nan" || image === "#NAME?") image = null;
    out.push({
      index: Number(r[0]),
      title: (r[1] ?? "").trim(),
      ingredients: parsePythonList(r[2] ?? ""),
      instructions: (r[3] ?? "").trim(),
      imageName: image,
    });
  }
  return out;
}

function datasetBlocks(row: DatasetRow, heroUrl: string | null): RecipeBlocks {
  const steps = row.instructions
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((text, i) => ({
      id: `ds-${row.index}-s${i}`,
      type: "step" as const,
      step_number: i + 1,
      instruction_text: text,
      duration_minutes: estimateDurationMinutes(text),
      image_url: null,
    }));

  const ingredients = row.ingredients.map((raw, i) => {
    const parsed = parseIngredient(raw).find((p) => !p.isGroupHeader);
    return {
      id: `ds-${row.index}-i${i}`,
      type: "ingredient" as const,
      quantity: parsed?.quantity ?? null,
      unit: parsed?.unitOfMeasureID ? (UOM_TO_UNIT[parsed.unitOfMeasureID] ?? null) : null,
      raw_text: raw,
      ingredient_id: null, // master linking below (dataset rows are shared)
      role_tag: "main" as const, // TaggingService recomputes (§6.1)
      swap_suggestions: [] as string[],
      sort_order: i,
    };
  });

  return {
    title: row.title,
    description: null,
    hero_image_url: heroUrl,
    blocks: [
      {
        id: `ds-${row.index}-meta`,
        type: "meta",
        servings: 4, // dataset has no servings — typical recipe default
        total_time_minutes: steps.reduce((n, s) => n + (s.duration_minutes ?? 0), 0) + 10,
        source_type: "dataset",
        source_url: `dataset://${row.imageName ?? row.index}`,
      },
      ...ingredients,
      ...steps,
    ],
  };
}

async function copyHero(imageName: string | null, imagesDir: string): Promise<string | null> {
  if (!imageName) return null;
  const src = path.join(imagesDir, `${imageName}.jpg`);
  let exists = true;
  try {
    await fsp.access(src);
  } catch {
    exists = false;
  }
  if (!exists) return null;
  // Copy into DATA_DIR/images with a collision-safe name — the originals
  // stay in the archive folder untouched.
  const dest = `dataset-${imageName}.jpg`;
  try {
    await fsp.copyFile(src, path.join(config.imagesDir, dest));
  } catch (err) {
    console.warn(`[archive] image copy failed for ${imageName}:`, err instanceof Error ? err.message : err);
    return null;
  }
  return `/images/${dest}`;
}

async function main() {
  const archiveDir = path.resolve(process.argv[2] ?? path.join(process.cwd(), "..", "..", "archive"));
  const csvPath = path.join(archiveDir, "Food Ingredients and Recipe Dataset with Image Name Mapping.csv");
  const imagesDir = path.join(archiveDir, "Food Images", "Food Images");

  if (!fs.existsSync(csvPath)) {
    console.error(`[archive] CSV not found at ${csvPath} — pass the archive dir as an argument`);
    process.exitCode = 1;
    return;
  }

  const text = await fsp.readFile(csvPath, "utf-8");
  const recipes = toRecipes(parseCsv(text));
  console.log(`[archive] ${recipes.length} recipes parsed from CSV`);

  // Idempotency pre-pass: existing dataset imports by source_url.
  const existing = new Set(
    (await prisma.recipe.findMany({
      where: { sourceType: "dataset" },
      select: { sourceUrl: true },
    })).map((r) => r.sourceUrl),
  );

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  let noImage = 0;
  let n = 0;
  for (const row of recipes) {
    n++;
    if (n % 1000 === 0) console.log(`[archive] ${n}/${recipes.length}…`);
    const sourceUrl = `dataset://${row.imageName ?? row.index}`;
    if (existing.has(sourceUrl)) {
      skipped++;
      continue;
    }
    try {
      const hero = await copyHero(row.imageName, imagesDir);
      if (!hero) noImage++;
      const blocks = datasetBlocks(row, hero);
      const created = await createRecipeFromBlocks(null, blocks);
      if (!created) throw new Error("createRecipeFromBlocks returned null");

      // §4 step 3: link ingredients to the master table (same pattern as the
      // public-API import, but in bulk here — one find-or-create per unique
      // name, batched per recipe).
      const ingredientBlocks = blocks.blocks.filter((b) => b.type === "ingredient");
      const saved = await prisma.recipe.findUnique({
        where: { id: created.id },
        include: { ingredients: { orderBy: { sortOrder: "asc" } } },
      });
      for (const [i, ingRow] of (saved?.ingredients ?? []).entries()) {
        const block = ingredientBlocks[i];
        if (!block || block.type !== "ingredient") continue;
        const masterId = await linkIngredientMaster(block.raw_text);
        if (masterId && ingRow.ingredientId !== masterId) {
          await prisma.recipeIngredient.update({
            where: { id: ingRow.id },
            data: { ingredientId: masterId },
          });
        }
      }

      await tagRecipe(created.id); // rules-only pass (§6.1 v1 — no LLM)
      imported++;
    } catch (err) {
      failed++;
      if (failed <= 10) {
        console.warn(`[archive] "${row.title}" failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  console.log(
    `[archive] done: ${imported} imported, ${skipped} already present, ${failed} failed, ${noImage} without image`,
  );
}

main()
  .catch((err) => {
    console.error("[archive] fatal:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
