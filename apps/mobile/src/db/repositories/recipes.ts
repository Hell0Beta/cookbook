// Recipe repository — the ONLY layer screens touch for recipe data. Local
// SQLite is the source of truth on device; the sync engine fills it from the
// server and drains local edits back.
import type { RecipeBlocks, RecipeSearchResult } from "@cookbook/shared";
import { getDb } from "../client";

export interface RecipeStub {
  id: string;
  title: string;
  hero_image_url: string | null;
  base_servings: number;
  total_time_minutes: number | null;
  source_type: string;
  user_id: string | null;
  updated_at: string;
  content_state: "full" | "stub";
  last_opened_at: number | null;
  dirty: 0 | 1;
  favorite: 0 | 1;
}

function rowToStub(row: Record<string, unknown>): RecipeStub {
  return {
    id: row.id as string,
    title: row.title as string,
    hero_image_url: (row.hero_image_url as string | null) ?? null,
    base_servings: row.base_servings as number,
    total_time_minutes: (row.total_time_minutes as number | null) ?? null,
    source_type: row.source_type as string,
    user_id: (row.user_id as string | null) ?? null,
    updated_at: row.updated_at as string,
    content_state: (row.content_state as "full" | "stub") ?? "stub",
    last_opened_at: (row.last_opened_at as number | null) ?? null,
    dirty: (row.dirty as 0 | 1) ?? 0,
    favorite: (row.favorite as 0 | 1) ?? 0,
  };
}

const STUB_COLS =
  "id, title, hero_image_url, base_servings, total_time_minutes, source_type, user_id, updated_at, content_state, last_opened_at, dirty, favorite";

