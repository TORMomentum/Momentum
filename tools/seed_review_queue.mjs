/**
 * Puts a few low-confidence records into the review queue so the admin screens
 * can be worked on and demonstrated before the extractor has run over a real
 * corpus.
 *
 *   node tools/seed_review_queue.mjs [--clear]
 *
 * DEVELOPMENT ONLY. These records are marked `seed: true` so they can be told
 * apart from anything the pipeline produced, and `--clear` removes exactly
 * those and nothing else.
 */
import { MongoClient, ObjectId } from "mongodb";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const MONGO_URL = process.env.MONGO_URL;
if (!MONGO_URL) {
  console.error("MONGO_URL is not set — is the repository .env filled in?");
  process.exit(1);
}

const field = (raw, value, confidence, verified = false, evidence = undefined) => ({
  raw,
  value,
  confidence,
  verified,
  ...(evidence ? { evidence } : {}),
});

/**
 * Three failure shapes the grader actually produces, not three variations of
 * one. Every record carries all nine fields, because a real extraction does —
 * a sparse seed makes the review screen look alarming for the wrong reason.
 */
const RECORDS = [
  {
    reviewReasons: ["budget-unreadable"],
    hasTextLayer: false,
    contentType: "image/jpeg",
    fields: {
      title: field("จ้างเหมาปรับปรุงอาคารเรียน โรงเรียนบ้านหนองแวง", "จ้างเหมาปรับปรุงอาคารเรียน โรงเรียนบ้านหนองแวง", 0.91),
      agency: field("สพฐ. เขตพื้นที่การศึกษาประถมศึกษา 3", "สพฐ. เขตพื้นที่การศึกษาประถมศึกษา 3", 0.88),
      budget: field("", null, 0.12, false, "ตัวเลขในภาพเบลอ — หน้า 2 ย่อหน้า 3"),
      category: field("ก่อสร้าง / ปรับปรุงอาคาร", "ก่อสร้าง", 0.83),
      scopeSummary: field(
        "ปรับปรุงอาคารเรียน 2 ชั้น 8 ห้องเรียน เปลี่ยนหลังคาและระบบไฟฟ้า พร้อมทาสีภายในภายนอก",
        "ปรับปรุงอาคารเรียน 2 ชั้น 8 ห้องเรียน เปลี่ยนหลังคาและระบบไฟฟ้า พร้อมทาสีภายในภายนอก",
        0.86,
      ),
      qualifications: field("ผู้รับเหมางานก่อสร้างชั้น 5 ขึ้นไป", ["ผู้รับเหมางานก่อสร้างชั้น 5 ขึ้นไป"], 0.81),
      deadline: field("29 ส.ค. 2569", "2026-08-29", 0.79),
      contact: field("กลุ่มบริหารงานการเงิน 043-xxx-xxx", "กลุ่มบริหารงานการเงิน 043-xxx-xxx", 0.77),
      torStatus: field("ประกาศ", "announced", 0.9),
    },
  },
  {
    reviewReasons: ["deadline-before-announcement"],
    hasTextLayer: false,
    contentType: "application/pdf",
    fields: {
      title: field("ซื้อครุภัณฑ์คอมพิวเตอร์ 45 เครื่อง สำนักงานจังหวัดลำปาง", "ซื้อครุภัณฑ์คอมพิวเตอร์ 45 เครื่อง", 0.87),
      agency: field("สำนักงานจังหวัดลำปาง", "สำนักงานจังหวัดลำปาง", 0.9),
      budget: field("1,850,000 บาท", 1850000, 0.84),
      category: field("ไอที/ซอฟต์แวร์", "ไอที/ซอฟต์แวร์", 0.85),
      scopeSummary: field(
        "จัดซื้อเครื่องคอมพิวเตอร์สำนักงาน 45 ชุด พร้อมติดตั้งและรับประกัน 3 ปี",
        "จัดซื้อเครื่องคอมพิวเตอร์สำนักงาน 45 ชุด พร้อมติดตั้งและรับประกัน 3 ปี",
        0.88,
      ),
      qualifications: field("ผู้ขายที่ขึ้นทะเบียนกับกรมบัญชีกลาง", ["ผู้ขายที่ขึ้นทะเบียนกับกรมบัญชีกลาง"], 0.8),
      deadline: field("2 ก.ค. 2569", "2026-07-02", 0.61, false, "กำหนดยื่นซองก่อนวันประกาศ 12 ส.ค. 2569"),
      contact: field("ฝ่ายพัสดุ 054-xxx-xxx", "ฝ่ายพัสดุ 054-xxx-xxx", 0.82),
      torStatus: field("ประกาศ", "announced", 0.89),
    },
  },
  {
    reviewReasons: ["agency-unreadable", "copy-through"],
    hasTextLayer: true,
    contentType: "application/pdf",
    fields: {
      title: field("ประกวดราคาอิเล็กทรอนิกส์", "ประกวดราคาอิเล็กทรอนิกส์", 0.44, false, "หัวกระดาษซ้ำทุกหน้า"),
      agency: field("ประกวดราคาอิเล็กทรอนิกส์", null, 0.31, false, "อ่านชื่อหน่วยงานไม่ได้"),
      budget: field("3,200,000 บาท", 3200000, 0.86),
      category: field("ประกวดราคาอิเล็กทรอนิกส์", null, 0.29),
      scopeSummary: field(
        "จ้างเหมาบริการทำความสะอาดอาคารสำนักงาน ระยะเวลา 12 เดือน",
        "จ้างเหมาบริการทำความสะอาดอาคารสำนักงาน ระยะเวลา 12 เดือน",
        0.83,
      ),
      qualifications: field("นิติบุคคลที่มีประสบการณ์งานทำความสะอาด", ["นิติบุคคลที่มีประสบการณ์งานทำความสะอาด"], 0.78),
      deadline: field("15 ก.ย. 2569", "2026-09-15", 0.85),
      contact: field("งานพัสดุ 02-xxx-xxxx", "งานพัสดุ 02-xxx-xxxx", 0.8),
      torStatus: field("ประกาศ", "announced", 0.87),
    },
  },
];

