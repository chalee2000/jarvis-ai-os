import { ConfigError, loadDatabaseUrl } from "../config.js";
import { hashPassword, validateNewPassword } from "../auth/password.js";
import { destroyUserSessions } from "../auth/sessions.js";
import { pendingMigrations } from "../db/migrate.js";
import { createPool } from "../db/pool.js";
import { parseArgs, promptHidden } from "./prompt.js";

const USAGE = `วิธีใช้:
  npm run create-admin -- --username <ชื่อผู้ใช้>
  npm run create-admin -- --username <ชื่อผู้ใช้> --reset-password

ชื่อผู้ใช้: a-z 0-9 _ . - ยาว 3-32 ตัว (ตัวพิมพ์เล็ก)
รหัสผ่านจะถูกถามแบบซ่อนใน terminal เท่านั้น (ห้ามใส่ใน argument)`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("password")) {
    throw new Error("ห้ามส่งรหัสผ่านทาง argument — ระบบจะถามรหัสผ่านแบบซ่อนให้เอง");
  }
  const rawUsername = args.get("username");
  if (typeof rawUsername !== "string") {
    console.log(USAGE);
    process.exit(1);
  }
  const username = rawUsername.trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,32}$/.test(username)) throw new Error("ชื่อผู้ใช้ไม่ถูกต้อง\n" + USAGE);
  const resetPassword = args.has("reset-password");

  const db = createPool(loadDatabaseUrl());
  try {
    if ((await pendingMigrations(db)).length > 0) {
      throw new Error('ฐานข้อมูลยังไม่ได้ migrate — รัน "npm run migrate" ก่อน');
    }
    const { rows } = await db.query<{ id: string; username: string }>(
      "SELECT id, username FROM users ORDER BY created_at",
    );
    const existing = rows.find((r) => r.username === username);

    if (resetPassword) {
      if (!existing) throw new Error(`ไม่พบผู้ใช้ "${username}"`);
    } else if (existing) {
      throw new Error(`มีผู้ใช้ "${username}" อยู่แล้ว — ใช้ --reset-password หากต้องการเปลี่ยนรหัสผ่าน`);
    } else if (rows.length > 0) {
      // Single-user app: there is no signup and only one administrator account.
      throw new Error("มีบัญชีผู้ดูแลอยู่แล้ว แอปนี้รองรับผู้ใช้เพียงคนเดียว");
    }

    const password = await promptHidden("รหัสผ่านใหม่: ");
    const problem = validateNewPassword(password);
    if (problem) throw new Error(problem);
    const confirm = await promptHidden("ยืนยันรหัสผ่านอีกครั้ง: ");
    if (confirm !== password) throw new Error("รหัสผ่านทั้งสองครั้งไม่ตรงกัน");

    const hash = await hashPassword(password);
    if (existing) {
      await db.query("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [
        hash,
        existing.id,
      ]);
      const revoked = await destroyUserSessions(db, existing.id);
      console.log(`เปลี่ยนรหัสผ่านของ "${username}" แล้ว และเพิกถอน session เดิม ${revoked} รายการ`);
    } else {
      await db.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [username, hash]);
      console.log(`สร้างผู้ดูแล "${username}" เรียบร้อยแล้ว`);
    }
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err instanceof Error ? err.message : String(err));
  process.exit(1);
});
