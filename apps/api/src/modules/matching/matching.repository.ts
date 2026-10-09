import { ObjectId, type Db, type WithId } from "mongodb";
import { WORK_CATEGORY_LEAVES } from "@tor-radar/seeds";
import { torClassifications, tors, type TorDocument, type VendorProfileDocument } from "../../core/db.js";
import type { Config } from "../../core/config.js";
import { CURRENT_MAPPER_VERSION, classifyTor, type TorClassification } from "./tor-classifier.js";

export type ClassifiedCandidate = { record: WithId<TorDocument>; classification: TorClassification };

function coarseCategories(profile: VendorProfileDocument): string[] {
  const selected = new Set(profile.categories);
  return [...new Set(WORK_CATEGORY_LEAVES.filter((leaf) => selected.has(leaf.id) || selected.has(leaf.groupId)).flatMap((leaf) => leaf.torCategories))];
}

/**
 * The leaves a vendor's choices cover. Choosing a group covers every leaf in it,
 * because a TOR is classified to leaves, never to groups.
 */
function chosenLeafAndGroupIds(profile: VendorProfileDocument): { leaves: string[]; length: number } {
  const selected = new Set(profile.categories);
  const leaves = WORK_CATEGORY_LEAVES.filter((leaf) => selected.has(leaf.id) || selected.has(leaf.groupId)).map(
    (leaf) => leaf.id,
  );
  return { leaves, length: leaves.length };
}

function titleClauses(entries: string[]): Record<string, unknown>[] {
  return entries.flatMap((entry) => {
    const terms = [entry.trim(), ...entry.split(/[\s,;/|]+/u).filter((part) => part.length > 1)].filter(Boolean);
    return terms.flatMap((term) => [{ "fields.title.value": { $regex: term, $options: "i" } }, { "fields.title.raw": { $regex: term, $options: "i" } }]);
  });
}

/** Mongo boundary for matching. The cache is separate so classification never changes a TOR. */
export class MatchingRepository {
  constructor(private readonly db: Db, private readonly config: Config) {}

  async storeClassification(torId: string, classification: TorClassification): Promise<void> {
    await torClassifications(this.db).updateOne({ torId }, { $set: { classification, mapperVersion: classification.mapperVersion, updatedAt: new Date() } }, { upsert: true });
  }

  async classifyAndStore(record: WithId<TorDocument>): Promise<TorClassification> {
    const classification = classifyTor(record, this.config);
    await this.storeClassification(record._id.toString(), classification);
    return classification;
  }

  /**
   * Classify every TOR that has no classification under the current mapper.
   *
   * Candidates are looked up in the classification cache, and the cache was only
   * ever filled for records that were ALREADY candidates — so a corpus nobody had
   * classified matched nothing at all, while every test passed against a cache it
   * had filled itself. It also cannot lean on the stored category being on the
   * national list: records extracted before that list existed still hold the
   * older wording, and matching must not depend on a migration having been run.
   * The classifier normalises from the raw text, so this covers both.
   */
  async ensureClassified(): Promise<number> {
    const current = await torClassifications(this.db)
      .find({ mapperVersion: CURRENT_MAPPER_VERSION }, { projection: { torId: 1 } })
      .toArray();
    const done = current
      .map((entry) => entry.torId)
      .filter(ObjectId.isValid)
      .map((id) => new ObjectId(id));
    const pending = await tors(this.db)
      .find({ _id: { $nin: done } }, { limit: this.config.matching.classifyBatch })
      .toArray();
    for (const record of pending) await this.classifyAndStore(record);
    return pending.length;
  }

  async candidatesFor(profile: VendorProfileDocument): Promise<ClassifiedCandidate[]> {
    const categories = coarseCategories(profile);
    const freeText = profile.otherCategories ?? [];
    if (categories.length === 0 && freeText.length === 0) return [];
    await this.ensureClassified();
    // Precise before broad. Some national categories are catch-alls — จ้างเหมาบริการ
    // holds twenty-six kinds of work — so a vendor's coarse set can be mostly
    // other people's jobs. Filling the cap by recency alone let that noise push
    // the vendor's own kind of work out before it was ever scored. Records with
    // leaf evidence for what the vendor chose are taken first; the coarse-only
    // ones fill whatever room is left.
    const chosen = chosenLeafAndGroupIds(profile);
    const cap = this.config.matching.candidateCap;
    const precise = chosen.length
      ? await torClassifications(this.db)
          .find(
            { "classification.coarse": { $in: categories }, "classification.leaves.id": { $in: chosen.leaves } },
            { sort: { updatedAt: -1 }, limit: cap },
          )
          .toArray()
      : [];
    const preciseIds = precise.map((entry) => entry.torId);
    const broad =
      precise.length < cap
        ? await torClassifications(this.db)
            .find(
              { "classification.coarse": { $in: categories }, torId: { $nin: preciseIds } },
              { sort: { updatedAt: -1 }, limit: cap - precise.length },
            )
            .toArray()
        : [];
    const cached = [...precise, ...broad];
    // Free text reaches past the taxonomy, so it is still matched against the
    // records themselves rather than against the cache.
    const clauses: Record<string, unknown>[] = [];
    clauses.push(...titleClauses(freeText));
    const direct = clauses.length ? await tors(this.db).find({ $or: clauses }, { sort: { updatedAt: -1 }, limit: this.config.matching.candidateCap }).toArray() : [];
    const ids = new Set(cached.map((entry) => entry.torId));
    const records = new Map<string, WithId<TorDocument>>(direct.map((record) => [record._id.toString(), record]));
    const cachedRecords = await tors(this.db).find({ _id: { $in: [...ids].filter(ObjectId.isValid).map((id) => new ObjectId(id)) } }).toArray();
    for (const record of cachedRecords) records.set(record._id.toString(), record);
    const cacheById = new Map(cached.map((entry) => [entry.torId, entry]));
    const candidates: ClassifiedCandidate[] = [];
    for (const record of records.values()) {
      const cachedEntry = cacheById.get(record._id.toString());
      const classification = cachedEntry?.mapperVersion === CURRENT_MAPPER_VERSION ? cachedEntry.classification : await this.classifyAndStore(record);
      // A title free-text hit is intentionally allowed outside the taxonomy's
      // coarse set. Other candidates must still agree with the profile crosswalk.
      const freeTextHit = titleClauses(freeText).length > 0 && freeText.some((entry) => [record.fields.title?.value, record.fields.title?.raw].some((title) => typeof title === "string" && title.toLocaleLowerCase("th-TH").includes(entry.trim().toLocaleLowerCase("th-TH"))));
      if ((classification.coarse && categories.includes(classification.coarse)) || freeTextHit) candidates.push({ record, classification });
      if (candidates.length >= this.config.matching.candidateCap) break;
    }
    return candidates;
  }
}
