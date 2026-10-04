// Picks the documents that become records out of an e-GP bid package (spec decision 5).
//
// A package holds the TOR — often split into TOR(1).pdf plus Attach_TOR_2..n.pdf, or a single
// Attach_TOR_1.pdf in older packages — the announcement, the bid document, bond and contract
// forms, and an action plan. Only the primary TOR and, in a final package, the invitation to bid
// become records; the archived package keeps everything else.
import type { ZipEntry } from "./zip.js";

export interface PackageDocuments {
  tor?: ZipEntry;
  /** Only from a final bid package: a draft package's announcement carries draft dates. */
  invitation?: ZipEntry;
}

function basename(name: string): string {
  return name.split("/").pop() ?? name;
}

const NAMED_TOR = /^tor\b.*\.pdf$/i; // TOR.pdf, TOR(1).pdf
const ATTACHED_TOR = /^attach_tor_(\d+)\.pdf$/i; // Attach_TOR_1.pdf
const ANNOUNCEMENT = /^annoudoc_.*\.pdf$/i; // annoudoc_<deptId>_<projectId>.pdf

/** The primary TOR: a file named TOR first, else the lowest-numbered Attach_TOR_n. */
function primaryTor(entries: ZipEntry[]): ZipEntry | undefined {
  const named = entries
    .filter((e) => NAMED_TOR.test(basename(e.name)))
    .sort((a, b) => basename(a.name).localeCompare(basename(b.name)));
  if (named.length > 0) return named[0];

  return entries
    .map((entry) => ({ entry, n: Number(ATTACHED_TOR.exec(basename(entry.name))?.[1]) }))
    .filter(({ n }) => Number.isInteger(n))
    .sort((a, b) => a.n - b.n)[0]?.entry;
}

export function selectPackageDocuments(entries: ZipEntry[], options: { final: boolean }): PackageDocuments {
  const documents: PackageDocuments = {};
  const tor = primaryTor(entries);
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
