// Typed API client — all requests carry the session cookie (username-only auth,
// development.md §0). Errors normalize to the { error, message? } convention (§11).
import type { ApiError, DietProfileOut, DiscoverResponse, ImportSearchResult, IngredientOption, InternalRecommendationsResponse, MealPlanEntryOut, QuickAddInput, RecipeBlocks, RecipeSearchResult, TagNode, YoutubeExtractionDraft } from "@cookbook/shared";

// API base URL. Default follows the browser's hostname so localhost and LAN
// (phone) browsing both work — the session cookie is host-scoped, so a
// hardcoded LAN IP would silently log out desktop users and vice versa.
// NEXT_PUBLIC_API_URL remains as an explicit override (e.g. reverse-proxy
// deploys); `||` (not `??`) so an EMPTY string — the docker build's default
// build-arg — also falls through.
const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : "http://localhost:3001");

/**
 * API-served asset paths ("/images/...") must point at the API origin — the
 * browser resolves them against the web origin otherwise and gets a 404.
 * Same-origin paths (e.g. "/icons/...") pass through untouched.
 */
export const apiAsset = (path: string) =>
  path.startsWith("/images/") ? `${API_URL}${path}` : path;

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body && !(init.body instanceof Blob) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) {
    throw new ApiRequestError(res.status, (body as ApiError | null)?.error ?? "request_failed", (body as ApiError | null)?.message);
  }
  return body as T;
}

