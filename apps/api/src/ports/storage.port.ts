export interface StoredObject {
  bucket: string;
  key: string;
  contentType: string;
  bytes: number;
}

/**
 * Object storage for original documents. There is deliberately no `put`: FR-A-2
 * forbids overwriting a stored object, so the prohibition is enforced by the
 * interface rather than by convention.
 */
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

export interface Storage {
  putIfAbsent(
    key: string,
    bytes: Buffer,
    contentType: string,
    metadata?: StorageMetadata,
  ): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  getStream(key: string): Promise<NodeJS.ReadableStream>;
  /** Generated on demand, never persisted — signed URLs expire. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}
