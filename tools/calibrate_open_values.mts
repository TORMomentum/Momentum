/**
 * Measures the values TOR-200 settled, on whatever corpus MONGO_URL points at. Read-only: it only reads.
 *
 *   npx tsx tools/calibrate_open_values.mts
 *
 * Prints, as JSON, the distributions the defaults of MIN_BID_WINDOW_DAYS, MIN_SCOPE_CHARS and
 * MIN_SCOPE_SECTIONS were taken from (their 10th percentile), and how IQR and Z-score compare on the budgets.
 * Re-run it as the corpus grows; the derivation is in docs/superpowers/specs/2026-10-06-quality-checklist-design.md §8.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, tors } from "../apps/api/src/core/db.js";
import { eligibleFilter, NOT_SUPPORTING_DOCUMENT } from "../apps/api/src/modules/stats/eligibility.js";
import { quantile, verdictFor, type PeerBounds } from "../apps/api/src/modules/stats/anomaly.rule.js";
import { calendarDate } from "../apps/api/src/lib/calendar-date.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const config = loadConfig(process.env);
const DAY_MS = 86_400_000;

/** Count, extremes and the percentiles the defaults were read from (type 7, as the anomaly rule's quartiles). */
function describe(values: number[]) {
  if (values.length === 0) return { n: 0 };
  const at = (p: number) => quantile(values, p);
  return { n: values.length, min: Math.min(...values), p5: at(0.05), p10: at(0.1), p25: at(0.25), median: at(0.5), p75: at(0.75), p90: at(0.9), max: Math.max(...values) };
}

const db = await connect(config.mongoUrl);
try {
  const published = { "pipeline.state": "published", "access.restricted": false, ...NOT_SUPPORTING_DOCUMENT };
  const records = await tors(db).find(published, { projection: { announcedAt: 1, fields: 1 } }).toArray();

  // C2: calendar days from the announcement to a confirmed deadline, in the cohort time zone.
  const windows: number[] = [];
  for (const record of records) {
    const deadline = record.fields.deadline;
    if (!record.announcedAt || !deadline?.verified || !deadline.value) continue;
    const days = Math.round((Date.parse(`${deadline.value}T00:00:00Z`) - Date.parse(`${calendarDate(record.announcedAt, config.stats.timezone)}T00:00:00Z`)) / DAY_MS);
    if (Number.isFinite(days)) windows.push(days);
  }

  // C3: the confirmed summary's length in characters, and the confirmed count of concrete requirements.
  const chars = records.flatMap((record) => {
    const summary = record.fields.scopeSummary;
    return summary?.verified && typeof summary.value === "string" ? [[...summary.value.trim()].length] : [];
  });
  const items = records.flatMap((record) => {
    const count = record.fields.scopeItems;
    return count?.verified && typeof count.value === "number" ? [count.value] : [];
  });

  // O4: both methods over every evaluable budget, each against its own cohort's window, as the dashboard does.
  const eligible = await tors(db).find({ ...eligibleFilter(), ...NOT_SUPPORTING_DOCUMENT, cohort: { $exists: true } }, { projection: { cohort: 1, "fields.budget.value": 1 } }).toArray();
  const byCategory = new Map<string, { month: string; budget: number }[]>();
  for (const record of eligible) {
    const rows = byCategory.get(record.cohort!.category) ?? [];
    rows.push({ month: record.cohort!.month, budget: record.fields.budget!.value as number });
    byCategory.set(record.cohort!.category, rows);
  }
  const shift = (month: string, offset: number) => {
    const [year, number] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year!, number! - 1 + offset));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const { stats } = config;
  const boundsFor = (category: string, month: string): PeerBounds => {
    const window = new Set(Array.from({ length: stats.peerWindowMonths }, (_, back) => shift(month, -back)));
    const values = (byCategory.get(category) ?? []).filter((row) => window.has(row.month)).map((row) => row.budget);
    const n = values.length;
    if (n === 0) return { n };
    const q1 = quantile(values, 0.25);
    const q3 = quantile(values, 0.75);
    const mean = values.reduce((sum, value) => sum + value, 0) / n;
    const stdDev = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n);
    return { n, q1, q3, iqr: q3 - q1, lowBound: q1 - stats.iqrMultiplier * (q3 - q1), highBound: q3 + stats.iqrMultiplier * (q3 - q1), mean, stdDev };
  };
  const rule = { minN: stats.peerMinN, iqrMultiplier: stats.iqrMultiplier, zScoreLimit: stats.zScoreLimit };
  const tally = { evaluated: 0, iqrFlagged: 0, zScoreFlagged: 0, both: 0, iqrOnly: 0, zScoreOnly: 0, inCohortsTooSmallForZScore: 0 };
  for (const record of eligible) {
    const bounds = boundsFor(record.cohort!.category, record.cohort!.month);
    const input = { budget: record.fields.budget!.value as number, eligible: true as const };
    const iqr = verdictFor(input, bounds, { ...rule, method: "IQR" });
    if (iqr.kind === "not-evaluated") continue;
    const z = verdictFor(input, bounds, { ...rule, method: "ZSCORE" });
    tally.evaluated += 1;
    if (iqr.kind === "anomaly") tally.iqrFlagged += 1;
    if (z.kind === "anomaly") tally.zScoreFlagged += 1;
    if (iqr.kind === "anomaly" && z.kind === "anomaly") tally.both += 1;
    if (iqr.kind === "anomaly" && z.kind !== "anomaly") tally.iqrOnly += 1;
    if (iqr.kind !== "anomaly" && z.kind === "anomaly") tally.zScoreOnly += 1;
    // With n values and the population standard deviation, |z| cannot exceed (n - 1) / sqrt(n).
    if ((bounds.n - 1) / Math.sqrt(bounds.n) <= stats.zScoreLimit) tally.inCohortsTooSmallForZScore += 1;
  }

  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(),
    publishedTors: records.length,
    c2BidWindowDays: describe(windows.filter((days) => days >= 0)),
    c2ShorterThanDefault: windows.filter((days) => days >= 0 && days < config.checklist.minBidWindowDays).length,
    c2DeadlineBeforeAnnouncement: windows.filter((days) => days < 0).length,
    c3ScopeSummaryChars: describe(chars),
    c3ScopeItems: describe(items),
    o4: { cohortWindowMonths: stats.peerWindowMonths, peerMinN: stats.peerMinN, ...tally },
  }, null, 2));
} finally {
  await disconnect();
}
