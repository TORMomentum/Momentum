import { GcsStorage } from "./gcs.storage.js";
import type { VaultStorage } from "../ports/vault-storage.port.js";

/** The vault bucket. Same behaviour as the originals' adapter, plus the delete that one deliberately lacks. */
export class GcsVaultStorage extends GcsStorage implements VaultStorage {
  async delete(key: string): Promise<void> {
    try {
      await this.file(key).delete({ ignoreNotFound: true });
    } catch (error) {
      throw this.translate(error);
    }
  }
}
