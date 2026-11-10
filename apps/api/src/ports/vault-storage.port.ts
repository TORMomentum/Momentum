import type { Storage } from "./storage.port.js";

/**
 * A vendor's own files (TOR-218). Unlike the originals, these can be removed: the vendor deletes a file, and
 * deleting the account deletes them all. Kept as a separate port so the originals' storage never gains a
 * delete, and so the identity that may delete is the one that reaches only this bucket.
 */
export interface VaultStorage extends Storage {
  /** Removing what is already gone is not an error. */
  delete(key: string): Promise<void>;
}
