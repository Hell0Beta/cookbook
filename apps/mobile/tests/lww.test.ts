// LWW + cursor logic tests (pure functions — no Expo imports).
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveLww, advanceCursor, cursorTooOldForTombstones } from "../src/sync/lww";

test("resolveLww: no server change since base → local pushes freely", () => {
  const r = resolveLww({
    serverUpdatedAt: "2026-09-15T10:00:00Z",
    baseUpdatedAt: "2026-09-15T10:00:00Z",
    localEditedAt: "2026-09-15T11:00:00Z",
  });
  assert.deepEqual(r, { winner: "local", conflict: false });
});

test("resolveLww: server changed after the local edit → server wins", () => {
  const r = resolveLww({
    serverUpdatedAt: "2026-09-15T12:00:00Z",
    baseUpdatedAt: "2026-09-15T10:00:00Z",
    localEditedAt: "2026-09-15T11:00:00Z",
  });
  assert.deepEqual(r, { winner: "server", conflict: true });
});

test("resolveLww: local edit came after the server change → local wins", () => {
  const r = resolveLww({
    serverUpdatedAt: "2026-09-15T10:30:00Z",
    baseUpdatedAt: "2026-09-15T10:00:00Z",
    localEditedAt: "2026-09-15T11:00:00Z",
  });
  assert.deepEqual(r, { winner: "local", conflict: true });
});

test("resolveLww: null base (never synced / local create) → local pushes", () => {
  const r = resolveLww({
    serverUpdatedAt: "2026-09-15T12:00:00Z",
    baseUpdatedAt: null,
    localEditedAt: "2026-09-15T13:00:00Z",
  });
  // Server version existed and is older than our edit → local wins.
  assert.deepEqual(r, { winner: "local", conflict: true });
});

test("advanceCursor: takes the max and never regresses", () => {
  assert.equal(
    advanceCursor("2026-09-15T10:00:00Z", ["2026-09-15T09:00:00Z", "2026-09-15T09:30:00Z"]),
    "2026-09-15T10:00:00Z",
  );
  assert.equal(
    advanceCursor("2026-09-15T10:00:00Z", ["2026-09-15T11:00:00Z"]),
    "2026-09-15T11:00:00Z",
  );
  assert.equal(advanceCursor(null, []), null);
  assert.equal(advanceCursor(null, ["2026-09-15T11:00:00Z"]), "2026-09-15T11:00:00Z");
});

test("cursorTooOldForTombstones: 90-day horizon", () => {
  const now = Date.parse("2026-09-15T00:00:00Z");
  assert.equal(cursorTooOldForTombstones(null, now), true);
  assert.equal(cursorTooOldForTombstones("2026-09-14T00:00:00Z", now), false);
  assert.equal(cursorTooOldForTombstones("2026-06-01T00:00:00Z", now), true);
  assert.equal(cursorTooOldForTombstones("not-a-date", now), true);
});
