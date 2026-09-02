// TOR-20 — extraction spike.
//
// Feeds each benchmark PDF (docs/corpus/tor-NN.pdf) to Gemini on Vertex and asks
// for the FR-B2 fields with a per-field confidence score (FR-B3). Writes
// predictions to docs/corpus/predictions/<model>/tor-NN.json and prints a rough
// field-level diff against the hand labels (labels/tor-NN.json).
//
//   npm run spike:extract                 # all 10 docs
//   npm run spike:extract -- --only tor-03 --only tor-06
//   npm run spike:extract -- --no-score
//
// ponytail: single Gemini call per PDF — the model does OCR + layout + extraction
// in one shot (native PDF input), no separate Document AI pass. Add a Document AI
// OCR stage only if the scanned-doc numbers in TOR-22 say Gemini vision isn't
// enough. Full scoring (precision/recall, threshold sweep) is TOR-22; the diff
// here is just a smoke signal.

import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv, geminiGenerate, responseText } from "./_vertex.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS = join(ROOT, "docs", "corpus");

loadEnv();
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const LOCATION = process.env.VERTEX_LOCATION ?? "us-central1";

const args = process.argv.slice(2);
const only = args.flatMap((a, i) => (a === "--only" ? [args[i + 1]] : [])).filter(Boolean);
const doScore = !args.includes("--no-score");

const bma = JSON.parse(readFileSync(join(ROOT, "tools", "bma-agencies.json"), "utf8"));
const bmaNeedles = [bma.parent, ...bma.districts.map((d) => `เขต${d}`), ...bma.offices];

// FR-B2 fields. Each comes back as { value, confidence (0..1), evidence }.
const FIELD_KEYS = [
  "title", "agency", "budget_thb", "category", "scope_summary",
  "required_qualifications", "submission_deadline", "contact", "status",
  "procurement_method", "announcement_date", "reference_no",
];

const fieldObj = (extra = {}) => ({
  type: "object",
  properties: {
    value: extra.value ?? { type: "string" },
    confidence: { type: "number" },
    evidence: { type: "string" },
  },
  required: ["value", "confidence"],
});

const responseSchema = {
  type: "object",
  properties: {
    title: fieldObj(),
    agency: fieldObj(),
    budget_thb: fieldObj({ value: { type: "number", nullable: true } }),
    category: fieldObj(),
    scope_summary: fieldObj(),
    required_qualifications: fieldObj({ value: { type: "array", items: { type: "string" } } }),
    submission_deadline: fieldObj({ value: { type: "string", nullable: true } }),
    contact: fieldObj({ value: { type: "string", nullable: true } }),
    status: fieldObj({ value: { type: "string", enum: ["announced", "closed", "awarded", "cancelled"] } }),
    procurement_method: fieldObj(),
    announcement_date: fieldObj({ value: { type: "string", nullable: true } }),
    reference_no: fieldObj({ value: { type: "string", nullable: true } }),
  },
  required: FIELD_KEYS,
};

const SYSTEM = `คุณเป็นผู้ช่วยสกัดข้อมูลจากเอกสารจัดซื้อจัดจ้าง (TOR / ประกาศประกวดราคา) ของหน่วยงานกรุงเทพมหานคร
ให้สกัดเฉพาะข้อมูลที่ปรากฏจริงในเอกสาร ห้ามเดาหรือเติมจากความรู้ภายนอก
- ตัวเลขเงินให้เป็นจำนวนบาท (number) ไม่มีคอมมา ถ้าเอกสารไม่ระบุงบประมาณ/ราคากลางให้ value = null (อย่าใช้เลขหลักประกันการเสนอราคาแทน)
- วันที่ให้เป็นรูปแบบ YYYY-MM-DD ปฏิทินเกรกอเรียน (พ.ศ. − 543); ถ้าเอกสารเว้นว่างให้ value = null
- ตัวเลขไทย (๐-๙) ให้แปลงเป็นอารบิก
- category: เลือกคำสั้น ๆ เช่น งานก่อสร้าง-ทาง, งานก่อสร้าง-ชลประทาน, งานก่อสร้าง-อาคาร, จ้างเหมาบริการ, ซื้อครุภัณฑ์, จ้างที่ปรึกษา
- required_qualifications: เฉพาะคุณสมบัติที่ใช้แยกแยะผู้เสนอราคา (ชั้นทะเบียนผู้รับเหมา, มอก., วิชาชีพวิศวกรรม ฯลฯ) ไม่ต้องเอา boilerplate (ล้มละลาย, ทิ้งงาน, ลงทะเบียน e-GP)
- status: announced | closed | awarded | cancelled (ประกาศยกเลิก = cancelled)
- confidence: 0..1 ความมั่นใจว่าค่านั้นถูกต้อง; evidence: ข้อความสั้น ๆ จากเอกสารที่ยืนยันค่านั้น (ถ้า value=null ให้ evidence อธิบายว่าไม่พบ)`;

