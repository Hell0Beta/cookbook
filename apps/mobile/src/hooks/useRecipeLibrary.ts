// Library query — TanStack Query over the local repository (local-first: no
// network involved; the sync engine refreshes the DB and we invalidate).
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { recipesRepo, type RecipeStub } from "../db/repositories/recipes";
import { sync } from "../sync/engine";
import { useSyncStore } from "../stores/sync";

export function useRecipeLibrary() {
  const status = useSyncStore((s) => s.status);
  const lastSyncAt = useSyncStore((s) => s.lastSyncAt);
  const pendingCount = useSyncStore((s) => s.pendingCount);

  const query = useQuery({
    queryKey: ["recipe-stubs", lastSyncAt, status, pendingCount],
    queryFn: () => recipesRepo.list(),
  });

  return {
    recipes: query.data ?? [],
    isLoading: query.isLoading,
  };
}

/** Manual sync (sync button / pull-to-refresh) — invalidates library queries. */
export function useSyncNow() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await sync();
    await queryClient.invalidateQueries({ queryKey: ["recipe-stubs"] });
  }, [queryClient]);
}
