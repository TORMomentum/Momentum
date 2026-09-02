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
export interface Storage {
  putIfAbsent(key: string, bytes: Buffer, contentType: string): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  getStream(key: string): Promise<NodeJS.ReadableStream>;
  /** Generated on demand, never persisted — signed URLs expire. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}
