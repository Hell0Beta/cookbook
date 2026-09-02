// Tagging Engine v1 — development.md §6, rule-based pass only (LLM pass is an
// enhancement owned by apps/api's OpenRouter client; these functions must run
// standalone with the LLM disabled per §0). Also carries the tag/import API
// shapes shared by web + api (development.md §3 "Tag", §11).
import { z } from "zod";
import type { GroceryCategory, Unit } from "./entities.js";

// ── Dictionaries (development.md §6.1/§6.2) ─────────────────────────────────

/** Known-flexible ingredients: small quantities, garnishes, generic oils. */
const FLEXIBLE_INGREDIENTS = new Set([
  "salt", "pepper", "black pepper", "sea salt", "kosher salt", "cayenne",
  "water", "ice", "ice cube", "sugar", "caster sugar", "brown sugar",
  "vegetable oil", "olive oil", "sunflower oil", "cooking oil", "oil",
  "vinegar", "white wine vinegar", "balsamic vinegar", "red wine vinegar",
  "cooking spray", "butter", "flour", "cornstarch", "cornflour", "baking powder",
  "baking soda", "garnish", "lemon wedge", "lime wedge", "toothpick",
  // garnish herbs
  "parsley", "cilantro", "coriander", "basil", "chives", "mint", "dill",
  "tarragon", "thyme", "rosemary", "oregano", "sage", "bay leaf",
  "scallion", "spring onion", "green onion",
]);

/** Proteins default to `main` (development.md §6.1). */
const PROTEINS = new Set([
  "chicken", "chicken breast", "chicken thigh", "chicken wing", "whole chicken",
  "beef", "steak", "minced beef", "ground beef", "beef brisket", "lamb",
  "pork", "pork chop", "bacon", "pancetta", "ham", "sausage", "chorizo",
  "turkey", "duck", "veal",
  "fish", "salmon", "tuna", "cod", "haddock", "tilapia", "mackerel", "sardine",
  "prawn", "shrimp", "crab", "lobster", "squid", "octopus", "anchovy",
  "egg", "egg yolk", "egg white", "tofu", "tempeh", "seitan",
  "bean", "chickpea", "lentil", "black bean", "kidney bean",
]);

/** Primary starches default to `main` (development.md §6.1). */
const STARCHES = new Set([
  "rice", "white rice", "brown rice", "basmati rice", "jasmine rice",
  "arborio rice", "rice noodle", "noodle", "egg noodle", "pasta", "spaghetti",
  "penne", "fusilli", "macaroni", "linguine", "fettuccine", "lasagne",
  "lasagna", "bread", "sourdough", "tortilla", "pitta", "pita", "naan",
  "potato", "sweet potato", "quinoa", "couscous", "oat", "rolled oat",
  "polenta", "semolina",
]);

// Diet inference (development.md §6.2) — checked against normalized names.
const MEAT = new Set([...PROTEINS].filter((n) => !["egg", "egg yolk", "egg white", "tofu", "tempeh", "seitan", "bean", "chickpea", "lentil", "black bean", "kidney bean"].includes(n)));
const DAIRY = new Set([
  "milk", "whole milk", "skim milk", "buttermilk", "cream", "double cream",
  "single cream", "sour cream", "creme fraiche", "butter", "ghee", "yogurt",
  "yoghurt", "greek yogurt", "cheese", "cheddar", "parmesan", "mozzarella",
  "feta", "ricotta", "cream cheese", "mascarpone", "halloumi", "gruyere",
  "casein", "whey", "milk chocolate", "condensed milk", "evaporated milk",
]);
const EGGS = new Set(["egg", "egg yolk", "egg white", "mayonnaise", "mayo", "custard", "meringue"]);
const OTHER_ANIMAL = new Set([
  "honey", "gelatin", "gelatine", "fish sauce", "oyster sauce",
  "worcestershire sauce", "anchovy", "lard", "beef stock", "chicken stock",
  "chicken broth", "beef broth", "fish stock", "lactose",
]);
const GLUTEN = new Set([
  "flour", "plain flour", "all purpose flour", "bread flour", "wholemeal flour",
  "wheat", "semolina", "barley", "rye", "spelt", "bread", "sourdough",
  "breadcrumbs", "breadcrumb", "panko", "pasta", "spaghetti", "penne",
  "fusilli", "macaroni", "linguine", "fettuccine", "lasagne", "lasagna",
  "noodle", "egg noodle", "soy sauce", "malt vinegar", "couscous", "bulgur",
  "tortilla", "pitta", "pita", "naan", "worcestershire sauce", "bouillon",
  "stock cube", "gravy granule",
]);
const NUTS = new Set([
  "almond", "ground almond", "peanut", "cashew", "walnut", "pecan", "hazelnut",
  "pistachio", "macadamia", "brazil nut", "pine nut", "pecans", "praline",
  "marzipan", "nutella", "almond milk", "peanut butter", "cashew butter",
]);

