// Sync engine — pull server changes into local SQLite, then drain the local
// mutation queue back to the server (App Plan.txt "Sync logic"). Pull runs
// FIRST so the push step's last-write-wins check sees fresh server
// timestamps, and pull skips recipes with pending local deletes so a
// locally-deleted recipe never reappears mid-sync.
//
// Triggers (initSyncTriggers): app start, offline→online transition, app
// foreground, manual (sync button / pull-to-refresh).
import { AppState } from "react-native";
import type { RecipeSearchResult } from "@cookbook/shared";
import { api, ApiRequestError } from "../lib/api-surface";
import { getSessionToken } from "../lib/session";
import { useNetworkStore } from "../stores/network";
import { useSyncStore } from "../stores/sync";
import { recipesRepo, type RecipeStub } from "../db/repositories/recipes";
import { mutationsRepo } from "../db/repositories/mutations";
import { metaRepo } from "../db/repositories/meta";
import { advanceCursor, cursorTooOldForTombstones, resolveLww } from "./lww";

const PULL_PAGE_SIZE = 200;
const MAX_PULL_PAGES = 200; // safety cap: 200 × 200 = 40k recipes
const CURSOR_KEY = "last_pull_at";
const USER_KEY = "user_id";

let syncing = false;
let triggers: (() => void) | null = null;

async function ensureUserId(): Promise<string | null> {
  let userId = await metaRepo.get(USER_KEY);
  if (!userId) {
    const me = await api.me();
    userId = me.id;
    await metaRepo.set(USER_KEY, userId);
  }
  return userId;
}

// ── Pull ──────────────────────────────────────────────────────────────────────

async function pull(): Promise<void> {
  const userId = await ensureUserId();
  const previousCursor = await metaRepo.get(CURSOR_KEY);
  const fullPull = cursorTooOldForTombstones(previousCursor);
  const since = fullPull ? undefined : (previousCursor ?? undefined);
  const pendingDeletes = await mutationsRepo.pendingRecipeIds();

  const seen: string[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore && page <= MAX_PULL_PAGES) {
    const result = await api.listRecipes(page, PULL_PAGE_SIZE, since);
    for (const item of result.items) {
      // A recipe deleted locally (pending mutation) must not come back from
      // the server before the push lands.
      if (pendingDeletes.has(item.id)) continue;
      await recipesRepo.upsertFromServer(item);
      seen.push(item.updated_at);
    }
    hasMore = result.has_more;
    page += 1;
  }
  const cursor = advanceCursor(previousCursor, seen);
  if (cursor) await metaRepo.set(CURSOR_KEY, cursor);

  // Tombstones: recipes deleted server-side disappear from the phone too.
  // Queried with the PREVIOUS cursor — deletions since the last sync (a
  // cursor advanced just now would miss them all).
  const tombstoneSince = fullPull ? "1970-01-01T00:00:00Z" : previousCursor ?? "1970-01-01T00:00:00Z";
  const deleted = await api.deleted(tombstoneSince);
  for (const id of deleted.ids) {
    if (pendingDeletes.has(id)) continue; // already gone locally
    await recipesRepo.remove(id);
  }

  // Favorites list (small): server state wins unless a local toggle is queued.
  const favorites = await api.listFavorites();
  await recipesRepo.applyServerFavorites(favorites.map((f) => f.id));

  // Full content for the user's own recipes + favorites (the offline library —
  // the 13.5k shared dataset stays stub-only until opened; App Plan.txt).
  // contentIsStale() is true when no content row exists, so first sync fetches.
  if (userId) {
    const stubs = await recipesRepo.list();
    const wantContent = stubs.filter(
      (s) => (s.user_id === userId || s.favorite === 1) && s.dirty === 0,
    );
    for (const stub of wantContent) {
      if (await recipesRepo.contentIsStale(stub.id)) {
        await fetchContent(stub);
      }
    }
  }
}

async function fetchContent(stub: RecipeStub): Promise<void> {
  const blocks = await api.getRecipe(stub.id);
  await recipesRepo.saveContent(stub.id, blocks, stub.updated_at);
}

// ── Push ──────────────────────────────────────────────────────────────────────

