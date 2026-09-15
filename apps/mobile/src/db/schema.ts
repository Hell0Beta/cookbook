// Local SQLite schema — mirrors the server data model (development.md §3)
// with mobile-sync columns. Stubs and content are SEPARATE tables so the
// eviction system (App Plan.txt) can delete a recipe's content + images from
// the phone while keeping the list entry (stub) — reopening re-fetches.
//
// Column notes:
// - updated_at: SERVER timestamp (from pull), never the device clock — it is
//   the incremental-pull cursor and the last-write-wins baseline.
// - dirty: local edits pending push (mutation_queue holds the payload).
// - content_state: 'full' (content cached) | 'stub' (list entry only).
// - last_opened_at: usage signal for the eviction system (M10).

export const SCHEMA_VERSION = 1;

export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS recipe_stubs (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  hero_image_url     TEXT,
  base_servings      INTEGER NOT NULL DEFAULT 2,
  total_time_minutes INTEGER,
  source_type        TEXT NOT NULL DEFAULT 'manual',
  user_id            TEXT,
  updated_at         TEXT NOT NULL,
  content_state      TEXT NOT NULL DEFAULT 'stub',
  last_opened_at     INTEGER,
  dirty              INTEGER NOT NULL DEFAULT 0,
  favorite           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stubs_updated  ON recipe_stubs(updated_at);
CREATE INDEX IF NOT EXISTS idx_stubs_favorite ON recipe_stubs(favorite);

CREATE TABLE IF NOT EXISTS recipe_content (
  recipe_id  TEXT PRIMARY KEY,
  blocks_json TEXT NOT NULL,
  -- SERVER updated_at the content was fetched at (not device clock): content
  -- is stale when the stub's updated_at is newer. Skew-free comparison.
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mutation_queue (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  entity         TEXT NOT NULL,          -- 'recipe' | 'favorite'
  op             TEXT NOT NULL,          -- 'create' | 'update' | 'delete' | 'favorite' | 'unfavorite'
  recipe_id      TEXT,                   -- server id, or temp id for creates
  payload_json   TEXT,                   -- RecipeBlocks for create/update
  base_updated_at TEXT,                  -- server updated_at the edit was based on (LWW)
  created_at     TEXT NOT NULL,          -- device time of the local edit (LWW)
  attempts       INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);

CREATE TABLE IF NOT EXISTS sync_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
