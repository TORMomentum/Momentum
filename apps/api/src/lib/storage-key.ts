/**
 * Where a stored document lives in the bucket.
 *
 * The document's identity in the key stays the content hash, because that is
 * what makes an upload unable to overwrite a different document (FR-A-2) and
 * what ties an object to exactly one record (FR-A-3). A key built from a
 * filename or an agency name would break both — two names for one document,
 * and one name for two — and a name that is only known after extraction would
 * require renaming, which in object storage means copy-then-delete.
 *
 * What it does add is legibility, which costs nothing:
 *
 *   tors/2026/09/cfa3181c1ee36e8bce5e39f84959f4558ea7ba32c0e4539a8ab3c8ce8c716ec6.pdf
 *   └──┘ └─────┘ └──────────────────────── the identity ───────────────────────┘ └─┘
 *   type  month                                                                  kind
 *
 * The month prefix is for whoever has to operate this: the console renders
 * prefixes as folders, so an intake problem is scoped to "what arrived in
 * September" instead of one flat list of hashes. The extension tells an
 * operator, and a downloading browser, what the file is.
 *
 * Hash-shard prefixes were tried and removed. AWS auto-scales per prefix
 * (3,500 writes and 5,500 reads per second, unlimited prefixes), so sharding
 * by hash solves a problem this system does not have and costs the readability
 * that a date prefix buys.
 *
 * The key is therefore not a pure function of the bytes any more — the same
 * document submitted in two different months would compute two keys. That is
 * harmless because the key is not the dedupe mechanism: the unique index on
 * `contentHash` is, an existing record short-circuits before storage is ever
 * touched, and every read uses the key recorded on the record rather than
 * recomputing one.
 */

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "text/html": "html",
  "application/zip": "zip",
};

/** Documents live under one prefix so later kinds (exports, thumbnails) can have their own. */
const PREFIX = "tors";
/** Source packages a document was unpacked from, kept whole as originals. */
const PACKAGE_PREFIX = "packages";

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType] ?? "bin";
}

function keyUnder(prefix: string, contentHash: string, contentType: string, at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${prefix}/${year}/${month}/${contentHash}.${extensionFor(contentType)}`;
}

export function storageKeyFor(contentHash: string, contentType: string, at: Date = new Date()): string {
  return keyUnder(PREFIX, contentHash, contentType, at);
}

/** Where a source package (an e-GP bid package ZIP, say) is archived — same identity rules as a document. */
export function packageKeyFor(contentHash: string, contentType: string, at: Date = new Date()): string {
  return keyUnder(PACKAGE_PREFIX, contentHash, contentType, at);
}
