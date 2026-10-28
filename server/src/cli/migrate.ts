import { ConfigError, loadDatabaseUrl } from "../config.js";
import { runMigrations } from "../db/migrate.js";
import { createPool } from "../db/pool.js";

/** Safe to run on every deploy: idempotent, forward-only, serialized by an advisory lock. */
async function main(): Promise<void> {
  const db = createPool(loadDatabaseUrl());
  try {
    const applied = await runMigrations(db);
    console.log(
      applied.length > 0
        ? `ใช้ migration แล้ว: ${applied.join(", ")}`
        : "ฐานข้อมูลเป็นเวอร์ชันล่าสุดแล้ว ไม่มี migration ใหม่",
    );
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : `migration ล้มเหลว: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
