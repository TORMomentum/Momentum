import { createHash } from "node:crypto";

/** Content address for a stored document. The digest IS the storage key (FR-A-3). */
export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
