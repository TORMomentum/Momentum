/**
 * Recomputes `award.winnerKind` with the current rule (lib/winner-kind.ts) for every winner announcement, and
 * copies a changed award onto its project's TORs (TOR-221). No model call: the stored winner name is re-classed.
 *
 *   npx tsx tools/recompute_winner_kind.mts            report what would change
 *   npx tsx tools/recompute_winner_kind.mts --apply    write it
 *
 * Run it after the rule changes. Re-running is safe: an award already classed as the rule says is left alone.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, tors } from "../apps/api/src/core/db.js";
import { winnerKindOf } from "../apps/api/src/lib/winner-kind.js";
import { ExtractionRepository } from "../apps/api/src/modules/extraction/extraction.repository.js";
import { AWARD_STAGE_CODES } from "../apps/api/src/sources/national-egp/stages.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const APPLY = process.argv.includes("--apply");
const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);
const repo = new ExtractionRepository(db);
const tally = { awards: 0, changed: 0, toJuristic: 0, toIndividual: 0 };

try {
  for await (const record of tors(db).find({ documentType: "award", award: { $exists: true } })) {
    const award = record.award!;
    tally.awards += 1;
    const kind = winnerKindOf(award.winner.value);
    if (kind === award.winnerKind) continue;
    tally.changed += 1;
    if (kind === "juristic") tally.toJuristic += 1;
    else tally.toIndividual += 1;
    console.log(`${APPLY ? "changed" : "would change"}  ${record.sourceProject?.projectId ?? record._id.toString()}  ${award.winnerKind} → ${kind}`);
    if (!APPLY) continue;
    const updated = { ...award, winnerKind: kind };
    await tors(db).updateOne({ _id: record._id }, { $set: { award: updated, updatedAt: new Date() } });
    const projectId = record.sourceProject?.projectId;
    if (projectId) await repo.linkAward(projectId, updated, AWARD_STAGE_CODES);
  }
} finally {
  console.log(JSON.stringify({ event: "winner_kind_recomputed", apply: APPLY, ...tally }));
  await disconnect();
}
