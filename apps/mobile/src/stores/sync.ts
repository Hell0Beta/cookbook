// Sync status — what the UI shows on the sync card / banner.
import { create } from "zustand";

export type SyncStatus = "idle" | "syncing" | "ok" | "offline" | "error";

export interface SyncState {
  status: SyncStatus;
  lastSyncAt: string | null;
  pendingCount: number;
  /** Recipes whose local edits lost to the server version (LWW) — surfaced, not silent. */
  conflicts: { recipeId: string; at: string }[];
  error: string | null;
  set: (patch: Partial<Omit<SyncState, "set">>) => void;
  pushConflict: (recipeId: string) => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  status: "idle",
  lastSyncAt: null,
  pendingCount: 0,
  conflicts: [],
  error: null,
  set: (patch) => set(patch),
  pushConflict: (recipeId) =>
    set((s) => ({
      conflicts: [...s.conflicts, { recipeId, at: new Date().toISOString() }],
    })),
}));
