/**
 * Matching at corpus scale, measured rather than assumed.
 *
 * Seeds N synthetic TORs into a throwaway database — spread across the national
 * categories, with titles in the words real announcements use, deadlines both
 * passed and open — then runs matching for vendors of different kinds and
 * reports what came back and how long it took. Nothing here touches the
 * development database: the name is forced to end in _bench and dropped after.
 *
 *   npx tsx tools/bench_matching.mts [--count 400]
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ObjectId } from "mongodb";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, ensureIndexes, torClassifications, tors, type VendorProfileDocument } from "../apps/api/src/core/db.js";
import { MatchingRepository } from "../apps/api/src/modules/matching/matching.repository.js";
import { scoreMatch } from "../apps/api/src/modules/matching/match-scorer.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const countArg = process.argv.indexOf("--count");
const COUNT = countArg > -1 ? Number(process.argv[countArg + 1]) : 400;

/** Titles as announcements word them, each with the category the old extraction gave it. */
const KINDS: Array<{ title: string; category: string }> = [
  { title: "ก่อสร้างถนนคอนกรีตเสริมเหล็ก หมู่ที่", category: "งานก่อสร้าง-ทาง" },
  { title: "ปรับปรุงผิวจราจรแอสฟัลต์ติก ซอย", category: "งานก่อสร้าง-ทาง" },
  { title: "ก่อสร้างท่อระบายน้ำ พร้อมบ่อพัก ถนน", category: "งานก่อสร้าง-ทาง" },
  { title: "ก่อสร้างอาคารเรียน 2 ชั้น โรงเรียน", category: "ก่อสร้าง / ปรับปรุงอาคาร" },
  { title: "ปรับปรุงภูมิทัศน์สวนสาธารณะ", category: "งานก่อสร้าง" },
  { title: "ซื้อครุภัณฑ์คอมพิวเตอร์ โน้ตบุ๊ก", category: "ซื้อครุภัณฑ์" },
  { title: "จ้างพัฒนาระบบสารสนเทศและเว็บไซต์", category: "ไอที/ซอฟต์แวร์" },
  { title: "ซื้อครุภัณฑ์การแพทย์ เครื่องเอกซเรย์", category: "ซื้อครุภัณฑ์" },
  { title: "จ้างเหมาบริการรักษาความปลอดภัย", category: "จ้างเหมาบริการ" },
  { title: "จ้างเหมาทำความสะอาดอาคารสำนักงาน", category: "จ้างเหมาบริการ" },
  { title: "จ้างที่ปรึกษาศึกษาความเหมาะสมโครงการ", category: "จ้างเหมาบริการ" },
  { title: "ซื้อรถบรรทุกขยะ แบบอัดท้าย", category: "ซื้อครุภัณฑ์" },
  { title: "เช่ารถยนต์ส่วนกลาง", category: "จ้างเหมาบริการ" },
  { title: "จ้างเหมาบริการติดตั้งระบบเสียงห้องประชุม", category: "จ้างเหมาบริการ" },
];

function day(offset: number): string {
  return new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
}

/** What each vendor would call relevant, judged by the words in the title. */
const RELEVANT: Record<string, string[]> = {
  "road works": ["ถนน", "ผิวจราจร", "ท่อระบายน้ำ"],
  "all construction": ["ก่อสร้าง", "ปรับปรุง", "ภูมิทัศน์"],
  software: ["ระบบสารสนเทศ", "เว็บไซต์", "พัฒนาระบบ"],
  "security guards": ["รักษาความปลอดภัย"],
  "hired services broadly": ["จ้าง", "เช่า"],
  "free text only: ระบบเสียง": ["ระบบเสียง"],
};

