# คู่มือสำหรับสมาชิกใหม่ — TOR Radar

_สำหรับคนที่เพิ่งเข้าทีม: อ่านจบแล้วรันระบบได้ เข้าใจว่าแต่ละส่วนทำอะไร และรู้ว่าทีมทำงานกันยังไง_

เอกสารนี้เป็น **ทางเข้า** ไม่ใช่แหล่งความจริง — รายละเอียดทุกเรื่องอยู่ในเอกสารที่ลิงก์ไว้
ถ้าเจอว่าข้อความในนี้ขัดกับ [SRS.md](SRS.md) หรือ [ARCHITECTURE.md](ARCHITECTURE.md) ให้เชื่อเอกสารนั้น
แล้วแก้ไฟล์นี้

---

## 1. โปรเจกต์นี้คืออะไร (อ่าน 1 นาที)

หน่วยงานรัฐประกาศ TOR (ร่างขอบเขตงาน) เป็น PDF กระจายอยู่หลายเว็บ ผู้ขายรายเล็กตามไม่ทัน
ประชาชนก็เปรียบเทียบไม่ได้ TOR Radar จึง:

1. **ดึง** TOR ที่ประกาศแล้วจาก e-GP
2. **ให้ AI (Gemini) อ่าน** แล้วสกัดข้อมูลสำคัญ — ชื่อ หน่วยงาน งบ วันปิดรับ หมวด คุณสมบัติ
3. **จับคู่ (match)** กับโปรไฟล์ผู้ขาย แล้วแจ้งเตือนทางอีเมล
4. **เผยแพร่ dashboard** ให้ทุกคนดู พร้อมกฎ "statistical anomaly" ที่อธิบายได้

ผู้ใช้มี 3 กลุ่ม: **ผู้ขาย** (vendor) · **ประชาชน / นักข่าว** · **admin** (ทีมเรา)
**หน่วยงานรัฐไม่ใช่ผู้ใช้** — เป็นแค่แหล่งข้อมูล ไม่มีหน้าให้หน่วยงานล็อกอินหรืออัปโหลด

---

## 2. Stack

| ส่วน | ใช้อะไร |
| :-- | :-- |
| ภาษา / runtime | TypeScript · **Node.js 22 ขึ้นไป** |
| Frontend | Next.js 16 (App Router) · React 19 · Three.js (ฉากเรดาร์หน้าแรก) |
| Backend | Express 5 (REST) · Zod (validate) · argon2 (รหัสผ่าน) · nodemailer (อีเมล) |
| ฐานข้อมูล | MongoDB Atlas — เก็บข้อมูลที่สกัดแล้ว + ใช้เป็น job queue · Atlas Search (`lucene.thai`) |
| เก็บไฟล์ | Google Cloud Storage — ไฟล์ต้นฉบับ **ห้ามแก้ ห้ามลบ** · ในเครื่องใช้ `fake-gcs-server` |
| AI | Vertex AI — Gemini (สกัดข้อมูล) · Document AI (OCR ไฟล์สแกน) |
| แจ้งเตือน | อีเมลผ่าน SMTP เท่านั้น · ในเครื่องใช้ Mailpit |
| Infra | Docker Compose · Cloud Run · GitHub Actions (CI ทุก PR) |
| เทสต์ | Vitest · Supertest |
| ทำงานร่วมกัน | Scrum · Jira (project **TOR**) · GitHub PR · Discord |

ตารางเต็มพร้อมเวอร์ชันและเหตุผล: [ARCHITECTURE.md §8](ARCHITECTURE.md)

---

## 3. ติดตั้งและรันครั้งแรก

### 3.1 สิ่งที่ต้องมี

- **Node.js 22+** — ถ้าเครื่องเป็น Node 20 จะรันเทสต์ (vitest) และบางคำสั่งไม่ได้ เช็กด้วย `node -v`
- **Docker Desktop** (ถ้าจะรันแบบ container)
- สิทธิ์เข้า GitHub repo, Jira project TOR และไฟล์ secret จากทีม

### 3.2 ขอของจากทีม (ห้าม commit เด็ดขาด)

