#!/usr/bin/env node
// Fails when a branch changes code without the doc that describes it, so the
// next agent or teammate never starts from stale docs. Rules: docs_drift.mjs.
//
//   node tools/check_docs_drift.mjs [base]     base defaults to origin/main
//
// A change that truly needs no doc update is let through by the
// `docs-not-needed` pull-request label (CI sets DOCS_NOT_NEEDED=true).

import { execFileSync } from "node:child_process";
import { driftFindings } from "./docs_drift.mjs";

const base = process.argv[2] ?? "origin/main";
const diff = execFileSync("git", ["diff", "--name-status", "--no-renames", `${base}...HEAD`], {
  encoding: "utf8",
});
const changes = diff
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [status, path] = line.split("\t");
    return { status: status[0], path };
  });

const findings = driftFindings(changes);
if (findings.length === 0) {
  console.log(`Docs in step with code (${changes.length} changed file(s) against ${base}).`);
  process.exit(0);
}

for (const { doc, why, because } of findings) {
  console.log(`${doc} not updated — ${why}:`);
  for (const path of because.slice(0, 5)) console.log(`  ${path}`);
  if (because.length > 5) console.log(`  … and ${because.length - 5} more`);
}

if (process.env.DOCS_NOT_NEEDED === "true") {
  console.log("\nLet through: the pull request carries the docs-not-needed label.");
  process.exit(0);
}
console.log(
  "\nUpdate the docs above in this branch (CLAUDE.md, 'Docs stay current'), or label the pull request docs-not-needed if none applies.",
);
process.exit(1);
