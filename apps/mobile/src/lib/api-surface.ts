// Endpoint surface — one typed method per REST endpoint (development.md §11),
// mirroring apps/web/src/lib/api.ts. Login/signup go through rawRequest to
// capture the set-cookie token; everything else uses request().
import type {
  DietProfileOut,
  DiscoverResponse,
  IngredientOption,
  InternalRecommendationsResponse,
  MealPlanEntryOut,
  QuickAddInput,
  RecipeBlocks,
  RecipeSearchPage,
  RecipeSearchResult,
  ScaledRecipe,
  TagNode,
  YoutubeExtractionDraft,
} from "@cookbook/shared";
import { ApiRequestError, rawRequest, request, tokenFromSetCookie } from "./api-transport";

/** List-item subset — same shape as the web client's RecipeSummary. */
export type RecipeSummary = Pick<
  RecipeSearchResult,
  "id" | "title" | "hero_image_url" | "base_servings" | "total_time_minutes" | "source_type"
>;

// Re-exported for callers that catch typed errors.
export { ApiRequestError };

async function authCall(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await rawRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const bodyJson = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new ApiRequestError(res.status, bodyJson?.error ?? "request_failed", bodyJson?.message);
  }
  const token = tokenFromSetCookie(res);
  if (token) {
    const { setSessionToken } = await import("./session");
    await setSessionToken(token);
  }
}

export const api = {
  signup: (username: string, displayName?: string) =>
    authCall("/auth/signup", { username, display_name: displayName }),
  login: (username: string) => authCall("/auth/login", { username }),
  logout: async () => {
    await request("/auth/logout", { method: "POST" });
    const { clearSessionToken } = await import("./session");
    await clearSessionToken();
  },
  me: () => request<{ id: string; username: string; display_name: string }>("/users/me"),
  dietProfile: () => request<DietProfileOut>("/users/me/diet-profile"),

  listRecipes: (page = 1, pageSize = 24, since?: string) =>
    request<RecipeSearchPage>(`/recipes?page=${page}&page_size=${pageSize}${since ? `&since=${encodeURIComponent(since)}` : ""}`),
  getRecipe: (id: string) => request<RecipeBlocks & { id: string }>(`/recipes/${id}`),
  createRecipe: (body: RecipeBlocks) =>
    request<RecipeBlocks & { id: string }>("/recipes", { method: "POST", body: JSON.stringify(body) }),
  updateRecipeBlocks: (id: string, body: RecipeBlocks) =>
    request<RecipeBlocks & { id: string }>(`/recipes/${id}/blocks`, { method: "PUT", body: JSON.stringify(body) }),
  deleteRecipe: (id: string) => request<void>(`/recipes/${id}`, { method: "DELETE" }),
  scaleRecipe: (id: string, servings: number) =>
    request<ScaledRecipe>(`/recipes/${id}/scale?servings=${servings}`),
  favorites: () => request<{ items: RecipeSummary[] }>("/recipes/favorites"),
  setFavorite: (id: string, on: boolean) =>
    request(`/recipes/${id}/favorite`, on ? { method: "POST" } : { method: "DELETE" }),
  markCooked: (id: string) => request<void>(`/recipes/${id}/cooked`, { method: "POST" }),

  tags: () => request<{ tree: TagNode[] }>("/tags"),

  importYoutube: (url: string) =>
    request<YoutubeExtractionDraft>("/recipes/import/youtube", { method: "POST", body: JSON.stringify({ url }) }),

  mealPlans: (week?: string, date?: string) =>
    request<{ items: MealPlanEntryOut[] }>(`/meal-plans?${week ? `week=${week}` : `date=${date}`}`),
  quickAdd: (body: QuickAddInput) =>
    request<MealPlanEntryOut>("/meal-plans/quick-add", { method: "POST", body: JSON.stringify(body) }),
  upcoming: () => request<{ entries: MealPlanEntryOut[] }>("/meal-plans/upcoming"),

  recommendations: () => request<InternalRecommendationsResponse>("/recommendations/internal"),
  discover: () => request<DiscoverResponse>("/recommendations/discover"),

  ingredients: (q: string) =>
    request<{ options: IngredientOption[] }>(`/ingredients/search?q=${encodeURIComponent(q)}`),
};