| ของ | ใส่ที่ไหน |
| :-- | :-- |
| ค่าใน `.env` (Mongo URL, รหัส staff, SMTP ฯลฯ) | `.env` ที่ root (คัดลอกจาก `.env.example` แล้วเติม) |
| `gcp-sa.json` — service account ของ Vertex AI | `secrets/` |
| `gcs-storage-sa.json` — ถ้าจะใช้ GCS จริงแทนตัวจำลอง | `secrets/` |

`secrets/` และ `.env` ถูก gitignore ไว้แล้ว

### 3.3 คำสั่ง

```bash
cp .env.example .env        # แล้วเติมค่าที่ได้จากทีม
npm install
npm run dev                 # โหมดพัฒนา: web :3000 · api :4000
```

หรือรันครบชุดใน container:

```bash
docker compose up           # web · api · worker · mongo · gcs (จำลอง) · mail (Mailpit)
```

โหมด production บนเครื่อง:

```bash
npm run build
npm run start -w apps/api   # เทอร์มินัลที่ 1
npm run start -w apps/web   # เทอร์มินัลที่ 2
```

### 3.4 Worker (ต้องเปิดแยก — `npm run dev` / `start` ไม่ได้เปิดให้)

| คำสั่ง | ทำอะไร |
| :-- | :-- |
| `npm run worker -w apps/api` | **Extraction worker** — ให้ Gemini อ่าน TOR ที่รอคิว |
| `npm run stats-worker -w apps/api` | **Stats worker** — คำนวณตัวเลข dashboard และ peer group |
| `npm run notify-worker -w apps/api` | **Notify worker** — ส่งอีเมล match (ส่งจริงเมื่อ `NOTIFY_DISPATCH_ENABLED=true`) |

ถ้าไม่เปิด extraction worker: TOR ที่ดึงมาจะค้าง `queued` · ถ้าไม่เปิด stats worker: dashboard ไม่อัปเดต

### 3.5 เข้าหน้า admin

ไปที่ `/admin` แล้วใส่รหัสจาก `STAFF_ACCESS_SECRET` ใน `.env`
ถ้าล็อกอินด้วยบัญชีผู้ใช้อยู่ บัญชีนั้นต้องเป็น `role: "admin"` ด้วย

### 3.6 ตรวจว่ารันได้จริง

- เปิด `http://localhost:3000` เห็นหน้าแรกพร้อมตัวเลข
- `http://localhost:4000/health` ตอบ `{"status":"ok"}`
- `npm test` ผ่าน · `npm run lint` ผ่าน

---

## 4. ระบบทำงานยังไง (ภาพรวม)

```
e-GP ──► import script ──► intake ──► GCS (ไฟล์ต้นฉบับ) + MongoDB (record: queued)
                                          │
                                   ingest_jobs (คิว)
                                          │
                              extraction worker ──► Gemini
                                          │
                               record: published (+ confidence ทุกฟิลด์)
                                          │
              ┌───────────────────────────┼───────────────────────────┐
         ค้นหา / หน้า TOR            stats worker → dashboard      matching → notify worker → อีเมล
```

### 4.1 ดึงข้อมูล (ingest)

แหล่งหลักคือ **e-GP ระดับประเทศ** (`process5.gprocurement.go.th`) อีกแหล่งคือ e-GP ของ กทม.
ไม่มีการดึงอัตโนมัติตามเวลา — รันสคริปต์เอง:

```bash
npx tsx tools/import_national_egp_tors.mts --limit 100                     # ร่าง TOR ล่าสุด
npx tsx tools/import_national_egp_tors.mts --from invitation --limit 100   # ประกาศเชิญชวน + TOR (ได้วันปิดรับ)
npx tsx tools/reextract.mts --project <เลขโครงการ>                          # สั่งสกัดใหม่
```

แต่ละโครงการ: ดาวน์โหลดไฟล์ ZIP ทั้งชุด → เก็บต้นฉบับ → หยิบ PDF ของ TOR (และประกาศเชิญชวน)
→ intake ตรวจชนิดไฟล์จาก magic bytes, จำกัด 25 MB, กันไฟล์ซ้ำด้วย sha256 → ใส่คิว
รายละเอียดแหล่งข้อมูล: [DATA-SOURCES.md](DATA-SOURCES.md) · คู่มือสั้น: [PULLING-TORS.md](PULLING-TORS.md)

