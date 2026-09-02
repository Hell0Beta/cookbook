// Entity schemas mirroring docs/development.md §3 "Data Model".
// Field names are contractual — a rename here requires updating that doc.
import { z } from "zod";

// ── Enums (development.md §3) ────────────────────────────────────────────────

export const SourceType = z.enum(["manual", "youtube_import", "public_api", "web_import", "dataset"]);
export type SourceType = z.infer<typeof SourceType>;

export const Unit = z.enum([
  "g", "kg", "ml", "l", "tsp", "tbsp", "cup", "oz", "lb",
  "piece", "pinch", "to_taste",
]);
export type Unit = z.infer<typeof Unit>;

export const RoleTag = z.enum(["main", "swap"]);
export type RoleTag = z.infer<typeof RoleTag>;

export const MealSlot = z.enum(["breakfast", "lunch", "dinner", "snack"]);
export type MealSlot = z.infer<typeof MealSlot>;

export const GroceryCategory = z.enum([
  "produce", "dairy", "meat", "pantry", "spice", "frozen", "bakery", "other",
]);
export type GroceryCategory = z.infer<typeof GroceryCategory>;

// ── User / auth (development.md §0, §3) ──────────────────────────────────────

export const User = z.object({
  id: z.string(),
  username: z.string().min(1).max(40),
  display_name: z.string().min(1).max(80),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
});
export type User = z.infer<typeof User>;

export const SignupInput = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(40)
    .regex(/^[a-zA-Z0-9_-]+$/, "Letters, numbers, hyphens and underscores only"),
  display_name: z.string().min(1).max(80).optional(),
});
export type SignupInput = z.infer<typeof SignupInput>;

export const LoginInput = z.object({ username: z.string().min(1) });
export type LoginInput = z.infer<typeof LoginInput>;

// ── Recipe (development.md §3) ───────────────────────────────────────────────

export const Recipe = z.object({
  id: z.string(),
  user_id: z.string().nullable(),
  title: z.string().min(1),
  description: z.string().nullable(),
  hero_image_url: z.string().nullable(),
  base_servings: z.number().int().positive(),
  total_time_minutes: z.number().int().nullable(), // derived server-side
  source_type: SourceType,
  source_url: z.string().nullable(),
  cuisine: z.string().nullable(),
  meal_type: z.string().nullable(),
  difficulty: z.string().nullable(),
  diet_tags: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Recipe = z.infer<typeof Recipe>;

// ── Ingredients (development.md §3) ──────────────────────────────────────────

export const Ingredient = z.object({
  id: z.string(),
  canonical_name: z.string(),
  category: GroceryCategory,
  default_unit: Unit,
});
export type Ingredient = z.infer<typeof Ingredient>;

// ── Block model (development.md §7.1 "Unified Read/Edit Surface") ────────────
// The recipe is an ordered array of typed blocks; read and edit mode render
// the same components (design.md §3.3).

export const MetaBlock = z.object({
  id: z.string(),
  type: z.literal("meta"),
  servings: z.number().int().positive(),
  total_time_minutes: z.number().int().nullable(),
  source_type: SourceType,
  source_url: z.string().nullable(),
});
export type MetaBlock = z.infer<typeof MetaBlock>;

export const IngredientBlock = z.object({
  id: z.string(),
  type: z.literal("ingredient"),
  quantity: z.number().nullable(),
  unit: Unit.nullable(),
  // Empty allowed: blocks can be saved mid-draft (server drops empties).
  raw_text: z.string(),
  ingredient_id: z.string().nullable(), // null until matched against master table
  role_tag: RoleTag,
  swap_suggestions: z.array(z.string()),
  sort_order: z.number().int(),
});
export type IngredientBlock = z.infer<typeof IngredientBlock>;

export const StepBlock = z.object({
  id: z.string(),
  type: z.literal("step"),
  // 0 allowed: newly inserted steps number themselves client-side only for
  // display; persistence renumbers by position.
  step_number: z.number().int().min(0),
  instruction_text: z.string(),
  duration_minutes: z.number().int().nullable(), // powers the timer (design.md §3.3.2)
  image_url: z.string().nullable(),
});
export type StepBlock = z.infer<typeof StepBlock>;

export const NoteBlock = z.object({
  id: z.string(),
  type: z.literal("note"),
  text: z.string(),
});
export type NoteBlock = z.infer<typeof NoteBlock>;

export const RecipeBlock = z.discriminatedUnion("type", [
  MetaBlock,
  IngredientBlock,
  StepBlock,
  NoteBlock,
]);
export type RecipeBlock = z.infer<typeof RecipeBlock>;

// A recipe's full content for the unified reader/editor: scalar header fields
// plus the ordered block stack. Title/cover live on the recipe row; the meta
// block is derived from them on save.
export const RecipeBlocks = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  hero_image_url: z.string().nullable(),
  blocks: z.array(RecipeBlock),
});
export type RecipeBlocks = z.infer<typeof RecipeBlocks>;

// PUT /recipes/:id/blocks body — a single batch update (development.md §7.1).
export const RecipeBlocksUpdate = RecipeBlocks;
export type RecipeBlocksUpdate = z.infer<typeof RecipeBlocksUpdate>;

// ── API helpers ──────────────────────────────────────────────────────────────

export const ApiError = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

export const LlmQuotaError = ApiError.extend({
  error: z.literal("llm_quota_exceeded"),
});
export type LlmQuotaError = z.infer<typeof LlmQuotaError>;
