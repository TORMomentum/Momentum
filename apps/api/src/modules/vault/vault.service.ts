import type { ObjectId } from "mongodb";
import type { VaultStorage } from "../../ports/vault-storage.port.js";
import { VaultRepository } from "./vault.repository.js";

/**
 * Removing what a vendor kept. The rule throughout: a row is deleted only after the file it names is gone, so
 * a failure always leaves something that names the file and can be retried.
 */
export class VaultService {
  constructor(
    private readonly repo: VaultRepository,
    private readonly storage: VaultStorage,
  ) {}

  /**
   * Every file of one account, for deleting the account. Uploads still running are discarded first, so none
   * can finish afterwards; they clean up their own file when they find that out. Then every file the account
   * has is removed, and its stored rows. If storage fails the rows stay and the caller can retry.
   */
  async removeAll(accountId: string): Promise<void> {
    await this.repo.discardPending(accountId);
    for (const key of await this.repo.keysFor(accountId)) await this.storage.delete(key);
    await this.repo.removeReady(accountId);
  }

  async removeOne(accountId: string, id: string): Promise<boolean> {
    const doc = await this.repo.find(accountId, id);
    if (!doc) return false;
    await this.storage.delete(doc.key);
    await this.repo.remove(accountId, doc._id);
    return true;
  }

  /**
   * An upload that did not complete: its file (if any was written) and then its row. If the file cannot be
   * removed now the row is kept, marked discarded, and the sweep removes both later — an unreferenced file is
   * the outcome that must not happen.
   */
  async abandon(accountId: string, id: ObjectId): Promise<void> {
    const row = await this.repo.findAny(accountId, id);
    if (!row) return;
    try {
      await this.storage.delete(row.key);
    } catch {
      await this.repo.discard(accountId, id);
      return;
    }
    await this.repo.remove(accountId, id);
  }

  /**
   * Removes what unfinished uploads left behind: a row that is still pending long after any upload could be
   * running (a crash), and a discarded row whose file could not be removed at the time. Returns how many it
   * cleared; one that fails stays for the next pass.
   */
  async sweep(olderThan: Date): Promise<number> {
    let cleared = 0;
    for (const row of await this.repo.stale(olderThan)) {
      try {
        await this.storage.delete(row.key);
        await this.repo.remove(row.accountId, row._id);
        cleared += 1;
      } catch {
        // The next pass tries again.
      }
    }
    return cleared;
  }
}