### 4.2 สกัดข้อมูล (extract)

worker จองงานจากคิว → ดึง PDF จาก GCS ด้วย storage key → Gemini คืนค่าแต่ละฟิลด์พร้อม confidence
→ ตรวจความสมเหตุสมผล (เช่น ปีของวันที่) → จัดหมวด 13 หมวด → `published`
ไม่สำเร็จจะ retry แบบ backoff ครบจำนวนครั้งแล้วเป็น `failed` (ไฟล์ต้นฉบับยังอยู่)

**Confidence กำหนดการติดป้าย ไม่ได้กำหนดการแสดงผล:** สูง → แสดงปกติ · กลาง → ติดป้าย
"unverified extraction" และไม่นำไปคิดสถิติ/matching · ต่ำ → ติดป้าย + เข้าคิวให้ admin ตรวจ

ความแม่นยำที่วัดไว้ (gemini-3.5-flash): **95%** กับ PDF ดิจิทัล · **72%** กับไฟล์สแกน
— [corpus/BENCHMARK.md](corpus/BENCHMARK.md)

### 4.3 ฟีเจอร์หลัก

| ฟีเจอร์ | ทำงานยังไงสั้น ๆ | โค้ด |
| :-- | :-- | :-- |
| ค้นหา (F4) | Atlas Search ภาษาไทย + ตัวกรอง (หมวด หน่วยงาน งบ วันปิดรับ) | `modules/tors` · `features/search` |
| หน้า TOR (F7) | ทุกฟิลด์พร้อม confidence + ลิงก์ต้นฉบับ · เปิด PDF ในแอป · checklist | `features/tor-detail` |
| Dashboard + anomaly (F8) | เทียบงบกับ **peer group** (หมวดเดียวกัน 12 เดือน) ด้วย IQR · กลุ่มน้อยกว่า 8 ไม่ติดป้าย | `modules/stats` · `features/dashboard` |
| Checklist คุณภาพ (F11) | C1 มีงบ · C2 เวลายื่นพอ · C3 ขอบเขตชัด · C4 มีคุณสมบัติ · C5 งบปกติในกลุ่ม | `modules/checklist` |
| บัญชี + โปรไฟล์ (F5, F6) | สมัคร (argon2, ยืนยันอีเมล, ยินยอม PDPA) · หมวดงาน งบ พื้นที่ ผลงาน ใบรับรอง | `modules/accounts` · `modules/profile` |
| Matching (F9) | ให้คะแนน 0–100% จากหมวดงาน (หนักสุด) งบ ผลงาน คุณสมบัติ — **ทุกคะแนนมีประโยคเหตุผล** | `modules/matching/match-scorer.ts` |
| อีเมล (F10) | notify worker ทุก 60 วิ · ตั้งค่าได้ all / high / daily / off · ไม่ส่งซ้ำ · ต้องส่งภายใน 5 นาที | `modules/notifications` |
| Admin | คิวตรวจ · แก้ข้อมูล (มี audit) · takedown · จัดการผู้ขาย · ปุ่มส่งอีเมล match · label benchmark | `modules/admin` · `features/admin` |
| Vault / ร่างจดหมาย / company path | ไฟล์ของผู้ขาย (bucket แยก) · AI ร่างหนังสือเสนอราคา · เส้นทางบริษัท | `modules/vault` · `drafts` · `path` |
| Source health (F12) | **ยังไม่ได้ทำ** (TOR-87) | — |

---

## 5. โค้ดอยู่ตรงไหน

```
apps/web/     Next.js — app/ คือ route อย่างเดียว · โค้ด UI อยู่ใน src/
              src/views → features → entities → shared  (import ลงทางเดียว ห้ามย้อนขึ้น)
apps/api/     Express — modules/<feature>/ · ports/ (interface) · adapters/ (GCS, Mongo, Vertex, SMTP)
              workers/ (extract, stats, notify) · core/config.ts (ค่าตั้งทุกตัว)
packages/     shared/ (type + Zod ที่สองฝั่งใช้ร่วม) · seeds/ (taxonomy, หมวด, จังหวัด)
tools/        สคริปต์ดึง TOR, สกัดใหม่, benchmark, รายงานเทสต์
docs/         เอกสารทั้งหมด (ดูข้อ 7)
mockups/      ต้นแบบดีไซน์ — ไว้ดูอ้างอิง ไม่ได้ build
```

