/**
 * Where a stored document lives in the bucket.
 *
 * The key stays derived from the content hash, because that is what makes
 * storage content-addressed: the same bytes always land on the same key, an
 * upload can never overwrite a different document, and the dedupe guarantee and
 * the storage location are the same fact (FR-A-2, FR-A-3). A key built from a
 * filename or an agency name would break all three — two names for one
 * document, and one name for two.
 *
 * What it does add is legibility, which costs nothing:
 *
 *   tors/cf/a3/cfa3181c1ee36e8bce5e39f84959f4558ea7ba32c0e4539a8ab3c8ce8c716ec6.pdf
 *   └──┘ └───┘ └──────────────────────── the identity ───────────────────────┘ └─┘
 *   type shard                                                                 kind
 *
 * The two shard levels keep any one prefix listing small — a flat bucket with
 * a hundred thousand siblings is slow to browse and slow to list — and are
 * taken from the hash itself, so the key remains a pure function of the bytes.
 * The extension tells an operator, and the browser downloading it, what the
 * file is.
 */

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "text/html": "html",
};

/** Documents live under one prefix so later kinds (exports, thumbnails) can have their own. */
const PREFIX = "tors";

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType] ?? "bin";
}

export function storageKeyFor(contentHash: string, contentType: string): string {
  const shardA = contentHash.slice(0, 2);
  const shardB = contentHash.slice(2, 4);
  return `${PREFIX}/${shardA}/${shardB}/${contentHash}.${extensionFor(contentType)}`;
}
