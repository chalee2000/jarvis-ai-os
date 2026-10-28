# JARVIS V1 — Personal AI Command Center

แอปแชต AI ส่วนตัวสำหรับผู้ใช้คนเดียว: React + Vite (frontend), Node.js + Express (backend), PostgreSQL
backend เสิร์ฟ frontend ที่ build แล้ว จึงเป็นเว็บ origin เดียว และ deploy เป็น Render Web Service เดียว

## ความสามารถของ V1

- หน้าล็อกอิน (ไม่มีการสมัครสมาชิก ไม่มีรหัสผ่านเริ่มต้น — สร้างผู้ดูแลผ่าน terminal เท่านั้น)
- หน้าแชต, รายการบทสนทนา, สร้างบทสนทนาใหม่, ลบบทสนทนา (มี dialog ยืนยัน), ออกจากระบบ
- สถานะ "JARVIS กำลังตอบ…", แถบข้อผิดพลาด และปุ่ม **ลองใหม่** ที่ไม่บันทึกข้อความซ้ำ
- ป้าย **โหมดจำลอง** หรือ **Claude API** แสดงชัดเจนทั้งหน้าล็อกอินและหน้าแชต
- ประวัติเก็บใน PostgreSQL จริง อยู่ต่อหลัง restart/redeploy
- Mobile-first ใช้งานได้ตั้งแต่ความกว้าง 360px โทนกรมท่า/ฟ้า ฟอนต์ Noto Sans Thai (self-hosted)

**ยังไม่ทำใน V1:** เสียง, อัปโหลดไฟล์, sub-agents, การเชื่อมระบบภายนอก

## เทคโนโลยีและโครงสร้าง

| ส่วน | รายละเอียด |
| --- | --- |
| Runtime | Node.js **24 LTS** (`.node-version`, `engines` ใน package.json) |
| Frontend | React 19 + Vite, react-markdown (ไม่ render HTML ดิบ) |
| Backend | Express 5, TypeScript, `pg`, zod, helmet, express-rate-limit, argon2 |
| AI | `@anthropic-ai/sdk` ฝั่ง server เท่านั้น, model จาก `ANTHROPIC_MODEL` |
| ฐานข้อมูล | PostgreSQL 14 ขึ้นไป (ทดสอบกับ 16) |

```
server/src/
  index.ts            จุดเริ่ม server (bind 0.0.0.0:$PORT, ปฏิเสธการเริ่มถ้า config ไม่ครบ/ยังไม่ migrate)
  app.ts              ประกอบ Express app (security headers, CSRF, routes, เสิร์ฟ dist/client)
  config.ts           ตรวจ environment variables
  auth/               argon2id, session ฝั่ง server, CSRF
  chat/               system prompt, งบ token, mock provider, Claude provider, ChatService
  db/                 pool, migrations, ตัวรัน migration
  cli/                migrate, create-admin, seed
web/src/              React app
test/                 integration tests (supertest + PostgreSQL จริง)
scripts/check-secrets.mjs   สแกน secrets ในไฟล์ Git และ frontend bundle
render.yaml           Render Blueprint (ทรัพยากรใหม่ jarvis-v1-*)
docs/backup-restore.md
```

## รันในเครื่อง (local)

### 1) ติดตั้ง Node.js 24 และ dependencies

```bash
node -v
```

ต้องได้ `v24.x` (ใช้ nvm/fnm/volta ตาม `.node-version` ได้) จากนั้น

```bash
npm ci
```

> npm 11 อาจเตือนเรื่อง install scripts ของ `argon2`/`esbuild` — ไม่เป็นปัญหา เพราะ `argon2` มี prebuilt binary ในแพ็กเกจ

### 2) PostgreSQL ในเครื่อง

**แบบ Docker** (แทน `<รหัสผ่าน>` ด้วยรหัสผ่านสำหรับเครื่องตัวเอง):

```bash
docker run --name jarvis-pg -e POSTGRES_USER=jarvis -e POSTGRES_PASSWORD=<รหัสผ่าน> -e POSTGRES_DB=jarvis_dev -p 5432:5432 -d postgres:17
```