async function main() {
  // This tool DROPS a database. It runs against the local test database and
  // refuses a hosted cluster outright — the development .env points MONGO_URL at
  // the team's shared Atlas cluster.
  if (process.env.TEST_MONGO_URL) process.env.MONGO_URL = process.env.TEST_MONGO_URL;
  if (/mongodb\+srv:|\.mongodb\.net\b/.test(process.env.MONGO_URL ?? "")) {
    throw new Error("Refusing to benchmark against a hosted MongoDB cluster. Set TEST_MONGO_URL to a local database.");
  }
  const config = loadConfig(process.env);
  const url = config.mongoUrl.replace(/\/([^/?]+)(\?|$)/, "/$1_bench$2");
  const db = await connect(url);
  await db.dropDatabase();
  await ensureIndexes(db);

  const docs = Array.from({ length: COUNT }, (_, i) => {
    const kind = KINDS[i % KINDS.length]!;
    // Roughly a third already closed, so exclusion is exercised too.
    const deadline = day(i % 3 === 0 ? -10 : 5 + (i % 40));
    const budget = 100_000 + ((i * 97_331) % 20_000_000);
    const title = `${kind.title} ${i}`;
    return {
      _id: new ObjectId(),
      contentHash: `bench-${i}`,
      storage: { bucket: "bench", key: `bench-${i}`, contentType: "application/pdf", bytes: 1 },
      sourceRefs: [],
      pipeline: { state: "published", attempts: 1 },
      fields: {
        title: { raw: title, value: title, confidence: 1, verified: true },
        category: { raw: kind.category, value: kind.category, confidence: 1, verified: true },
        budget: { raw: String(budget), value: budget, confidence: 1, verified: true },
        deadline: { raw: deadline, value: deadline, confidence: 1, verified: true },
      },
      announcedAt: null,
      sourceUrl: null,
      unverified: false,
      statusHistory: [],
      access: { restricted: false },
      duplicateOf: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await tors(db).insertMany(docs as any);

  const matching = new MatchingRepository(db, config);
  const vendor = (categories: string[], otherCategories: string[] = []): VendorProfileDocument => ({
    accountId: "bench",
    categories,
    areas: ["thailand"],
    otherCategories,
    budget: { minThb: 500_000, maxThb: 5_000_000 },
    taxonomyVersion: "bench",
    updatedAt: new Date(),
  });

  const cases: Array<[string, VendorProfileDocument]> = [
    ["road works", vendor(["construction.road"])],
    ["all construction", vendor(["construction"])],
    ["software", vendor(["it.software"])],
    ["security guards", vendor(["services.security"])],
    ["hired services broadly", vendor(["services"])],
    ["free text only: ระบบเสียง", vendor([], ["ระบบเสียง"])],
  ];

  console.log(`corpus: ${COUNT} TORs\n`);
  for (const [label, profile] of cases) {
    const started = performance.now();
    const candidates = await matching.candidatesFor(profile);
    const ms = performance.now() - started;
    const classified = await torClassifications(db).countDocuments({});
    console.log(
      `${label.padEnd(26)} candidates ${String(candidates.length).padStart(4)}   ${ms.toFixed(0).padStart(5)} ms   classified ${classified}`,
    );
    // What a vendor actually sees: scored, exclusions dropped, best first.
    const today = new Date().toISOString().slice(0, 10);
    const shown = candidates
      .map((c) => ({ title: String(c.record.fields.title?.raw ?? ""), ...scoreMatch(profile, c.record, c.classification, config, today) }))
      .filter((m) => !m.excluded)
      .sort((a, b) => b.score - a.score);
    const top = shown.slice(0, 10);
    // How much of the top ten is the kind of work this vendor chose.
    const relevant = (title: string) => RELEVANT[label]?.some((word) => title.includes(word)) ?? false;
    const hits = top.filter((m) => relevant(m.title)).length;
    console.log(`${"".padEnd(26)} shown ${shown.length}   top-10 relevant ${hits}/${top.length}`);
    for (const m of top.slice(0, 3)) console.log(`${"".padEnd(28)}${m.score.toFixed(2)}  ${m.title.slice(0, 44)}`);
  }

  console.log(`\ncandidate cap: ${config.matching.candidateCap}`);
  await db.dropDatabase();
  await disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await disconnect();
  process.exit(1);
});