async function push(): Promise<void> {
  const queue = await mutationsRepo.pending();
  for (const m of queue) {
    try {
      await applyMutation(m);
      await mutationsRepo.remove(m.id);
    } catch (err) {
      if (!(err instanceof ApiRequestError)) throw err;
      if (err.status === 0) break; // network — retry on the next trigger
      if (err.status === 401) break; // logged out — needs re-auth, not a drop
      if (err.status === 404 && m.op !== "create" && m.op !== "favorite") {
        // Target already gone server-side (e.g. deleted on web): intent
        // satisfied — drop the mutation, and for updates remove the stub.
        await mutationsRepo.remove(m.id);
        if (m.op === "update") await recipesRepo.remove(m.recipe_id!);
        continue;
      }
      await mutationsRepo.drop(m.id, `${m.op} ${m.recipe_id}: ${err.message ?? err.code}`);
    }
  }
}

async function applyMutation(m: Awaited<ReturnType<typeof mutationsRepo.pending>>[number]): Promise<void> {
  switch (m.op) {
    case "update": {
      const stub = await recipesRepo.get(m.recipe_id!);
      if (stub) {
        // LWW (sync/lww.ts): the pull just refreshed stub.updated_at — the
        // server's current version timestamp.
        const decision = resolveLww({
          serverUpdatedAt: stub.updated_at,
          baseUpdatedAt: m.base_updated_at,
          localEditedAt: m.created_at,
        });
        if (decision.winner === "server") {
          useSyncStore.getState().pushConflict(m.recipe_id!);
          await recipesRepo.clearDirty(m.recipe_id!);
          return; // local edit dropped; next pull restores the server version
        }
      }
      await api.updateRecipeBlocks(m.recipe_id!, m.payload!);
      await recipesRepo.clearDirty(m.recipe_id!);
      // Note: the API response carries no updated_at, so the stub's cursor
      // stays at its base — the next pull re-downloads this recipe and
      // advances the cursor. One redundant fetch per push, correct by design.
      return;
    }
    case "delete": {
      await api.deleteRecipe(m.recipe_id!);
      return;
    }
    case "favorite": {
      await api.setFavorite(m.recipe_id!, true);
      return;
    }
    case "unfavorite": {
      await api.setFavorite(m.recipe_id!, false);
      return;
    }
    case "create": {
      // M6 (editor) enqueues creates; the engine supports them already:
      // POST returns the server-assigned id, the temp stub is replaced.
      const created = await api.createRecipe(m.payload!);
      await recipesRepo.remove(m.recipe_id!);
      await recipesRepo.upsertFromServer({
        id: created.id,
        title: created.title,
        hero_image_url: created.hero_image_url,
        base_servings: 2,
        total_time_minutes: null,
        source_type: "manual",
        updated_at: new Date().toISOString(),
        user_id: await metaRepo.get(USER_KEY),
      });
      return;
    }
  }
}

// ── Engine + triggers ─────────────────────────────────────────────────────────

export interface SyncOutcome {
  ran: boolean;
  reason?: "no-session" | "offline" | "busy";
}

export async function sync(): Promise<SyncOutcome> {
  if (syncing) return { ran: false, reason: "busy" };
  const token = await getSessionToken();
  if (!token) return { ran: false, reason: "no-session" };
  if (!useNetworkStore.getState().isOnline) {
    useSyncStore.getState().set({ status: "offline" });
    return { ran: false, reason: "offline" };
  }

  syncing = true;
  const store = useSyncStore.getState();
  store.set({ status: "syncing", error: null });
  try {
    await pull();
    await push();
    useSyncStore.getState().set({
      status: "ok",
      lastSyncAt: new Date().toISOString(),
      pendingCount: await mutationsRepo.pendingCount(),
    });
    return { ran: true };
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 0) {
      // Went offline mid-sync — not an error; the watcher re-triggers later.
      useNetworkStore.getState().setOnline(false);
      useSyncStore.getState().set({ status: "offline" });
    } else {
      useSyncStore.getState().set({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
    useSyncStore.getState().set({ pendingCount: await mutationsRepo.pendingCount() });
    return { ran: true };
  } finally {
    syncing = false;
  }
}

/** Boots sync triggers. Returns a cleanup fn. Call once from the root layout. */
export function initSyncTriggers(): () => void {
  if (triggers) return triggers;

  void sync();

  const unsubNetwork = useNetworkStore.subscribe((state, prev) => {
    if (state.isOnline && !prev.isOnline) void sync(); // reconnected — drain queue
  });

  const appStateSub = AppState.addEventListener("change", (s) => {
    if (s === "active") void sync();
  });

  triggers = () => {
    unsubNetwork();
    appStateSub.remove();
    triggers = null;
  };
  return triggers;
}