```bash
docker exec -it jarvis-pg createdb -U jarvis jarvis_test
```

**แบบติดตั้งบน Ubuntu/Debian:**

```bash
sudo apt install postgresql
```

```bash
sudo -u postgres createuser --pwprompt --createdb jarvis
```

```bash
sudo -u postgres createdb -O jarvis jarvis_dev
```

```bash
sudo -u postgres createdb -O jarvis jarvis_test
```

### 3) ตั้งค่า `.env`

```bash
cp .env.example .env
```

แก้ `DATABASE_URL`, `TEST_DATABASE_URL` ให้ตรงกับรหัสผ่านฐานข้อมูล และสุ่ม `SESSION_SECRET`:

```bash
openssl rand -hex 32
```

`.env` ถูก `.gitignore` ไว้แล้ว ห้าม commit

### 4) Migration

```bash
npm run migrate:dev
```

รันซ้ำได้อย่างปลอดภัย (ใช้ advisory lock + ตาราง `schema_migrations` และแต่ละ migration อยู่ใน transaction)

### 5) สร้างผู้ดูแล (ผู้ใช้คนเดียวของระบบ)

```bash
npm run create-admin:dev -- --username commander
```

ระบบจะถามรหัสผ่าน (≥ 12 ตัวอักษร) **แบบซ่อน** 2 ครั้ง — รหัสผ่านไม่อยู่ใน argument, log หรือ Git
และคำสั่งจะปฏิเสธถ้าไม่ได้รันใน terminal แบบโต้ตอบ (TTY) หรือถ้ามีผู้ดูแลอยู่แล้ว
เปลี่ยนรหัสผ่าน (และเพิกถอน session เดิมทั้งหมด):

```bash
npm run create-admin:dev -- --username commander --reset-password
```

### 6) (ไม่บังคับ) ข้อมูลตัวอย่างภาษาไทยที่แต่งขึ้น

```bash
npm run seed:dev
```

เป็นคำสั่งแยก ไม่รันอัตโนมัติ และจะปฏิเสธเมื่อ `NODE_ENV=production` (เว้นแต่ใส่ `--allow-production` เอง)

### 7) เปิดใช้งาน

โหมดพัฒนา (2 terminal):

```bash
npm run dev
```

```bash
npm run dev:web
```

แล้วเปิด <http://localhost:5173> (Vite proxy `/api` ไปที่ server พอร์ต 3000)

หรือแบบเดียวกับ production (origin เดียว):

```bash
npm run build
```

```bash
node --env-file=.env dist/server/index.js
```

แล้วเปิด <http://localhost:3000>

### ทดสอบโหมดจำลอง (mock)

ตั้ง `MOCK_MODE=true` (ค่าเริ่มต้นใน `.env.example`) ล็อกอิน → ส่งข้อความ → จะได้ "คำตอบจำลอง" ภาษาไทย
พร้อมป้าย **โหมดจำลอง** ข้อความถูกบันทึกลง PostgreSQL จริง (รีสตาร์ต server แล้วประวัติยังอยู่) และยังต้องล็อกอินเสมอ

### เปิดใช้ Claude API

```
MOCK_MODE=false
ANTHROPIC_API_KEY=<คีย์จาก Claude Console>
ANTHROPIC_MODEL=claude-opus-5-5
```

- model ID ตรวจกับเอกสารทางการ <https://platform.claude.com/docs/en/about-claude/models/overview> เมื่อ 28 ต.ค. 2026:
  `claude-opus-5-5` (ค่าเริ่มต้น, US$4/US$20 ต่อ 1M input/output tokens),
  `claude-sonnet-5-5` (US$2/US$10), `claude-haiku-5-5` (เริ่มที่ US$0.10/US$0.50) — ตรวจหน้าเดิมอีกครั้งก่อนเปลี่ยน model
