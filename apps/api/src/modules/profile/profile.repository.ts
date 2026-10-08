import type { Db } from "mongodb";
import { vendorProfiles, type PastProject, type VendorCertifications, type VendorProfileDocument } from "../../core/db.js";

export type VendorProfileInput = Omit<VendorProfileDocument, "accountId" | "updatedAt" | "updatedBy" | "pastProjects" | "certifications">;
export type VendorProfileExtras = { pastProjects: PastProject[]; certifications: VendorCertifications };

/** The profile feature's only Mongo boundary. */
export class ProfileRepository {
  constructor(private readonly db: Db) {}

  async findByAccountId(accountId: string): Promise<VendorProfileDocument | null> {
    return vendorProfiles(this.db).findOne({ accountId });
  }

  async replace(accountId: string, input: VendorProfileInput, updatedBy: "vendor" | "admin" = "vendor"): Promise<VendorProfileDocument> {
    const updatedAt = new Date();
    // The stored document, not the input echoed back: past work and
    // certifications are saved separately and must survive this write.
    const stored = await vendorProfiles(this.db).findOneAndUpdate(
      { accountId },
      { $set: { ...input, updatedAt, updatedBy }, $setOnInsert: { accountId } },
      { upsert: true, returnDocument: "after" },
    );
    return stored ?? { accountId, ...input, updatedAt, updatedBy };
  }

  /**
   * Past work and certifications only. Saved on their own so the main form —
   * and the admin screen, which reuses its schema — can never overwrite them.
   * A vendor with no profile yet gets the same empty defaults the screen shows.
   */
  async saveExtras(accountId: string, extras: VendorProfileExtras, defaults: VendorProfileInput): Promise<VendorProfileDocument> {
    const updatedAt = new Date();
    const stored = await vendorProfiles(this.db).findOneAndUpdate(
      { accountId },
      { $set: { ...extras, updatedAt, updatedBy: "vendor" }, $setOnInsert: { accountId, ...defaults } },
      { upsert: true, returnDocument: "after" },
    );
    return stored ?? { accountId, ...defaults, ...extras, updatedAt, updatedBy: "vendor" };
  }
}
