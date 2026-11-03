// The rules that tie a code change to the doc it makes stale. Kept apart from
// check_docs_drift.mjs so they can be tested without git. Each rule mirrors one
// row of the "Docs stay current" table in CLAUDE.md — change them together.

const source = /^(apps|packages)\/[^/]+\/src\//;
const test = /\.test\.tsx?$/;

export const rules = [
  {
    doc: "docs/API.md",
    why: "a route, its body, its query or its auth changed",
    applies: ({ path }) => /^apps\/api\/src\/.*\.routes\.ts$/.test(path) && !test.test(path),
  },
  {
    doc: "docs/ARCHITECTURE.md",
    why: "a collection, index, module or worker changed",
    applies: ({ status, path }) =>
      path === "apps/api/src/core/db.ts" ||
      ((status === "A" || status === "D") &&
        /^apps\/api\/src\/(modules|workers)\//.test(path) &&
        !test.test(path)),
  },
  {
    doc: "docs/TESTING.md",
    why: "a test file was added or removed",
    applies: ({ status, path }) => (status === "A" || status === "D") && test.test(path),
  },
  {
    doc: "docs/TODO.md",
    why: "application code changed, so live status did too",
    applies: ({ path }) => source.test(path),
  },
  {
    doc: "AGENTS.md",
    why: "CLAUDE.md changed; the portable copy must carry the same rules",
    applies: ({ path }) => path === "CLAUDE.md",
  },
  {
    doc: "CLAUDE.md",
    why: "AGENTS.md changed; CLAUDE.md is the fuller form of the same rules",
    applies: ({ path }) => path === "AGENTS.md",
  },
];

/**
 * @param {{ status: string, path: string }[]} changes  one entry per changed file
 * @returns {{ doc: string, why: string, because: string[] }[]}  docs that should
 *   have changed and did not, each with the files that made it stale
 */
export function driftFindings(changes) {
  const touched = new Set(changes.map((change) => change.path));
  return rules
    .map((rule) => ({
      doc: rule.doc,
      why: rule.why,
      because: changes.filter(rule.applies).map((change) => change.path),
    }))
    .filter((finding) => finding.because.length > 0 && !touched.has(finding.doc));
}