- ข้อกำหนดของแต่ละคำขอ: ข้อความเข้า ≤ 4,000 ตัวอักษร, `max_tokens: 1024`, ประวัติเฉพาะบทสนทนานั้นของผู้ใช้ที่ล็อกอิน
  ตัดข้อความเก่าตามงบ `CONTEXT_TOKEN_BUDGET` (ค่าเริ่มต้น 12,000 token โดยประมาณ), timeout 45 วินาที, retry ภายใน SDK 1 ครั้ง
- model ตระกูล Claude 5 ใช้ `output_config.effort: "low"` (Opus 5.5 ปิด thinking ไม่ได้ จึงคุมด้วย effort ให้พอดี 1,024 tokens)
- สำหรับ `claude-opus-5-5`, `claude-opus-5`, `claude-sonnet-5-5`, `claude-fable-5-1` เปิด **server-side refusal fallback**
  (`fallbacks: "default"`) — ถ้า model ปฏิเสธด้วยเหตุผลด้านความปลอดภัย API อาจให้ Claude model อื่นตอบแทน
  และระบบบันทึกชื่อ model ที่ตอบจริงไว้ในข้อความ (แสดงใต้คำตอบ) ถ้าไม่ต้องการ ให้ลบส่วนนี้ใน `server/src/chat/claude-provider.ts`
- ถ้า API ล้มเหลว (429, timeout, เครือข่าย, key ผิด, 5xx/529) ผู้ใช้จะเห็นข้อความแจ้งชัดเจนพร้อมปุ่มลองใหม่
  **ไม่มีการเปลี่ยนเป็นคำตอบจำลองแบบเงียบ ๆ** และข้อความของผู้ใช้ถูกบันทึกครั้งเดียว

## ทดสอบและตรวจสอบ

ต้องมี `TEST_DATABASE_URL` (ฐานนี้ **ถูกล้างทุกครั้ง** ที่รันเทสต์ อย่าใช้ฐานจริง)

```bash
npm run typecheck
```

```bash
npm run build
```

```bash
TEST_DATABASE_URL=postgresql://jarvis:<รหัสผ่าน>@localhost:5432/jarvis_test npm test
```

```bash
npm run check:secrets
```

เทสต์ครอบคลุม: login/logout, การเปลี่ยน session ID ตอนล็อกอิน, session หมดอายุ 24 ชม., cookie flags ใน production,
CSRF (token/Origin/JSON), rate limit login, การปฏิเสธผู้ไม่ล็อกอินทุก API, การเข้าถึงบทสนทนาของผู้อื่น (อ่าน/ส่ง/ลองใหม่/ลบ → 404),
แชต mock + การบันทึกจริง + กันข้อความซ้ำ + ลองใหม่, ประวัติหลัง restart, การจัดการ error ของ Claude (429/timeout/401/400/529/refusal)
ผ่าน HTTP server จำลองในเครื่อง (ไม่เรียก API จริง), การตรวจ config production และ process ปฏิเสธการเริ่ม, Markdown XSS

## ความปลอดภัย (สรุป)

- รหัสผ่าน: Argon2id (m=19 MiB, t=2, p=1), เทียบกับ dummy hash เมื่อไม่พบผู้ใช้ (กันเดาชื่อผู้ใช้จากเวลา)
- Session ฝั่ง server ใน PostgreSQL เก็บเฉพาะ HMAC-SHA256 ของ token; cookie `HttpOnly`, `SameSite=Lax`, `Secure` + prefix `__Host-` ใน production;
  ออก session ID ใหม่เมื่อล็อกอิน, หมดอายุ 24 ชม., ลบแถวเมื่อ logout
- CSRF: ตรวจ `Origin`/`Referer` = `APP_ORIGIN`, บังคับ JSON, header `X-CSRF-Token` (ผูกกับ session / double-submit cookie ที่ลงนามก่อนล็อกอิน)
- `trust proxy` ตาม `TRUST_PROXY_HOPS` (ค่าเริ่มต้น 1 ใน production สำหรับ proxy ของ Render)
- Rate limit: login 5 ครั้งที่ล้มเหลว/15 นาที/IP, แชต 20 ข้อความ/นาที/ผู้ใช้ (in-memory — ใช้กับ instance เดียว)
- จำกัด body 24 KB, ตรวจ input ด้วย zod, security headers (CSP `default-src 'self'`, HSTS, frame-ancestors none ฯลฯ)
- ทุก query ผูกกับ `user_id` ของ session; id ของคนอื่นหรือรูปแบบผิด → 404
- ไม่แสดง stack trace ต่อผู้ใช้; log เป็น JSON มีแค่ method/path/status/เวลา — ไม่มีเนื้อหาสนทนา รหัสผ่าน หรือ secrets
- ไม่ใช้ localStorage กับ token/key; CSRF token อยู่ในหน่วยความจำของหน้าเว็บเท่านั้น

