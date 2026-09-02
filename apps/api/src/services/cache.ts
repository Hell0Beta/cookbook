// In-process TTL cache — development.md §0: no Redis; a Map with max-size
// eviction is the whole caching layer on a ≤5-user homeserver.
export function ttlCache<T>(ttlMs: number, maxEntries = 200) {
  const store = new Map<string, { value: T; expiresAt: number }>();

  return {
    get(key: string): T | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt < Date.now()) {
        store.delete(key);
        return undefined;
      }
      // refresh recency so Map insertion order approximates LRU
      store.delete(key);
      store.set(key, hit);
      return hit.value;
    },
    set(key: string, value: T): void {
      if (store.size >= maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
  };
}