export const recipesRepo = {
  /** List stubs for the library screen (newest first, mirrors the web order). */
  async list(): Promise<RecipeStub[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT ${STUB_COLS} FROM recipe_stubs ORDER BY updated_at DESC`,
    );
    return rows.map(rowToStub);
  },

  async get(id: string): Promise<RecipeStub | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<Record<string, unknown>>(
      `SELECT ${STUB_COLS} FROM recipe_stubs WHERE id = ?`,
      [id],
    );
    return row ? rowToStub(row) : null;
  },

  /**
   * Pull upsert. Non-dirty rows take the server version wholesale; dirty rows
   * keep every local field but still advance updated_at — that's the conflict
   * signal the push step reads (see sync/lww.ts).
   */
  async upsertFromServer(item: RecipeSearchResult): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO recipe_stubs (id, title, hero_image_url, base_servings, total_time_minutes, source_type, user_id, updated_at, content_state, dirty, favorite)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT content_state FROM recipe_stubs WHERE id = ?), 'stub'), 0, 0)
       ON CONFLICT(id) DO UPDATE SET
         updated_at = excluded.updated_at,
         title      = CASE WHEN recipe_stubs.dirty = 1 THEN recipe_stubs.title      ELSE excluded.title END,
         hero_image_url = CASE WHEN recipe_stubs.dirty = 1 THEN recipe_stubs.hero_image_url ELSE excluded.hero_image_url END,
         base_servings  = CASE WHEN recipe_stubs.dirty = 1 THEN recipe_stubs.base_servings  ELSE excluded.base_servings END,
         total_time_minutes = CASE WHEN recipe_stubs.dirty = 1 THEN recipe_stubs.total_time_minutes ELSE excluded.total_time_minutes END,
         source_type = CASE WHEN recipe_stubs.dirty = 1 THEN recipe_stubs.source_type ELSE excluded.source_type END,
         user_id     = CASE WHEN recipe_stubs.dirty = 1 THEN recipe_stubs.user_id     ELSE excluded.user_id END,
         -- dirty stays as-is: a pending local edit must survive the pull
         -- (the push step resolves it via LWW and clears the flag).
         dirty       = recipe_stubs.dirty`,
      [
        item.id, item.title, item.hero_image_url, item.base_servings,
        item.total_time_minutes, item.source_type, item.user_id, item.updated_at,
        item.id,
      ],
    );
  },

  /**
   * Save full content fetched from the server. fetched_at is the SERVER
   * updated_at the content was downloaded at — comparing server timestamps
   * avoids device-clock skew in staleness checks.
   */
  async saveContent(recipeId: string, blocks: RecipeBlocks, serverUpdatedAt: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO recipe_content (recipe_id, blocks_json, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(recipe_id) DO UPDATE SET blocks_json = excluded.blocks_json, fetched_at = excluded.fetched_at`,
      [recipeId, JSON.stringify(blocks), serverUpdatedAt],
    );
    await db.runAsync(
      "UPDATE recipe_stubs SET content_state = 'full' WHERE id = ?",
      [recipeId],
    );
  },

  async getContent(recipeId: string): Promise<RecipeBlocks | null> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ blocks_json: string }>(
      "SELECT blocks_json FROM recipe_content WHERE recipe_id = ?",
      [recipeId],
    );
    if (!row) return null;
    return JSON.parse(row.blocks_json) as RecipeBlocks;
  },

  /** Content is stale when the stub's server updated_at passed the fetch baseline. */
  async contentIsStale(recipeId: string): Promise<boolean> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ fetched_at: string }>(
      `SELECT c.fetched_at FROM recipe_content c
       JOIN recipe_stubs s ON s.id = c.recipe_id
       WHERE c.recipe_id = ?`,
      [recipeId],
    );
    if (!row) return true;
    const stub = await this.get(recipeId);
    return !!stub && stub.updated_at > row.fetched_at;
  },

  /** Record a local edit (title/blocks updated optimistically; dirty until pushed). */
  async markDirty(recipeId: string, patch: Partial<Pick<RecipeStub, "title" | "hero_image_url" | "base_servings" | "total_time_minutes">>): Promise<void> {
    const db = await getDb();
    const sets = ["dirty = 1", ...Object.keys(patch).map((k) => `${k} = ?`)];
    const values = Object.values(patch);
    await db.runAsync(
      `UPDATE recipe_stubs SET ${sets.join(", ")} WHERE id = ?`,
      [...values, recipeId],
    );
    // Local edit invalidates the cached content snapshot (blocks come from the
    // editor's own state; M6 writes them here too).
    await db.runAsync("DELETE FROM recipe_content WHERE recipe_id = ?", [recipeId]);
  },

  /** Push succeeded — clear dirty and take the server's ack fields. */
  async clearDirty(recipeId: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("UPDATE recipe_stubs SET dirty = 0 WHERE id = ?", [recipeId]);
  },

  /** Local delete — row goes immediately (UI expectation); the queue holds the server op. */
  async remove(recipeId: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("DELETE FROM recipe_content WHERE recipe_id = ?", [recipeId]);
    await db.runAsync("DELETE FROM recipe_stubs WHERE id = ?", [recipeId]);
  },

  /** Usage signal for the eviction system (M10) + rehydrate bookkeeping. */
  async touchOpened(recipeId: string): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      "UPDATE recipe_stubs SET last_opened_at = ? WHERE id = ?",
      [Date.now(), recipeId],
    );
  },

  async setFavorite(recipeId: string, on: boolean): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      "UPDATE recipe_stubs SET favorite = ? WHERE id = ?",
      [on ? 1 : 0, recipeId],
    );
  },

  /** Apply the server's favorites list (ids not in the list drop to 0). */
  async applyServerFavorites(ids: string[]): Promise<void> {
    const db = await getDb();
    await db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        `UPDATE recipe_stubs SET favorite = CASE WHEN id IN
          (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END
          WHERE dirty = 0`,
        [JSON.stringify(ids)],
      );
    });
  },

  async count(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM recipe_stubs",
    );
    return row?.n ?? 0;
  },
};