/** Ingredient → grocery category lookup (development.md §6.4, no aisle). */
const CATEGORY_TABLE: ReadonlyArray<readonly [GroceryCategory, readonly string[]]> = [
  ["produce", ["tomato", "cherry tomato", "onion", "red onion", "spring onion", "scallion", "green onion", "garlic", "garlic clove", "leek", "carrot", "celery", "potato", "sweet potato", "broccoli", "cauliflower", "cabbage", "spinach", "kale", "lettuce", "cucumber", "courgette", "zucchini", "aubergine", "eggplant", "pepper", "bell pepper", "red pepper", "green pepper", "mushroom", "lemon", "lime", "orange", "apple", "banana", "avocado", "ginger", "chilli", "chile", "jalapeno", "coriander", "cilantro", "parsley", "basil", "mint", "dill", "chives", "thyme", "rosemary", "oregano", "sage", "tarragon", "bay leaf", "salad", "rocket", "arugula", "beetroot", "beet", "parsnip", "turnip", "swede", "rutabaga", "butternut squash", "pumpkin", "pea", "green bean", "sweetcorn", "corn", "radish", "asparagus", "artichoke", "fennel", "shallot", "brussels sprout", "olive", "capers", "cranberry", "blueberry", "strawberry", "raspberry", "mango", "pineapple", "melon", "grape", "pear", "peach", "plum", "cherry", "kiwi", "papaya", "coconut", "plantain", "yam", "bok choy", "pak choi", "bean sprout", "watercress", "endive", "chicory", "lemon grass", "lemongrass", "kaffir lime leaf"]],
  ["dairy", [...DAIRY, "vegan butter", "egg", "egg yolk", "egg white"]],
  ["meat", [...MEAT, "minced pork", "ground pork", "pork belly", "beef fillet", "sirloin", "ribeye", "brisket", "prosciutto", "salami", "bacon rasher", "chicken stock cube", "lamb chop", "lamb rack", "rack of lamb"]],
  ["spice", ["cumin", "ground cumin", "cinnamon", "ground cinnamon", "paprika", "smoked paprika", "turmeric", "chilli powder", "chili powder", "cayenne pepper", "curry powder", "garam masala", "coriander seed", "cumin seed", "mustard seed", "cardamom", "cloves", "nutmeg", "allspice", "mixed spice", "five spice", "chinese five spice", "saffron", "star anise", "bay leaf", "oregano", "thyme", "rosemary", "sage", "herbes de provence", "italian seasoning", "chilli flake", "red pepper flake", "white pepper", "black pepper", "sea salt", "kosher salt", "salt", "vanilla", "vanilla extract", "vanilla pod", "mustard", "dijon mustard", "english mustard", "wholegrain mustard", "harissa", "ras el hanout", "za'atar", "sumac", "fennel seed", "fenugreek", "asafoetida", "sichuan pepper"]],
  ["frozen", ["frozen pea", "frozen spinach", "frozen berry", "ice cream", "frozen puff pastry", "french fry", "frozen chips"]],
  ["bakery", ["bread", "sourdough", "baguette", "roll", "bap", "bun", "brioche", "croissant", "pitta", "pita", "naan", "tortilla", "wrap", "pastry", "puff pastry", "filo pastry", "phyllo pastry", "breadcrumbs", "panko", "cake", "sponge cake", "brownie", "muffin", "scone"]],
  ["pantry", ["rice", "white rice", "brown rice", "basmati rice", "jasmine rice", "arborio rice", "pasta", "spaghetti", "penne", "fusilli", "macaroni", "linguine", "fettuccine", "lasagne", "lasagna", "noodle", "egg noodle", "rice noodle", "flour", "plain flour", "all purpose flour", "bread flour", "wholemeal flour", "self raising flour", "cornstarch", "cornflour", "sugar", "caster sugar", "brown sugar", "icing sugar", "powdered sugar", "demerara sugar", "molasses", "treacle", "golden syrup", "maple syrup", "honey", "agave syrup", "vinegar", "white wine vinegar", "balsamic vinegar", "red wine vinegar", "rice vinegar", "apple cider vinegar", "malt vinegar", "vegetable oil", "olive oil", "sunflower oil", "sesame oil", "rapeseed oil", "coconut oil", "peanut oil", "stock", "vegetable stock", "vegetable broth", "chicken stock", "beef stock", "stock cube", "bouillon", "soy sauce", "fish sauce", "oyster sauce", "worcestershire sauce", "hoisin sauce", "sriracha", "hot sauce", "tomato sauce", "ketchup", "tomato paste", "tomato puree", "passata", "tinned tomato", "canned tomato", "chopped tomato", "beans", "tinned bean", "chickpea", "lentil", "quinoa", "couscous", "bulgur", "polenta", "semolina", "oat", "rolled oat", "porridge oat", "peanut butter", "jam", "marmalade", "chocolate", "dark chocolate", "milk chocolate", "cocoa", "cocoa powder", "baking powder", "baking soda", "yeast", "dried yeast", "gelatin", "gelatine", "coconut milk", "coconut cream", "tinned coconut milk", "water", "sparkling water", "mayonnaise", "mayo", "mustard", "dijon mustard", "dates", "date", "raisin", "sultana", "prune", "apricot", "dried apricot", "almond", "peanut", "cashew", "walnut", "pecan", "hazelnut", "pistachio", "pine nut", "seed", "sunflower seed", "pumpkin seed", "chia seed", "tahini", "wine", "white wine", "red wine", "beer", "lager", "rum", "brandy", "whiskey", "whisky", "vodka", "coffee", "instant coffee", "espresso", "tea"]],
];

