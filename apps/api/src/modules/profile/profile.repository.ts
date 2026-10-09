import type { Db } from "mongodb";
import { vendorProfiles, type VendorProfileDocument } from "../../core/db.js";

export type VendorProfileInput = Omit<VendorProfileDocument, "accountId" | "updatedAt" | "updatedBy">;

/** The profile feature's only Mongo boundary. */
export class ProfileRepository {
  constructor(private readonly db: Db) {}

  async findByAccountId(accountId: string): Promise<VendorProfileDocument | null> {
    return vendorProfiles(this.db).findOne({ accountId });
  }

  async replace(accountId: string, input: VendorProfileInput, updatedBy: "vendor" | "admin" = "vendor"): Promise<VendorProfileDocument> {
    const updatedAt = new Date();
    await vendorProfiles(this.db).updateOne(
      { accountId },
      { $set: { ...input, updatedAt, updatedBy }, $setOnInsert: { accountId } },
      { upsert: true },
    );
    return { accountId, ...input, updatedAt, updatedBy };
  }
}