function pdfPart(file) {
  return { inlineData: { mimeType: "application/pdf", data: readFileSync(file).toString("base64") } };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Vertex on a fresh trial project throttles hard — retry 429/503 with backoff.
async function generateWithRetry(req, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      return await geminiGenerate(req);
    } catch (err) {
      const code = err?.response?.status;
      if ((code === 429 || code === 503) && i < tries - 1) {
        await sleep(2000 * 2 ** i);
        continue;
      }
      throw err;
    }
  }
}

// Model sometimes wraps the JSON in chatter despite responseMimeType — slice it out.
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(text.slice(a, b + 1));
    throw new Error(`model did not return JSON:\n${text?.slice(0, 500)}`);
  }
}

async function generateAndParse(req, id, tries = 3) {
  let lastRaw = "";
  for (let i = 0; i < tries; i++) {
    const body = await generateWithRetry(req);
    lastRaw = responseText(body) ?? "";
    try {
      return { fields: parseJson(lastRaw), usage: body?.usageMetadata ?? null };
    } catch {
      // Model occasionally ignores JSON mode and prepends chatter — just retry.
      await sleep(1500);
    }
  }
  mkdirSync(join(outDir, "_raw"), { recursive: true });
  writeFileSync(join(outDir, "_raw", `${id}.txt`), lastRaw);
  throw new Error(`no valid JSON after ${tries} tries; raw saved to _raw/${id}.txt`);
}

async function extract(id) {
  const { fields, usage } = await generateAndParse({
    systemInstruction: SYSTEM,
    parts: [
      pdfPart(join(CORPUS, `${id}.pdf`)),
      { text: "สกัดข้อมูลตาม schema ที่กำหนด ตอบเป็น JSON เท่านั้น ห้ามมีข้อความอื่นนำหน้าหรือต่อท้าย" },
    ],
    generationConfig: { responseMimeType: "application/json", responseSchema, temperature: 0, maxOutputTokens: 8192 },
  }, id);
  // FR-A4 check is ours, not the model's.
  const agency = fields.agency?.value ?? "";
  const bmaValid = bmaNeedles.some((n) => agency.includes(n));
  return {
    id,
    extracted_at: new Date().toISOString(),
    model: MODEL,
    location: LOCATION,
    usage,
    agency_bma_valid: bmaValid,
    fields,
  };
}

// --- rough diff vs hand labels (smoke only; real scoring = TOR-22) ---
const norm = (v) =>
  v == null ? "∅" : String(Array.isArray(v) ? v.length + " items" : v).replace(/\s+/g, " ").trim().slice(0, 60);

function scoreOne(pred, gold) {
  const rows = [];
  for (const k of ["title", "agency", "budget_thb", "category", "submission_deadline", "status", "procurement_method"]) {
    const p = pred.fields[k]?.value ?? null;
    const g = gold[k] ?? null;
    let hit;
    if (k === "budget_thb") hit = Number(p) === Number(g) || (p == null && g == null);
    else if (["title", "agency", "category"].includes(k))
      hit = p && g && (norm(p) === norm(g) || String(p).includes(String(g)) || String(g).includes(String(p)));
    else hit = norm(p) === norm(g);
    rows.push({ field: k, pred: norm(p), gold: norm(g), conf: pred.fields[k]?.confidence ?? "-", hit: hit ? "✓" : "✗" });
  }
  return rows;
}

const ids = (only.length ? only : readdirSync(CORPUS).filter((f) => /^tor-\d+\.pdf$/.test(f)).map((f) => f.replace(".pdf", "")))
  .sort();

const outDir = join(CORPUS, "predictions", MODEL);
mkdirSync(outDir, { recursive: true });

console.log(`extract_spike: ${ids.length} doc(s) · ${MODEL} @ ${LOCATION}\n`);
let hits = 0, total = 0;

for (const id of ids) {
  if (id !== ids[0]) await sleep(1500); // be gentle with the trial-project quota
  process.stdout.write(`  ${id} ... `);
  try {
    const pred = await extract(id);
    writeFileSync(join(outDir, `${id}.json`), JSON.stringify(pred, null, 2));
    const toks = pred.usage ? `${pred.usage.promptTokenCount}→${pred.usage.candidatesTokenCount} tok` : "";
    console.log(`ok  (bma_valid=${pred.agency_bma_valid}) ${toks}`);
    if (doScore) {
      const goldPath = join(CORPUS, "labels", `${id}.json`);
      const gold = JSON.parse(readFileSync(goldPath, "utf8"));
      const rows = scoreOne(pred, gold);
      for (const r of rows) {
        total++; if (r.hit === "✓") hits++;
        console.log(`      ${r.hit} ${r.field.padEnd(20)} conf=${String(r.conf).padEnd(5)} pred=${JSON.stringify(r.pred)}  gold=${JSON.stringify(r.gold)}`);
      }
    }
  } catch (err) {
    console.log(`FAILED: ${err?.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : err.message}`);
  }
}

if (doScore && total) console.log(`\nrough field match: ${hits}/${total} (${Math.round((100 * hits) / total)}%) — indicative only, see TOR-22 for real scoring`);
console.log(`predictions → ${outDir.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
