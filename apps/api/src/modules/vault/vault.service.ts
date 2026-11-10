import type { VaultStorage } from "../../ports/vault-storage.port.js";
import { VaultRepository } from "./vault.repository.js";

/** Removing what a vendor kept: the files first, then the records that name them. */
export class VaultService {
  constructor(
    private readonly repo: VaultRepository,
    private readonly storage: VaultStorage,
  ) {}

  /**
   * Every file of one account. The files go first: if storage fails the records survive, the caller gets an
   * error and can retry. Deleting the records first would leave files nothing points to, and nothing to
   * delete them by.
   */
  async removeAll(accountId: string): Promise<void> {
    for (const key of await this.repo.keysFor(accountId)) await this.storage.delete(key);
    await this.repo.removeAll(accountId);
  }

  async removeOne(accountId: string, id: string): Promise<boolean> {
    const doc = await this.repo.find(accountId, id);
    if (!doc) return false;
    await this.storage.delete(doc.key);
    await this.repo.remove(accountId, id);
    return true;
  }
}
