export interface StoredObject {
  bucket: string;
  key: string;
  contentType: string;
  bytes: number;
}

/**
 * Free-text notes stored alongside the object. Operator convenience only —
 * nothing reads them back, so nothing depends on them, and personal data does
 * not belong here (FR-B-5).
 */
export interface StorageMetadata {
  /** What the submitter called the file, when the route knows it. */
  originalFilename?: string;
  /** upload | url | api — how the document arrived. */
  route?: string;
}

/**
 * Object storage for original documents. There is deliberately no `put`. The
 * interface stops callers asking for an overwrite; immutability itself is
 * enforced by the bucket's permissions and policy (spec §3).
 */
export interface Storage {
  putIfAbsent(
    key: string,
    bytes: Buffer,
    contentType: string,
    metadata?: StorageMetadata,
  ): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  /** An inclusive byte range when given (spec §5.4). */
  getStream(key: string, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream>;
}