ใน 1 feature ของ API (เช่น `modules/matching/`) จะมี:
`*.routes.ts` (HTTP + validate) → `*.service.ts` (กฎทางธุรกิจ) → `*.repository.ts` (**ที่เดียวที่แตะ DB**)

**กฎโครงสร้าง 4 ข้อ:**
1. เฉพาะ `*.repository.ts` ที่ import database
2. `modules/` import `ports/` เท่านั้น ห้าม import `adapters/` — ต่อสายกันที่ `app.ts` ที่เดียว
3. threshold และค่าปรับได้ทุกตัวอยู่ใน `core/config.ts`
4. 1 feature = 1 โฟลเดอร์ ลบ feature = ลบโฟลเดอร์เดียว

---

## 6. กฎที่ห้ามพลาด

| กฎ | ทำไม |
| :-- | :-- |
| **ไฟล์ต้นฉบับห้ามแก้ห้ามลบ** (`putIfAbsent` เท่านั้น) | ทุกตัวเลขบนเว็บต้องย้อนไปดูเอกสารจริงได้ |
| **คำที่ใช้ได้มีแค่ "statistical anomaly" และ "specification-quality check"** | ห้ามใช้ "น่าสงสัย" "ทุจริต" "ผิดปกติ" กับ TOR งบ หรือหน่วยงาน |
| **ค่าที่ AI ให้ต้องมี confidence + โมเดลที่ใช้ + ลิงก์ต้นฉบับ** | อธิบายได้ ตรวจสอบได้ |
| **แสดงค่าที่สกัดตามที่สกัดมา** ไม่เรียบเรียงใหม่ ไม่แก้เงียบ ๆ | ความถูกต้อง |
| **UI เป็นภาษาไทย** | ผู้ใช้เป็นคนไทย |
| **"PDPA-aligned" ห้ามพูดว่า "PDPA-compliant"** | เราไม่ได้รับรอง |
| **ห้าม hard-code** host, port, bucket, รหัส, ชื่อโมเดล, threshold | ทุกอย่างมาจาก config · คำว่า `localhost` ห้ามอยู่ในโค้ด |
| **ห้ามแชร์ path ไฟล์ระหว่าง service** | ส่ง storage key แทน แล้วดึงไฟล์จาก GCS |
| **ค่าที่ยังไม่ได้ calibrate ห้ามเดา** | `T_low`/`T_high`, `MIN_BID_WINDOW_DAYS`, `MIN_SCOPE_*`, IQR vs Z-score (TOR-200) |
| **ห้าม commit secret** | `.env` และ `secrets/` |

---

## 7. เอกสารที่ควรอ่าน (ตามลำดับ)

1. [SRS.md](SRS.md) — ระบบต้องทำอะไร (requirement ทุกข้อ ทดสอบได้) **แหล่งความจริง**
2. [ARCHITECTURE.md](ARCHITECTURE.md) — แผนภาพ 9 รูป, โค้ดอยู่ไหน, data model, stack
3. [superpowers/specs/](superpowers/specs/) — design ของแต่ละ feature (ชื่อไฟล์ขึ้นต้นด้วยวันที่)
4. [TODO.md](TODO.md) — **ตอนนี้ถึงไหนแล้ว** อะไรเสร็จ อะไรค้าง
5. [API.md](API.md) — route ทั้งหมด · [TESTING.md](TESTING.md) — เทสต์อะไรบ้าง
6. [PROJECT.md](PROJECT.md) — ทำไมมีโปรเจกต์นี้, user stories · [PLAN.md](PLAN.md) — จะทำอะไรต่อ

