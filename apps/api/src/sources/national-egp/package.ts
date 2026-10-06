// Picks the documents that become records out of an e-GP bid package (spec decision 5).
//
// A package holds the TOR — often split into TOR(1).pdf plus Attach_TOR_2..n.pdf, or a single
// Attach_TOR_1.pdf in older packages — the announcement, the bid document, bond and contract
// forms, and an action plan. Only the primary TOR and, in a final package, the invitation to bid
// become records; the archived package keeps everything else.
import type { ZipEntry } from "./zip.js";

export interface PackageDocuments {
  tor?: ZipEntry;
  /**
   * The TOR's other files — further TOR parts and bills of quantities — which often hold the scope
   * the main file only refers to ("ดูเอกสารแนบ ๑"). Read with the TOR; never a record of their own.
   */
  annexes: ZipEntry[];
  /** Only from a final bid package: a draft package's announcement carries draft dates. */
  invitation?: ZipEntry;
}

function basename(name: string): string {
  return name.split("/").pop() ?? name;
}

// TOR.pdf, TOR(1).pdf, 1141001044_TOR.pdf — "TOR" as a word of its own, so monitor.pdf is not one.
const NAMED_TOR = /(^|[^a-z])tor([^a-z]|$).*\.pdf$/i;
const ATTACHED_TOR = /^attach_tor_(\d+)\.pdf$/i; // Attach_TOR_1.pdf
const ANNOUNCEMENT = /^annoudoc_.*\.pdf$/i; // annoudoc_<deptId>_<projectId>.pdf
const BILL_OF_QUANTITIES = /^attach_boq_(\d+)\.pdf$/i; // Attach_BOQ_1.pdf

/**
 * The files e-GP generates or attaches as standard forms in every package — the announcement, the
 * bid document, bond and contract forms, the reference price — none of them an agency's TOR.
 */
const STANDARD_FILES = [
  /^annoudoc_/i,
  /^doc_/i,
  /^pb\d/i,
  /^attach_pub_/i,
  /^quotation/i,
  /bond/i,
  /^contract_/i,
  /^definition_/i,
  /^document part/i,
  /^bidding no/i,
  /^performance/i,
  /^bill_payment/i,
];

/**
 * The primary TOR: a file named TOR first, else the lowest-numbered Attach_TOR_n, else — when the
 * agency uploaded it under a name of its own (Scan_0004.pdf) — the one PDF that is not a standard
 * e-GP file. Two or more such PDFs are not guessed between.
 */
function primaryTor(entries: ZipEntry[]): ZipEntry | undefined {
  // Named TOR files, the numbered Attach_TOR_n set aside for its own rule below; a name that
  // starts with TOR (TOR(1).pdf, or e-GP's own TOR form tor_<project>_<uuid>.pdf — digital text,
  // "ร่างรายละเอียดขอบเขตของงาน… (Terms of Reference : TOR)") before one that only contains it
  // (1141001044_TOR.pdf). Attach_TOR_n files are often drawings or annexes.
  const named = entries
    .filter((e) => NAMED_TOR.test(basename(e.name)) && !ATTACHED_TOR.test(basename(e.name)))
    .sort((a, b) => {
      const lead = Number(/^tor/i.test(basename(b.name))) - Number(/^tor/i.test(basename(a.name)));
      return lead || basename(a.name).localeCompare(basename(b.name));
    });
  if (named.length > 0) return named[0];

  const attached = entries
    .map((entry) => ({ entry, n: Number(ATTACHED_TOR.exec(basename(entry.name))?.[1]) }))
    .filter(({ n }) => Number.isInteger(n))
    .sort((a, b) => a.n - b.n)[0]?.entry;
  if (attached) return attached;

  const agencyFiles = entries.filter((entry) => {
    const name = basename(entry.name);
    return /\.pdf$/i.test(name) && !STANDARD_FILES.some((pattern) => pattern.test(name));
  });
  return agencyFiles.length === 1 ? agencyFiles[0] : undefined;
}

/** The TOR's other parts: named or numbered TOR files, then bills of quantities, in reading order. */
function annexesOf(entries: ZipEntry[], tor: ZipEntry): ZipEntry[] {
  const number = (re: RegExp, entry: ZipEntry) => Number(re.exec(basename(entry.name))?.[1] ?? 0);
  const others = entries.filter((entry) => entry !== tor);
  const named = others.filter((e) => NAMED_TOR.test(basename(e.name)) && !ATTACHED_TOR.test(basename(e.name)));
  const attached = others.filter((e) => ATTACHED_TOR.test(basename(e.name))).sort((a, b) => number(ATTACHED_TOR, a) - number(ATTACHED_TOR, b));
  const boq = others.filter((e) => BILL_OF_QUANTITIES.test(basename(e.name))).sort((a, b) => number(BILL_OF_QUANTITIES, a) - number(BILL_OF_QUANTITIES, b));
  return [...named, ...attached, ...boq];
}

export function selectPackageDocuments(entries: ZipEntry[], options: { final: boolean }): PackageDocuments {
  const tor = primaryTor(entries);
  const documents: PackageDocuments = { annexes: tor ? annexesOf(entries, tor) : [] };
  if (tor) documents.tor = tor;
  if (options.final) {
    const invitation = entries.find((e) => ANNOUNCEMENT.test(basename(e.name)));
    if (invitation) documents.invitation = invitation;
  }
  return documents;
}

/** The entry's file name, for the record's download filename. */
export function entryFilename(entry: ZipEntry): string {
  return basename(entry.name);
}
