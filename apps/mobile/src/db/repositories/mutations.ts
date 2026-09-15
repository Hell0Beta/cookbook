// Mutation queue — ordered log of local edits pending push. Strict FIFO by
// rowid; the sync engine replays it on every sync trigger. Network errors
// stop the replay (retry next trigger); 4xx drops the item (server rejected).
import type { RecipeBlocks } from "@cookbook/shared";
import { getDb } from "../client";

export interface MutationRow {
  id: number;
  entity: "recipe" | "favorite";
  op: "create" | "update" | "delete" | "favorite" | "unfavorite";
  recipe_id: string | null;
  payload: RecipeBlocks | null;
  base_updated_at: string | null;
  created_at: string;
  attempts: number;
  last_error: string | null;
}

export const mutationsRepo = {
  async enqueue(
    entity: MutationRow["entity"],
    op: MutationRow["op"],
    opts: {
      recipeId?: string;
      payload?: RecipeBlocks;
      baseUpdatedAt?: string;
    } = {},
  ): Promise<void> {
    const db = await getDb();
    await db.runAsync(
      `INSERT INTO mutation_queue (entity, op, recipe_id, payload_json, base_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        entity, op, opts.recipeId ?? null,
        opts.payload ? JSON.stringify(opts.payload) : null,
        opts.baseUpdatedAt ?? null,
        new Date().toISOString(),
      ],
    );
  },

  /** Pending mutations in replay order. */
  async pending(): Promise<MutationRow[]> {
    const db = await getDb();
    const rows = await db.getAllAsync<Record<string, unknown>>(
      "SELECT id, entity, op, recipe_id, payload_json, base_updated_at, created_at, attempts, last_error FROM mutation_queue ORDER BY id ASC",
    );
    return rows.map((r) => ({
      id: r.id as number,
      entity: r.entity as MutationRow["entity"],
      op: r.op as MutationRow["op"],
      recipe_id: (r.recipe_id as string | null) ?? null,
      payload: r.payload_json ? (JSON.parse(r.payload_json as string) as RecipeBlocks) : null,
      base_updated_at: (r.base_updated_at as string | null) ?? null,
      created_at: r.created_at as string,
      attempts: (r.attempts as number) ?? 0,
      last_error: (r.last_error as string | null) ?? null,
    }));
  },

  async remove(id: number): Promise<void> {
    const db = await getDb();
    await db.runAsync("DELETE FROM mutation_queue WHERE id = ?", [id]);
  },

  /** Server rejected the mutation (4xx) — drop it, keep the error for surfacing. */
  async drop(id: number, error: string): Promise<void> {
    const db = await getDb();
    await db.runAsync("DELETE FROM mutation_queue WHERE id = ?", [id]);
    await db.runAsync(
      "INSERT INTO sync_meta (key, value) VALUES ('last_drop', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [`${new Date().toISOString()}: ${error}`],
    );
  },

  /** Recipe ids with pending mutations, so pull can exclude locally-deleted recipes etc. */
  async pendingRecipeIds(): Promise<Set<string>> {
    const db = await getDb();
    const rows = await db.getAllAsync<{ recipe_id: string }>(
      "SELECT DISTINCT recipe_id FROM mutation_queue WHERE recipe_id IS NOT NULL",
    );
    return new Set(rows.map((r) => r.recipe_id));
  },

  async pendingCount(): Promise<number> {
    const db = await getDb();
    const row = await db.getFirstAsync<{ n: number }>(
      "SELECT COUNT(*) AS n FROM mutation_queue",
    );
    return row?.n ?? 0;
  },
};