export const api = {
  signup: (username: string, displayName?: string) =>
    request<{ id: string; username: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ username, display_name: displayName }),
    }),
  login: (username: string) =>
    request<{ id: string; username: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username }),
    }),
  me: () => request<{ id: string; username: string; display_name: string }>("/users/me"),

  listRecipes: (page = 1) =>
    request<RecipeSearchPage>(`/recipes?page=${page}`),
  getRecipe: (id: string) => request<RecipeBlocks>(`/recipes/${id}`),
  createRecipe: (body: RecipeBlocks) =>
    request<RecipeBlocks & { id: string }>("/recipes", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateRecipeBlocks: (id: string, body: RecipeBlocks) =>
    request<RecipeBlocks & { id: string }>(`/recipes/${id}/blocks`, { method: "PUT", body: JSON.stringify(body) }),
  deleteRecipe: (id: string) => request<void>(`/recipes/${id}`, { method: "DELETE" }),
  scaleRecipe: (id: string, servings: number) =>
    request<ScaledRecipe>(`/recipes/${id}/scale?servings=${servings}`),

  // Cover art upload (POST /images — raw body + content-type, per the images route)
  uploadImage: (file: File) =>
    request<{ url: string }>("/images", { method: "POST", body: file, headers: { "Content-Type": file.type } }),

  // Public-API import (development.md §4, §11) — TheMealDB default
  searchPublicApi: (q: string) =>
    request<ImportSearchResult[]>(`/recipes/import/public-api/search?q=${encodeURIComponent(q)}`),
  importPublicApi: (providerRecipeId: string) =>
    request<RecipeBlocks & { id: string }>("/recipes/import/public-api", {
      method: "POST",
      body: JSON.stringify({ provider: "mealdb", provider_recipe_id: providerRecipeId }),
    }),

  // YouTube import (development.md §5, §11) — returns a DRAFT, never saves
  importYoutube: (url: string) =>
    request<YoutubeExtractionDraft>("/recipes/import/youtube", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),

  // Tags (development.md §11)
  getTags: () => request<TagNode[]>("/tags"),
  createTag: (body: { label: string; tag_type?: string; parent_tag_id?: string | null }) =>
    request<TagNode>("/tags", { method: "POST", body: JSON.stringify(body) }),

  // Grocery list (development.md §8.2, §11; design.md §3.6)
  createGroceryList: (
    recipeIds: string[],
    servingsOverrides: Record<string, number> = {},
    mode: "replace" | "append" = "replace",
  ) =>
    request<GroceryList>("/grocery-lists", {
      method: "POST",
      body: JSON.stringify({ recipe_ids: recipeIds, servings_overrides: servingsOverrides, mode }),
    }),
  getActiveGroceryList: async (): Promise<GroceryList | null> => {
    try {
      return await request<GroceryList>("/grocery-lists/active");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 404) return null;
      throw err;
    }
  },
  getGroceryList: (id: string) => request<GroceryList>(`/grocery-lists/${id}`),
  patchGroceryItem: (
    listId: string,
    itemId: string,
    patch: { is_purchased?: boolean; quantity?: number | null; unit?: string | null; category?: string },
  ) =>
    request<GroceryListItem>(`/grocery-lists/${listId}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteGroceryItem: (listId: string, itemId: string) =>
    request<void>(`/grocery-lists/${listId}/items/${itemId}`, { method: "DELETE" }),
  addGroceryItem: (
    listId: string,
    item: { label: string; quantity?: number | null; unit?: string | null; category?: string },
  ) =>
    request<GroceryListItem>(`/grocery-lists/${listId}/items`, {
      method: "POST",
      body: JSON.stringify(item),
    }),

  // Meal plans (development.md §7.2, §11; design.md §3.4)
  quickAddMeal: (body: QuickAddInput) =>
    request<MealPlanEntryOut>("/meal-plans/quick-add", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getUpcomingMeals: () => request<MealPlanEntryOut[]>("/meal-plans/upcoming"),
  getMealsForSlot: (date: string, slot: MealSlotParam) =>
    request<MealPlanEntryOut[]>(`/meal-plans/for-slot?date=${date}&slot=${slot}`),
  getMealsForDate: (date: string) =>
    request<MealPlanEntryOut[]>(`/meal-plans?date=${date}`),
  getMealsForWeek: (week: string) =>
    request<MealPlanEntryOut[]>(`/meal-plans?week=${week}`),
  // Direct assignment (planner drag-and-drop) + reassign/remove (§11)
  assignMeal: (body: { recipe_id: string; date: string; meal_slot?: MealSlotParam | null }) =>
    request<MealPlanEntryOut>("/meal-plans", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMealPlanEntry: (
    id: string,
    patch: { date?: string; meal_slot?: MealSlotParam | null; servings_planned?: number },
  ) =>
    request<MealPlanEntryOut>(`/meal-plans/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deleteMealPlanEntry: (id: string) =>
    request<void>(`/meal-plans/${id}`, { method: "DELETE" }),

  // Favorites — planner "Saved & Favorited" sidebar (development.md §11)
  listFavorites: () => request<RecipeSummary[]>("/recipes/favorites"),
  addFavorite: (id: string) =>
    request<{ id: string; favorited: boolean }>(`/recipes/${id}/favorite`, { method: "POST" }),
  removeFavorite: (id: string) =>
    request<void>(`/recipes/${id}/favorite`, { method: "DELETE" }),

  // Ingredient-based search + filters (development.md §9, §11 — Phase 8).
  // Paginated since the dataset import (13.5k shared recipes).
  searchRecipes: (params: {
    q?: string;
    tags?: string[];
    ingredients?: string[];
    page?: number;
  }) => {
    const search = new URLSearchParams();
    if (params.q) search.set("q", params.q);
    if (params.tags && params.tags.length > 0) search.set("tags", params.tags.join(","));
    if (params.ingredients && params.ingredients.length > 0)
      search.set("ingredients", params.ingredients.join(","));
    if (params.page && params.page > 1) search.set("page", String(params.page));
    const qs = search.toString();
    return request<RecipeSearchPage>(`/recipes${qs ? `?${qs}` : ""}`);
  },
  autocompleteIngredients: (q: string) =>
    request<IngredientOption[]>(`/ingredients?q=${encodeURIComponent(q)}`),

  // Diet profile + recommendations (development.md §10, §11 — Phase 9)
  meWithProfile: () =>
    request<{ id: string; username: string; display_name: string; diet_profile: DietProfileOut | null }>("/users/me"),
  putDietProfile: (body: DietProfileOut) =>
    request<{ diet_profile: DietProfileOut | null }>("/users/me/diet-profile", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  getInternalRecommendations: () =>
    request<InternalRecommendationsResponse>("/recommendations/internal"),
  markCooked: (recipeId: string) =>
    request<void>(`/recipes/${recipeId}/cooked`, { method: "POST" }),

  // Tier 2 "Discover" suggestions from the local dataset (development.md §10,
  // §11). No LLM call anymore — can never quota-fail.
  getDiscover: () => request<DiscoverResponse>("/recommendations/discover"),
};

// GET /recipes list item (lighter than the full block stack).
export interface RecipeSummary {
  id: string;
  title: string;
  hero_image_url: string | null;
  base_servings: number;
  total_time_minutes: number | null;
  source_type: string;
}

// GET /recipes paginated envelope (search screen).
export interface RecipeSearchPage {
  items: RecipeSearchResult[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
}

export interface ScaledRecipe {
  recipe_id: string;
  base_servings: number;
  target_servings: number;
  ingredients: {
    raw_text: string;
    quantity: number | null;
    display: string;
    approximate: boolean;
    unit: string | null;
  }[];
}

// GET/POST /grocery-lists shapes (mirrors @cookbook/shared GroceryListOut)
export interface GroceryListItem {
  id: string;
  label: string;
  ingredient_id: string | null;
  quantity: number | null;
  unit: string | null;
  display: string;
  approximate: boolean;
  category: string;
  is_purchased: boolean;
  source_recipe_ids: string[];
  recipe_count: number;
}

export interface GroceryList {
  id: string;
  name: string;
  status: string;
  created_at: string;
  items: GroceryListItem[];
}

export const GROCERY_CATEGORY_LABELS: Record<string, string> = {
  produce: "Produce",
  dairy: "Dairy",
  meat: "Meat",
  pantry: "Pantry",
  spice: "Spices",
  frozen: "Frozen",
  bakery: "Bakery",
  other: "Other",
};

// Meal-slot URL param values (development.md §3 MealPlanEntry.meal_slot)
export type MealSlotParam = "breakfast" | "lunch" | "dinner" | "snack";
