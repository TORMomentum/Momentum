/**
 * Puts records back in the extraction queue, so the worker reads them again.
 *
 *   npx tsx tools/reextract.mts --implausible-deadline   invitations whose deadline was read as before
 *                                                        their own announcement (a scan's ๙ read as ๕)
 *   npx tsx tools/reextract.mts --project 69099075091    every document of these e-GP projects
 *
 * Add --dry-run to list what would be queued without changing anything.
 *
 * Each record moves to "queued" through HistoryRepository, so the audit trail
 * (FR-E-5) says who sent it back and why, and gets one extraction job. The
 * stored original is untouched (FR-A-2); only its extracted fields are redone.
 * Run the worker (`npm run worker -w @tor-radar/api`) to process them.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Filter } from "mongodb";
import { MongoQueue } from "../apps/api/src/adapters/mongo.queue.js";
import { loadConfig } from "../apps/api/src/core/config.js";
import { connect, disconnect, jobs, tors, type TorDocument } from "../apps/api/src/core/db.js";
import { IMPLAUSIBLE_DEADLINE } from "../apps/api/src/modules/extraction/extraction.repository.js";
import { HistoryRepository } from "../apps/api/src/modules/history/history.repository.js";

const rootEnv = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const projectArg = args.indexOf("--project");
const projects = projectArg >= 0 ? args.slice(projectArg + 1).filter((arg) => !arg.startsWith("--")) : [];

let filter: Filter<TorDocument>;
let reason: string;
if (args.includes("--implausible-deadline")) {
  filter = { documentType: "invitation", reviewReasons: IMPLAUSIBLE_DEADLINE, "pipeline.state": { $ne: "queued" } };
  reason = "re-queued: deadline read as before the announcement";
} else if (projects.length > 0) {
  filter = { "sourceProject.projectNumber": { $in: projects }, "pipeline.state": { $ne: "queued" } };
  reason = "re-queued: requested for re-extraction";
} else {
  console.error("Choose one: --implausible-deadline, or --project <number...>  (optionally --dry-run)");
  process.exit(1);
}

const config = loadConfig(process.env);
const db = await connect(config.mongoUrl);
const queue = new MongoQueue(db, {
  maxAttempts: config.jobMaxAttempts,
  backoffMs: config.jobBackoffMs,
  lockMs: config.jobLockMs,
});
const history = new HistoryRepository(db);

try {
  const records = await tors(db)
    .find(filter, { projection: { "pipeline.state": 1, documentType: 1, "sourceProject.projectNumber": 1 } })
    .toArray();

  let queued = 0;
  for (const record of records) {
    const id = record._id.toString();
    // A live job will run anyway — one a stopped worker left behind is reclaimed
    // once its lock expires — so a second would only duplicate it.
    const live = await jobs(db).countDocuments({ torId: id, state: { $in: ["pending", "running"] } });
    const label = `${(record.documentType ?? "tor").padEnd(10)} ${record.sourceProject?.projectNumber ?? id}  (${record.pipeline.state})`;
    if (live > 0) {
      console.log(`skip    ${label} — a job is already live`);
      continue;
    }
    if (!DRY_RUN) {
      await history.record(id, { from: record.pipeline.state, to: "queued", actor: "admin", source: "reextract-tool", reason });
      await queue.enqueue(id);
    }
    queued += 1;
    console.log(`${DRY_RUN ? "would  " : "queued "} ${label}`);
  }
  console.log(JSON.stringify({ event: "reextract_done", dryRun: DRY_RUN, matched: records.length, queued }));
} finally {
  await disconnect();
}