// ── Name normalization / fuzzy matching (development.md §4 step 3) ───────────

const DESCRIPTOR_PREFIXES = [
  "fresh", "freshly", "chopped", "sliced", "diced", "minced", "grated",
  "ground", "finely", "roughly", "large", "small", "medium", "ripe", "raw",
  "cooked", "boiled", "fried", "baked", "boneless", "skinless", "skin on",
  "bone in", "free range", "organic", "whole", "half", "quarter", "dried",
  "drained", "rinsed", "peeled", "crushed", "shredded", "cubed", "halved",
  "quartered", "thinly", "coarsely", "optional", "plus extra", "extra",
  "to taste", // "salt, to taste" → "salt" (unit qualifier, not part of the name)
];
/** Longest-first so "plus extra" wins over "extra" when scanning. */
const DESCRIPTOR_PHRASES = [...DESCRIPTOR_PREFIXES].sort((a, b) => b.length - a.length);

/** Quantity words to drop so "2 cups flour" normalizes to "flour". */
const UNIT_WORDS = new Set([
  "g", "gram", "grams", "kg", "ml", "l", "litre", "liter", "tsp", "tbsp",
  "teaspoon", "tablespoon", "cup", "cups", "oz", "ounce", "ounces", "lb",
  "pound", "pounds", "piece", "pieces", "pinch", "clove", "cloves", "can",
  "cans", "tin", "tins", "pack", "packet", "handful", "sprig", "sprigs",
  "bunch", "slice", "slices", "dash", "splash", "knob",
]);

/** Singularize common English plurals — "tomatoes" → "tomato" (§4 step 3). */
function singularize(word: string): string {
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("oes") && word.length > 4) return word.slice(0, -2); // tomatoes → tomato
  if (word.endsWith("ses") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && word.length > 3) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Canonical name for the Ingredient master table: lowercase, punctuation
 * stripped, prep descriptors removed, plural collapsed. One shared
 * normalizer for import-time matching and user-typed autocomplete (§9).
 */
export function normalizeIngredientName(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // "(optional)", "( chopped )"
    .replace(/[^a-z\s]/g, " ") // hyphens split too, so "free-range" hits the "free range" descriptor
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !UNIT_WORDS.has(w));
  const stripped = stripDescriptors(words); // descriptors anywhere, not just leading
  if (stripped.length === 0) return "";
  return stripped.map(singularize).join(" ");
}

