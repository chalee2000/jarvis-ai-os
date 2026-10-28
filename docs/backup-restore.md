# การสำรองและกู้คืนข้อมูล (Backup / Restore) — JARVIS V1

ข้อมูลทั้งหมดของ JARVIS (ผู้ใช้, session, บทสนทนา, ข้อความ) อยู่ใน PostgreSQL ฐานเดียว
ไฟล์ backup จึงมี **ประวัติสนทนาและ password hash** — เก็บแบบเข้ารหัส จำกัดคนเข้าถึง และห้าม commit ลง Git
(`.gitignore` กัน `*.dump` และโฟลเดอร์ `backups/` ไว้แล้ว)

## 1. Backup อัตโนมัติของ Render (แผนเสียเงิน)

จากเอกสาร Render (ตรวจสอบล่าสุดผ่านผลค้นหา ณ 28 ต.ค. 2026 — ให้ตรวจหน้า docs จริงอีกครั้ง):

- ฐานข้อมูลแบบเสียเงิน (เช่น `basic-256mb`) มี **Point-in-Time Recovery (PITR)** — ย้อนกลับได้ประมาณ 3 วันใน workspace แบบ Hobby และ 7 วันใน Pro ขึ้นไป
- ฐานข้อมูล **Free ไม่มีการกู้คืน** และหมดอายุ 30 วันหลังสร้าง
- สร้าง **logical backup** แบบ on-demand ได้จากหน้า **Recovery** ของฐานข้อมูลใน Render Dashboard (ระยะเวลาเก็บไฟล์ดูจากตารางใน docs ปัจจุบัน)

อ้างอิง: <https://render.com/docs/postgresql-backups>

### กู้คืนด้วย PITR
1. Render Dashboard → `jarvis-v1-db` → **Recovery** → เลือกเวลาที่ต้องการ
2. Render จะสร้าง **ฐานข้อมูลใหม่** จากจุดเวลานั้น (ฐานเดิมไม่ถูกเขียนทับ)
3. ตรวจข้อมูลในฐานใหม่ให้ถูกต้องก่อน แล้วจึงเปลี่ยน `DATABASE_URL` ของ `jarvis-v1-web` ให้ชี้ฐานใหม่ (หรือ restore กลับด้วย `pg_restore` ตามข้อ 3)

## 2. Backup ด้วย `pg_dump` (ทำเองได้ทุกแผน)

ต้องมี PostgreSQL client รุ่นเดียวกับหรือใหม่กว่า server

```bash
pg_dump --format=custom --no-owner --no-acl --file="jarvis-$(date +%Y%m%d-%H%M).dump" "$DATABASE_URL"
```

- **บน Render**: เปิด Shell ของ `jarvis-v1-web` (มีบนแผนเสียเงิน) ซึ่งมี `DATABASE_URL` อยู่แล้ว
  แต่ไฟล์ใน Shell ไม่ถาวร — ต้องย้ายออกไปเก็บที่ปลอดภัยทันที
- **จากเครื่องตัวเอง**: render.yaml ตั้ง `ipAllowList: []` (ปิดการเชื่อมต่อจากภายนอก)
  ต้องเพิ่ม IP ของคุณชั่วคราวในหน้า **Networking/Access Control** ของฐานข้อมูล แล้วใช้ **External Database URL**
  จากนั้น **ลบ IP ออก** เมื่อเสร็จ อย่าวาง URL ที่มีรหัสผ่านใน chat, issue หรือไฟล์ที่ commit

## 3. Restore ด้วย `pg_restore`

แนะนำให้กู้คืนลง **ฐานข้อมูลใหม่ที่ว่างเปล่า** ก่อนเสมอ แล้วค่อยสลับ `DATABASE_URL`

```bash
pg_restore --no-owner --no-acl --exit-on-error --dbname="$TARGET_DATABASE_URL" jarvis-YYYYMMDD-HHMM.dump
```

ถ้าจำเป็นต้องเขียนทับฐานเดิม (ข้อมูลหลัง backup จะหายทั้งหมด):

```bash
pg_restore --clean --if-exists --no-owner --no-acl --exit-on-error --dbname="$TARGET_DATABASE_URL" jarvis-YYYYMMDD-HHMM.dump
```

หลัง restore:
1. รัน `npm run migrate` (ถ้า backup มาจากเวอร์ชันเก่า migration ใหม่จะถูกเพิ่มให้)
2. เปิด `/healthz` ต้องได้ `{"status":"ok"}`
3. ทุก session เดิมยังใช้ได้จนหมดอายุ (24 ชม.) — ถ้าต้องการบังคับให้ล็อกอินใหม่: `DELETE FROM sessions;`

## 4. ทดสอบที่ทำแล้วในเครื่อง

คำสั่ง `pg_dump --format=custom` → `pg_restore` ลงฐานใหม่ ถูกทดสอบกับ PostgreSQL 16 ในเครื่องแล้ว:
จำนวน users / conversations / messages และตาราง `schema_migrations` ตรงกันทุกค่า
(ยังไม่ได้ทดสอบกับ Render จริง เพราะยังไม่ได้สร้างทรัพยากรบน Render)
