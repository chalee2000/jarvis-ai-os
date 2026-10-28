import type { Db } from "./pool.js";
import { migrations as defaultMigrations, type Migration } from "./migrations.js";

// Arbitrary constant key so that concurrent deploys never run migrations twice.
const MIGRATION_LOCK_KEY = 4_727_001;

const CREATE_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

/** Applies pending migrations, each in its own transaction. Returns applied ids. */
export async function runMigrations(
  db: Db,
  migrations: Migration[] = defaultMigrations,
): Promise<string[]> {
  const client = await db.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(CREATE_TRACKING_TABLE);
    const { rows } = await client.query<{ id: string }>("SELECT id FROM schema_migrations");
    const done = new Set(rows.map((r) => r.id));
    for (const migration of migrations) {
      if (done.has(migration.id)) continue;
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [migration.id]);
        await client.query("COMMIT");
        applied.push(migration.id);
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
    return applied;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** Lists migrations that have not been applied yet (used to refuse startup). */
export async function pendingMigrations(
  db: Db,
  migrations: Migration[] = defaultMigrations,
): Promise<string[]> {
  const { rows } = await db.query<{ exists: boolean }>(
    "SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists",
  );
  if (!rows[0]?.exists) return migrations.map((m) => m.id);
  const result = await db.query<{ id: string }>("SELECT id FROM schema_migrations");
  const done = new Set(result.rows.map((r) => r.id));
  return migrations.filter((m) => !done.has(m.id)).map((m) => m.id);
}
