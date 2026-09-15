// SQLite client — opens the database, applies schema migrations. All app
// access goes through the repositories; nothing else should touch `db`.
import * as SQLite from "expo-sqlite";
import { SCHEMA_DDL, SCHEMA_VERSION } from "./schema";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync("cookbook.db");
      await db.execAsync("PRAGMA journal_mode = WAL;");
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.runAsync(
    "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)",
  );
  const row = await db.getFirstAsync<{ version: number }>(
    "SELECT version FROM schema_version",
  );
  const current = row?.version ?? 0;

  if (current < 1) {
    await db.execAsync(SCHEMA_DDL);
  }
  // Future migrations: if (current < 2) { … } — each step is idempotent-guarded
  // by the version row so a partially-migrated DB resumes cleanly.

  if (current !== SCHEMA_VERSION) {
    await db.runAsync("DELETE FROM schema_version");
    await db.runAsync("INSERT INTO schema_version (version) VALUES (?)", SCHEMA_VERSION);
  }
}