const client = new MongoClient(MONGO_URL);
await client.connect();
const db = client.db();

if (process.argv.includes("--clear")) {
  const { deletedCount } = await db.collection("tors").deleteMany({ seed: true });
  await db.collection("tor_events").deleteMany({ actor: "seed" });
  console.log(`removed ${deletedCount} seeded records`);
  await client.close();
  process.exit(0);
}

const now = new Date();
let created = 0;

for (const [index, record] of RECORDS.entries()) {
  const id = new ObjectId();
  const at = new Date(now.getTime() - (RECORDS.length - index) * 3_600_000);
  const contentHash = `seed${id.toString().padStart(60, "0")}`.slice(0, 64);

  await db.collection("tors").insertOne({
    _id: id,
    seed: true,
    schemaVersion: 1,
    contentHash,
    storage: {
      bucket: process.env.MINIO_BUCKET ?? "tor-raw",
      key: `tors/${at.getUTCFullYear()}/${String(at.getUTCMonth() + 1).padStart(2, "0")}/${contentHash}.pdf`,
      contentType: record.contentType,
      bytes: 240_000 + index * 40_000,
    },
    sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: at }],
    pipeline: { state: "published", attempts: 1 },
    fields: record.fields,
    announcedAt: null,
    sourceUrl: null,
    confidenceLevel: "low",
    unverified: true,
    reviewReasons: record.reviewReasons,
    hasTextLayer: record.hasTextLayer,
    provenance: {
      ocrModel: "seed",
      extractModel: "seed",
      modelVersion: "seed",
      extractedAt: at.toISOString(),
      thresholdsVersion: "seed",
    },
    statusHistory: [{ from: null, to: "queued", at, actor: "seed", source: "upload" }],
    access: { restricted: false },
    duplicateOf: null,
    createdAt: at,
    updatedAt: at,
  });

  await db.collection("tor_events").insertMany([
    { torId: id.toString(), from: null, to: "queued", at, actor: "seed", source: "upload" },
    { torId: id.toString(), from: "queued", to: "extracting", at: new Date(at.getTime() + 1000), actor: "seed", source: "worker" },
    { torId: id.toString(), from: "extracting", to: "published", at: new Date(at.getTime() + 9000), actor: "seed", source: "worker" },
  ]);

  created += 1;
}

console.log(`seeded ${created} records into the review queue`);
await client.close();
