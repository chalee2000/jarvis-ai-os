import { randomUUID } from "node:crypto";
import { ConfigError, loadDatabaseUrl } from "../config.js";
import { pendingMigrations } from "../db/migrate.js";
import { createPool } from "../db/pool.js";
import { parseArgs } from "./prompt.js";

// Fictional sample data only — no real people, places of work or contact details.
const SAMPLES: { title: string; turns: [string, string][] }[] = [
  {
    title: "ตัวอย่าง: วางแผนสัปดาห์งาน",
    turns: [
      [
        "ช่วยจัดลำดับงานสัปดาห์นี้ให้หน่อย มีรายงานประจำเดือน ประชุมทีมวันพุธ และเตรียมสไลด์โครงการดาวเหนือ",
        [
          "**ข้อเท็จจริง** (จากที่คุณให้มา)",
          "- งานมี 3 อย่าง: รายงานประจำเดือน, ประชุมทีมวันพุธ, สไลด์โครงการดาวเหนือ",
          "",
          "**ข้อสันนิษฐาน**",
          "- สมมติว่ารายงานต้องส่งภายในศุกร์นี้ และสไลด์ใช้ในประชุมวันพุธ",
          "",
          "**ลำดับที่แนะนำ**",
          "1. จันทร์–อังคาร: ทำสไลด์โครงการดาวเหนือให้เสร็จก่อนประชุม",
          "2. พุธ: ประชุมทีม แล้วจดประเด็นที่ต้องใส่ในรายงาน",
          "3. พฤหัส–ศุกร์: เขียนรายงานประจำเดือนและตรวจทาน",
        ].join("\n"),
      ],
    ],
  },
  {
    title: "ตัวอย่าง: ร่างข้อความนัดประชุม",
    turns: [
      [
        "ร่างข้อความสั้น ๆ นัดทีมสมมติ \"ทีมฟ้าคราม\" ประชุมวันศุกร์ 10 โมง",
        [
          "ร่างข้อความ (คุณต้องส่งเองนะครับ JARVIS ส่งข้อความแทนไม่ได้):",
          "",
          "> สวัสดีทีมฟ้าครามทุกคน",
          "> ขอนัดประชุมวันศุกร์นี้ เวลา 10:00 น. ประมาณ 30 นาที",
          "> วาระ: อัปเดตความคืบหน้าและแผนสัปดาห์หน้า",
          "> ขอบคุณครับ",
        ].join("\n"),
      ],
    ],
  },
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (process.env.NODE_ENV === "production" && !args.has("allow-production")) {
    throw new Error(
      "ไม่ seed ข้อมูลตัวอย่างใน production โดยอัตโนมัติ — ถ้าต้องการจริงให้เพิ่ม --allow-production",
    );
  }
  const db = createPool(loadDatabaseUrl());
  try {
    if ((await pendingMigrations(db)).length > 0) {
      throw new Error('ฐานข้อมูลยังไม่ได้ migrate — รัน "npm run migrate" ก่อน');
    }
    const requested = args.get("username");
    const { rows: users } = await db.query<{ id: string; username: string }>(
      typeof requested === "string"
        ? "SELECT id, username FROM users WHERE username = $1"
        : "SELECT id, username FROM users ORDER BY created_at LIMIT 1",
      typeof requested === "string" ? [requested.toLowerCase()] : [],
    );
    const user = users[0];
    if (!user) throw new Error('ไม่พบผู้ใช้ — สร้างผู้ดูแลด้วย "npm run create-admin" ก่อน');

    let created = 0;
    for (const sample of SAMPLES) {
      const exists = await db.query(
        "SELECT 1 FROM conversations WHERE user_id = $1 AND title = $2",
        [user.id, sample.title],
      );
      if (exists.rowCount) continue;
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        const conv = await client.query<{ id: string }>(
          "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id",
          [user.id, sample.title],
        );
        const conversationId = conv.rows[0]!.id;
        for (const [question, answer] of sample.turns) {
          const q = await client.query<{ id: string }>(
            `INSERT INTO messages (conversation_id, role, content, client_message_id, source)
             VALUES ($1, 'user', $2, $3, 'seed') RETURNING id`,
            [conversationId, question, randomUUID()],
          );
          await client.query(
            `INSERT INTO messages (conversation_id, role, content, reply_to, source, model)
             VALUES ($1, 'assistant', $2, $3, 'seed', 'seed-data')`,
            [conversationId, answer, q.rows[0]!.id],
          );
        }
        await client.query("COMMIT");
        created++;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    console.log(`seed ข้อมูลตัวอย่างให้ "${user.username}" แล้ว ${created} บทสนทนา`);
  } finally {
    await db.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof ConfigError ? err.message : err instanceof Error ? err.message : String(err));
  process.exit(1);
});