/** Remove descriptor phrases ("free range", "skin on", "finely chopped") at any position. */
function stripDescriptors(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    const phrase = DESCRIPTOR_PHRASES.find((p) => {
      const parts = p.split(" ");
      return words.slice(i, i + parts.length).join(" ") === p;
    });
    if (phrase) i += phrase.split(" ").length;
    else out.push(words[i++]!);
  }
  return out;
}

// ── Role classification (development.md §6.1) ────────────────────────────────

export interface RoleTagInput {
  name: string;
  quantity: number | null;
  unit: Unit | null;
}

const SMALL_UNITS: ReadonlySet<Unit | null> = new Set(["tsp", "pinch", "to_taste", null]);
const SMALL_QUANTITY = 1; // ≤ 1 tsp/pinch/unquantified of a flexible-ish item

/** Rule-based main/swap classification — runs standalone, no LLM (§6.1). */
export function classifyRoleTag(ingredient: RoleTagInput, recipeTitle: string): "main" | "swap" {
  const canonical = normalizeIngredientName(ingredient.name);
  const title = recipeTitle.toLowerCase();
  if (canonical && title.includes(canonical)) return "main"; // title-mentioned wins
  if (PROTEINS.has(canonical) || STARCHES.has(canonical)) return "main";
  if (FLEXIBLE_INGREDIENTS.has(canonical)) return "swap";
  const small =
    ingredient.unit === "pinch" ||
    ingredient.unit === "to_taste" ||
    (SMALL_UNITS.has(ingredient.unit) && ingredient.quantity !== null && ingredient.quantity <= SMALL_QUANTITY);
  if (small) return "swap";
  return "main";
}

// ── Diet tag inference (development.md §6.2) ─────────────────────────────────

export const DietTag = z.enum(["vegan", "vegetarian", "gluten_free", "dairy_free", "nut_free"]);
export type DietTagValue = z.infer<typeof DietTag>;

/**
 * Dictionary-based diet inference. Ambiguous animal products (e.g.
 * Worcestershire sauce) are treated as containing the animal product —
 * err on the side of NOT claiming a diet tag (§6.2).
 */
export function inferDietTags(ingredientNames: readonly string[]): DietTagValue[] {
  const names = ingredientNames.map(normalizeIngredientName);
  const has = (dict: ReadonlySet<string>) => names.some((n) => dict.has(n));

  const hasMeat = has(MEAT) || has(OTHER_ANIMAL);
  const hasEgg = has(EGGS);
  const hasDairy = has(DAIRY);
  const tags: DietTagValue[] = [];
  if (!hasMeat && !hasEgg && !hasDairy) tags.push("vegan");
  if (!hasMeat) tags.push("vegetarian");
  if (!has(GLUTEN)) tags.push("gluten_free");
  if (!hasDairy) tags.push("dairy_free");
  if (!has(NUTS)) tags.push("nut_free");
  return tags;
}

// ── System tag heuristics (development.md §6.3) ──────────────────────────────

export const PREP_TIME_BUCKETS = ["Under 15 min", "Under 30 min", "Under 60 min", "Over 60 min"] as const;
export type PrepTimeBucket = (typeof PREP_TIME_BUCKETS)[number];

export function prepTimeBucket(totalMinutes: number | null): PrepTimeBucket | null {
  if (totalMinutes === null) return null;
  if (totalMinutes < 15) return "Under 15 min";
  if (totalMinutes < 30) return "Under 30 min";
  if (totalMinutes < 60) return "Under 60 min";
  return "Over 60 min";
}

/** Difficulty heuristic: step count + total time (§6.3). */
export function difficultyHeuristic(stepCount: number, totalMinutes: number | null): "easy" | "medium" | "hard" {
  const minutes = totalMinutes ?? 30; // untimed recipes score as a default 30
  const score = stepCount + minutes / 15;
  if (score <= 8) return "easy";
  if (score <= 15) return "medium";
  return "hard";
}

export type SystemTagType = "meal_type" | "cuisine" | "diet" | "prep_time" | "difficulty";

export interface SystemTag {
  tag_type: SystemTagType;
  label: string;
}

