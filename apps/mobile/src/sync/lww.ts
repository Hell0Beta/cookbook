// Last-write-wins conflict resolution — App Plan.txt's chosen strategy.
// Pure functions, no Expo imports, unit-tested in tests/lww.test.ts.
//
// The decision inputs (all ISO strings, compared lexically — ISO-8601 sorts
// chronologically for the same timezone designator Z):
// - serverUpdatedAt: the server's current updated_at for the recipe, known
//   from the pull that just ran.
// - baseUpdatedAt:   the server updated_at the local edit was based on (when
//   the user last had the server's version).
// - localEditedAt:   when the user made the local edit (device clock).
//
// Known limitation (accepted, simple-by-design): localEditedAt is a device
// clock, so skewed phones can misjudge near-simultaneous edits. The window is
// seconds; the cost is one overwritten edit, surfaced to the user.

export interface LwwInput {
  serverUpdatedAt: string;
  baseUpdatedAt: string | null;
  localEditedAt: string;
}

export type LwwDecision = { winner: "local" | "server"; conflict: boolean };

/**
 * Should the local edit be pushed (local wins) or dropped (server wins)?
 *
 * No conflict when the server hasn't changed since our base — push freely.
 * Conflict when it has: whoever wrote LAST wins by timestamp.
 */
export function resolveLww({ serverUpdatedAt, baseUpdatedAt, localEditedAt }: LwwInput): LwwDecision {
  const serverChangedSinceBase = baseUpdatedAt === null || serverUpdatedAt > baseUpdatedAt;
  if (!serverChangedSinceBase) {
    return { winner: "local", conflict: false };
  }
  // Server changed under us. Last write wins by wall-clock time.
  return serverUpdatedAt > localEditedAt
    ? { winner: "server", conflict: true }
    : { winner: "local", conflict: true };
}

/** Max updated_at across pull items — the next incremental cursor. Never moves backwards. */
export function advanceCursor(previous: string | null, seen: readonly string[]): string | null {
  let max = previous;
  for (const t of seen) {
    if (max === null || t > max) max = t;
  }
  return max;
}

/**
 * Tombstone pruning horizon on the server is 90 days: a phone whose cursor is
 * older than that must do a full pull or it would miss pruned tombstones
 * (deleted recipes would linger on the device forever).
 */
export function cursorTooOldForTombstones(cursor: string | null, now = Date.now()): boolean {
  if (cursor === null) return true;
  const ageMs = now - Date.parse(cursor);
  if (Number.isNaN(ageMs)) return true;
  return ageMs > 90 * 86_400_000;
}