ตารางเต็มว่าเอกสารไหนตอบคำถามอะไร อยู่ใน [README.md](../README.md#documentation)
`archive/` เป็นเอกสารเก่า ห้ามอ้างอิง

---

## 8. ทำงานในทีมยังไง

### 8.1 รับงาน
- ดูงานใน **Jira project TOR** (momentumm.atlassian.net) — Jira คือความจริงของ sprint
- Story ใหญ่แตกเป็น sub-task · epic ≈ กลุ่ม requirement (FR-A … FR-G)
- Standup ใน Discord

### 8.2 เขียนโค้ด
- **งานใหญ่วางแผนก่อน:** design spec ใน `docs/superpowers/specs/` → แผน → ลงมือ
- สร้าง branch จาก `main` ตั้งชื่อเช่น `feat/tor-203-days-left`, `fix/...`
- **Commit แบบ Conventional Commits** — 1 commit 1 เรื่อง: `feat(search): show days left before a TOR closes (TOR-203)`
- เปิด PR เข้า `main` — CI รัน lint, test, build, ตรวจ Mermaid และ **ตรวจว่าเอกสารอัปเดตตามโค้ด**

### 8.3 เอกสารต้องอัปเดตใน PR เดียวกัน (ส่วนหนึ่งของ "เสร็จ")

| แก้อะไร | อัปเดตไฟล์ |
| :-- | :-- |
| route / body / query / auth | [API.md](API.md) |
| collection / field / index / module / worker | [ARCHITECTURE.md](ARCHITECTURE.md) |
| พฤติกรรมที่ spec อธิบายไว้ | spec นั้น — เพิ่มหัวข้อ revision ลงวันที่ ห้ามแก้เงียบ |
| เทสต์ | [TESTING.md](TESTING.md) |
| ค่า config / env | `.env.example` + เอกสารที่อธิบาย |
| อะไรเสร็จ / เริ่ม / ค้าง | [TODO.md](TODO.md) + อัปเดตวันที่ "last updated" |

ก่อนบอกว่าเสร็จ: `node tools/check_docs_drift.mjs` และ `node tools/check_mermaid.mjs`
เอกสารแยกเป็น commit `docs:` ของตัวเอง

### 8.4 Definition of Done
รีวิวแล้ว · เทสต์ผ่าน · รันได้ใน Docker Compose · **เดโมได้จริง** — เทสต์ผ่านอย่างเดียวยังไม่นับว่าเสร็จ
ต้องลองกับระบบที่รันอยู่จริงก่อน

---

## 9. ปัญหาที่เจอบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
| :-- | :-- |
| `npm test` error แปลก ๆ | Node เก่ากว่า 22 — อัปเกรด Node |
| ดึง TOR มาแล้วค้าง `queued` | ไม่ได้เปิด extraction worker (`npm run worker -w apps/api`) |
| Dashboard ไม่เปลี่ยน | ไม่ได้เปิด stats worker |
| ดึง TOR ในเครื่องแล้วบางรายการ `failed` ด้วย "object … not found" | Atlas เป็นฐานข้อมูลร่วม worker บน Cloud Run ที่ใช้ bucket อื่นมาแย่งงานจากคิว — ไฟล์ไม่ได้หาย สั่งสกัดใหม่ได้ (ยังไม่ได้แก้ที่ต้นเหตุ) |
| ล็อกอิน admin แล้วเด้งกลับหน้าล็อกอิน (รัน `npm start` ผ่าน `http://`) | cookie ตั้ง `Secure` ในโหมด production เบราว์เซอร์จึงทิ้ง cookie บน http — ใช้ `npm run dev` หรือรันผ่าน https |
| อีเมลยืนยัน / อีเมล match ไม่มา | ดูในโฟลเดอร์ spam · notify worker เปิดหรือยัง · `NOTIFY_DISPATCH_ENABLED` |
| `apps/web/next-env.d.ts` เปลี่ยนเองหลังรัน | Next.js เขียนไฟล์นี้เอง — ไม่ต้อง commit |
| TOR ไม่ถูกนำเข้า "over the limit" | ไฟล์ใหญ่กว่า 25 MB — ตั้งใจข้าม |

**ข้อควรระวังเรื่องข้อมูลร่วม:** Mongo Atlas และ GCS bucket ใช้ร่วมกันทั้งทีม — ห้ามลบข้อมูล
ทดสอบที่เขียนข้อมูลให้ใช้ Mongo ในเครื่อง (Docker) ไม่ใช่ Atlas