## Environment variables

| ตัวแปร | จำเป็น | คำอธิบาย |
| --- | --- | --- |
| `DATABASE_URL` | ✓ | PostgreSQL connection string |
| `SESSION_SECRET` | ✓ | ค่าสุ่ม ≥ 32 ตัวอักษร (ใช้ HMAC session/CSRF) |
| `APP_ORIGIN` | ✓ (production) | origin ของเว็บ เช่น `https://jarvis-v1-web.onrender.com` (บน Render ถ้าว่างจะใช้ `RENDER_EXTERNAL_URL`) |
| `MOCK_MODE` | ✓ (production) | `true` = แชตจำลอง, `false` = Claude API |
| `ANTHROPIC_API_KEY` | เมื่อ `MOCK_MODE=false` | API key (เก็บใน Render Dashboard เท่านั้น) |
| `ANTHROPIC_MODEL` | เมื่อ `MOCK_MODE=false` | เช่น `claude-opus-5-5` |
| `NODE_ENV` | | `development` / `test` / `production` |
| `PORT`, `HOST` | | ค่าเริ่มต้น `3000`, `0.0.0.0` (Render กำหนด `PORT` ให้) |
| `CONTEXT_TOKEN_BUDGET` | | งบ token ของประวัติ (1,000–200,000, ค่าเริ่มต้น 12,000) |
| `TRUST_PROXY_HOPS` | | จำนวน proxy ที่เชื่อถือ (ค่าเริ่มต้น 1 ใน production) |

เมื่อ `NODE_ENV=production` และตัวแปรสำคัญขาดหรือผิดรูปแบบ server จะพิมพ์ชื่อตัวแปรที่มีปัญหา (ไม่พิมพ์ค่า) แล้วจบด้วย exit code 1
และจะไม่เริ่มถ้ายังมี migration ค้าง

## GitHub: branch และ Pull Request

งานนี้อยู่บน branch `codex/jarvis-v1` (ไม่ force push) ขั้นตอนทั่วไป:

```bash
git checkout codex/jarvis-v1
```

```bash
npm run typecheck && npm run build && npm test && npm run check:secrets
```

```bash
git push -u origin codex/jarvis-v1
```

จากนั้นเปิด Pull Request จาก `codex/jarvis-v1` เข้า `main` บน GitHub (เริ่มเป็น Draft แล้ว review ก่อน merge)

## Deploy บน Render ด้วย Blueprint ใหม่

`render.yaml` สร้างทรัพยากร **ใหม่** เท่านั้น: Web Service `jarvis-v1-web` และ PostgreSQL `jarvis-v1-db`
(ไม่อ้างอิง service, database, environment group หรือ domain เดิม) ไฟล์นี้ **ยังไม่ได้ถูก deploy**

1. merge PR เข้า `main` (หรือเลือก branch `codex/jarvis-v1` ตอนสร้าง Blueprint)
2. Render Dashboard → **New** → **Blueprint** → เชื่อม GitHub repo `jarvis-ai-os` → เลือก branch
3. ตรวจรายการทรัพยากรที่จะสร้างว่ามีแค่ `jarvis-v1-web` และ `jarvis-v1-db` และดูราคาที่หน้าจอแสดง
4. กรอกค่าที่ถูกถาม:
   - `APP_ORIGIN`: URL ของ service เช่น `https://jarvis-v1-web.onrender.com` (เว้นว่างได้ — จะใช้ `RENDER_EXTERNAL_URL`)
   - `ANTHROPIC_API_KEY`: เว้นว่างได้ถ้ายังใช้โหมดจำลอง
