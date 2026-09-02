// Serving scaling with unit-aware rounding — development.md §8 "Serving Scaling",
// design.md §4.4 ("avoid 1.333 eggs").
import Fraction from "fraction.js";
import type { Unit } from "./entities.js";

const VOLUME_UNITS: ReadonlySet<Unit> = new Set(["tsp", "tbsp", "cup", "ml", "l"]);
const US_VOLUME_UNITS: ReadonlySet<Unit> = new Set(["tsp", "tbsp", "cup"]);
const COUNT_UNITS: ReadonlySet<Unit> = new Set(["piece"]);
// Weights (g, kg, oz, lb) keep one decimal; pinch/to_taste never scale.

export interface ScaledQuantity {
  quantity: number | null; // null = unquantified ("to taste") — display as-is
  display: string; // "1½", "2", "~2–3", "0.5"
  approximate: boolean; // true when rounding was lossy enough to warrant a flag
}

/** Unicode fraction rendering for the common kitchen fractions (design.md §4.4). */
const FRACTION_GLYPHS: Record<string, string> = {
  "1/8": "⅛",
  "1/4": "¼",
  "1/3": "⅓",
  "1/2": "½",
  "2/3": "⅔",
  "3/4": "¾",
};

function formatFraction(f: Fraction): string {
  const whole = Math.floor(f.n / f.d);
  const rem = new Fraction(f.n % f.d, f.d);
  if (rem.n === 0) return String(whole);
  const remKey = rem.toFraction();
  const glyph = FRACTION_GLYPHS[remKey];
  if (glyph) return whole === 0 ? glyph : `${whole}${glyph}`;
  // Fall back to a plain fraction like 1/5 if it's not a common one.
  if (whole === 0) return rem.toFraction();
  return `${whole} ${rem.toFraction()}`;
}

/** Round to the nearest of ¼/⅓/½ steps (development.md §8). */
function roundToKitchenFraction(x: number): Fraction {
  const candidates = [1 / 8, 1 / 4, 1 / 3, 1 / 2];
  let best = new Fraction(Math.round(x)); // whole numbers always allowed
  let bestDist = Math.abs(x - best.valueOf());
  const base = Math.floor(x);
  for (const c of candidates) {
    for (const w of [base - 1, base, base + 1]) {
      const v = w + c;
      if (v < 0) continue;
      const dist = Math.abs(x - v);
      if (dist < bestDist - 1e-9) {
        best = new Fraction(v);
        bestDist = dist;
      }
    }
  }
  return best;
}

/**
 * Scale one ingredient quantity from base to target servings.
 * development.md §8: `scaled = raw * (target / base)`; unit-aware rounding;
 * null quantity never scales.
 */
export function scaleQuantity(
  quantity: number | null,
  unit: Unit | null,
  baseServings: number,
  targetServings: number,
): ScaledQuantity {
  if (quantity === null || baseServings <= 0) {
    return { quantity, display: "", approximate: false };
  }
  const ratio = targetServings / baseServings;
  const scaled = quantity * ratio;

  if (unit && COUNT_UNITS.has(unit)) {
    // Whole items only — never fractional eggs; flag awkward rounds
    // ("2.5 eggs" → "~2–3 eggs", development.md §8).
    const rounded = Math.round(scaled);
    const whole = Math.floor(scaled);
    const approx = Math.abs(scaled - rounded) > 0.25 && whole >= 1;
    if (approx) {
      return { quantity: rounded, display: `~${whole}–${whole + 1}`, approximate: true };
    }
    return { quantity: rounded, display: String(rounded), approximate: false };
  }

  if (unit && VOLUME_UNITS.has(unit)) {
    const f = roundToKitchenFraction(scaled);
    const dist = Math.abs(scaled - f.valueOf());
    return {
      quantity: f.valueOf(),
      display: formatFraction(f),
      approximate: dist > 0.2,
    };
  }

  if (unit === "pinch" || unit === "to_taste" || unit === null) {
    // Seasoning-style units don't benefit from precision.
    const rounded = Math.round(scaled * 2) / 2;
    return { quantity: rounded, display: formatFraction(new Fraction(rounded)), approximate: false };
  }

  // Weights: one decimal place.
  const rounded = Math.round(scaled * 10) / 10;
  return {
    quantity: rounded,
    display: rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1),
    approximate: false,
  };
}

export interface ScalableIngredient {
  quantity: number | null;
  unit: Unit | null;
  raw_text: string;
}

/**
 * Round + format an already-exact quantity for display, with no scaling
 * applied. Used by grocery aggregation (§8.2) where exact quantities are
 * summed first and rounded once at the end.
 * US customary volumes → kitchen fractions; metric volumes and weights →
 * at most one decimal; whole items stay whole with an awkward-round flag.
 */
export function formatQuantity(
  quantity: number,
  unit: Unit | null,
): { display: string; approximate: boolean } {
  if (unit !== null && COUNT_UNITS.has(unit)) {
    const rounded = Math.round(quantity);
    const whole = Math.floor(quantity);
    if (Math.abs(quantity - rounded) > 0.25 && whole >= 1) {
      return { display: `~${whole}–${whole + 1}`, approximate: true };
    }
    return { display: String(rounded), approximate: false };
  }
  if (unit !== null && US_VOLUME_UNITS.has(unit)) {
    const f = roundToKitchenFraction(quantity);
    return {
      display: formatFraction(f),
      approximate: Math.abs(quantity - f.valueOf()) > 0.2,
    };
  }
  // Metric volumes, weights, and unitless values.
  const rounded = Math.round(quantity * 10) / 10;
  return {
    display: rounded % 1 === 0 ? String(rounded) : rounded.toFixed(1),
    approximate: false,
  };
}

/** Scale a whole ingredient list (development.md §8, GET /recipes/:id/scale). */
export function scaleIngredients<T extends ScalableIngredient>(
  ingredients: readonly T[],
  baseServings: number,
  targetServings: number,
): (T & { scaled: ScaledQuantity })[] {
  return ingredients.map((ing) => ({
    ...ing,
    scaled: scaleQuantity(ing.quantity, ing.unit, baseServings, targetServings),
  }));
}