/** Auto tags for a recipe — cuisine/meal_type when known + derived buckets. */
export function systemTagsForRecipe(summary: {
  cuisine: string | null;
  mealType: string | null;
  totalMinutes: number | null;
  stepCount: number;
  dietTags: readonly string[];
}): SystemTag[] {
  const tags: SystemTag[] = [];
  if (summary.cuisine) tags.push({ tag_type: "cuisine", label: summary.cuisine });
  if (summary.mealType) tags.push({ tag_type: "meal_type", label: summary.mealType });
  const bucket = prepTimeBucket(summary.totalMinutes);
  if (bucket) tags.push({ tag_type: "prep_time", label: bucket });
  tags.push({
    tag_type: "difficulty",
    label: difficultyHeuristic(summary.stepCount, summary.totalMinutes),
  });
  for (const diet of summary.dietTags) {
    tags.push({ tag_type: "diet", label: dietToLabel(diet) });
  }
  return tags;
}

const DIET_LABELS: Record<string, string> = {
  vegan: "Vegan",
  vegetarian: "Vegetarian",
  gluten_free: "Gluten Free",
  dairy_free: "Dairy Free",
  nut_free: "Nut Free",
};

export function dietToLabel(diet: string): string {
  return DIET_LABELS[diet] ?? diet;
}

// ── Grocery category lookup (development.md §6.4) ────────────────────────────

export function ingredientCategory(name: string): GroceryCategory {
  const canonical = normalizeIngredientName(name);
  for (const [category, names] of CATEGORY_TABLE) {
    if (names.includes(canonical)) return category;
  }
  // Last-word fallback: "cheddar cheese" → "cheese", "baby spinach" →
  // "spinach". Exact compound matches win first ("tomato sauce" stays pantry,
  // not produce), so this only fires on names the table lacks outright.
  const lastWord = canonical.split(" ").at(-1);
  if (lastWord && lastWord !== canonical) {
    for (const [category, names] of CATEGORY_TABLE) {
      if (names.includes(lastWord)) return category;
    }
  }
  return "other";
}

// ── Duration estimation from instruction text (development.md §4 step 2) ────

const DURATION_RE = /(\d+(?:\.\d+)?)\s*(?:-|–|to\s+)?\s*(?:(\d+(?:\.\d+)?)\s*)?(minute|minutes|min|hour|hours|hr|hrs)\b/gi;

/** "simmer for 10 minutes" → 10; "bake 1 hour" → 60; ranges take the upper bound. */
export function estimateDurationMinutes(instructionText: string): number | null {
  let max = 0;
  for (const match of instructionText.matchAll(DURATION_RE)) {
    const n = match[2] !== undefined ? Number(match[2]) : Number(match[1]);
    const isHours = match[3]!.toLowerCase().startsWith("h");
    const minutes = isHours ? n * 60 : n;
    if (minutes > max) max = minutes;
  }
  return max > 0 ? Math.round(max) : null;
}

// ── API shapes (development.md §3 "Tag", §11) ────────────────────────────────

export const TagType = z.enum([
  "meal_type", "cuisine", "diet", "prep_time", "difficulty",
  "ingredient_based", "custom",
]);
export type TagTypeValue = z.infer<typeof TagType>;

export const TagOut = z.object({
  id: z.string(),
  label: z.string(),
  parent_tag_id: z.string().nullable(),
  tag_type: TagType,
});
export type TagOut = z.infer<typeof TagOut>;

export interface TagNodeValue extends z.infer<typeof TagOut> {
  children: TagNodeValue[];
}
export const TagNode: z.ZodType<TagNodeValue> = TagOut.extend({
  children: z.array(z.lazy(() => TagNode)),
});
export type TagNode = TagNodeValue;

export const CreateTagInput = z.object({
  label: z.string().min(1).max(60),
  tag_type: TagType.default("custom"),
  parent_tag_id: z.string().nullable().default(null),
});
export type CreateTagInput = z.infer<typeof CreateTagInput>;

export const PublicApiImportInput = z.object({
  provider: z.enum(["mealdb", "spoonacular"]).default("mealdb"),
  provider_recipe_id: z.string().min(1).max(60),
});
export type PublicApiImportInput = z.infer<typeof PublicApiImportInput>;

export const ImportSearchResult = z.object({
  provider_recipe_id: z.string(),
  title: z.string(),
  thumbnail_url: z.string().nullable(),
  category: z.string().nullable(),
  area: z.string().nullable(),
});
export type ImportSearchResult = z.infer<typeof ImportSearchResult>;