5. กด **Apply** — Render จะ build (`npm ci --include=dev && npm run build`), รัน `npm run migrate` (pre-deploy),
   start (`npm start`) และตรวจ health ที่ `/healthz`
6. สร้างผู้ดูแล: เปิด **Shell** ของ `jarvis-v1-web` แล้วรัน

```bash
npm run create-admin -- --username commander
```

7. เปิดใช้ Claude API: ใน Environment ของ `jarvis-v1-web` ตั้ง `ANTHROPIC_API_KEY` และเปลี่ยน `MOCK_MODE` เป็น `false` แล้ว save (Render จะ redeploy)
8. ถ้าใช้ custom domain ให้ตั้ง `APP_ORIGIN` เป็น domain นั้น (ต้องเป็น `https://`)

> ใช้ instance เดียว (rate limit และ lock กันตอบซ้ำเป็นแบบ in-memory) — ถ้าจะ scale หลาย instance ต้องย้ายไปใช้ shared store ก่อน

## ค่าใช้จ่ายและข้อจำกัดของ Render

ข้อมูลจากหน้า pricing/docs ของ Render ผ่านผลค้นหา ณ **28 ต.ค. 2026** (session นี้เข้า render.com โดยตรงไม่ได้)
**ราคาเปลี่ยนได้ — ตรวจ <https://render.com/pricing> ก่อนสร้างเสมอ และไม่มีส่วนใดเป็น "ฟรีถาวร"**

| ทรัพยากร | แผนใน render.yaml | ค่าใช้จ่ายโดยประมาณ | หมายเหตุ |
| --- | --- | --- | --- |
| Web Service `jarvis-v1-web` | `starter` | ~US$7/เดือน (512 MB, 0.5 CPU) | ไม่ spin down, ใช้ pre-deploy command และ Shell ได้ |
| PostgreSQL `jarvis-v1-db` | `basic-256mb` | ~US$6/เดือน + storage | มี Point-in-Time Recovery (Hobby ~3 วัน, Pro ~7 วัน) |
| Claude API | — | ตามจำนวน token ที่ใช้จริง | ไม่มีค่าใช้จ่ายเมื่อ `MOCK_MODE=true` |

ข้อจำกัดของแผนฟรี (ถ้าเปลี่ยนไปใช้): web service ฟรี spin down หลังว่าง 15 นาที (โหลดครั้งแรกช้า) และใช้ชั่วโมงร่วมกันจำกัดต่อเดือน,
**ไม่มี pre-deploy command** (ต้องย้าย `npm run migrate` ไปไว้หน้า `npm start`), PostgreSQL ฟรี **หมดอายุ 30 วัน** และไม่มีการกู้คืนข้อมูล
อาจมีค่า workspace plan เพิ่มเติมตามบัญชีของคุณ

## Backup / Restore

ดู [docs/backup-restore.md](docs/backup-restore.md) — สรุป: PITR อัตโนมัติบนฐานข้อมูลแบบเสียเงิน, `pg_dump --format=custom` สำหรับ backup เอง
และ `pg_restore` ลงฐานใหม่ก่อนสลับ `DATABASE_URL`

## แก้ปัญหาเบื้องต้น

| อาการ | สาเหตุ/วิธีแก้ |
| --- | --- |
| server ไม่เริ่ม พร้อมรายชื่อตัวแปร | ตั้ง environment variables ตามตารางด้านบน |
| `ฐานข้อมูลยังไม่ได้ migrate` | รัน `npm run migrate` (หรือ `migrate:dev` ในเครื่อง) |
| ล็อกอินแล้วได้ 403 | `APP_ORIGIN` ไม่ตรงกับ URL ที่เปิดในเบราว์เซอร์ |
| `Claude API ปฏิเสธการยืนยันตัวตน` | ตรวจ `ANTHROPIC_API_KEY` |
| `Claude API ไม่รับคำขอนี้` | ตรวจ `ANTHROPIC_MODEL` ว่าเป็น model ID ที่มีอยู่จริง |
