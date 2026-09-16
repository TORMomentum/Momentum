import { NotFoundError } from "../../core/errors.js";
import { extensionFor } from "../../lib/content-disposition.js";
import type { StreamableDocument } from "../../lib/stream-document.js";
import type { TorsRepository } from "./tors.repository.js";
import type { Config } from "../../core/config.js";
import type { Filter } from "mongodb";
import type { TorDocument } from "../../core/db.js";
import { redactTor } from "../../lib/redact.js";
import { eligibilityOf } from "../stats/eligibility.js";
import { verdictFor } from "../stats/anomaly.rule.js";
import type { PeerBounds } from "../stats/anomaly.rule.js";

export interface TorsServiceDeps {
  repo: TorsRepository;
  config: Config;
}

/** Public reads for published TOR records. */
export class TorsService {
  constructor(private readonly deps: TorsServiceDeps) {}

  /** What to stream for a public request. A restricted record deliberately looks absent (FR-B-6). */
  async documentToStream(id: string): Promise<StreamableDocument> {
    const record = await this.deps.repo.loadDocument(id);
    if (!record || record.restricted) throw new NotFoundError();
    return {
      key: record.storage.key,
      contentType: record.storage.contentType,
      bytes: record.storage.bytes,
      filename: record.filename ?? `tor-${id}${extensionFor(record.storage.contentType)}`,
    };
  }

  async list(filter: Filter<TorDocument>, page: number, pageSize: number) {
    const { records, total } = await this.deps.repo.list(filter, page, pageSize);
    const keys = records.flatMap((record) => record.cohort ? [record.cohort] : []);
    // The bounds query is deliberately after pagination: the list never pays
    // for peer groups that cannot appear on its current page.
    const bounds = await this.deps.repo.boundsFor(keys);
    const byKey = new Map(bounds.map((bound) => [`${bound.category}\u0000${bound.month}`, bound]));
    return {
      items: records.map((record) => {
        const budget = record.fields.budget?.value;
        const reason = eligibilityOf(record as never, this.deps.config);
        const stored = record.cohort ? byKey.get(`${record.cohort.category}\u0000${record.cohort.month}`) : undefined;
        const bounds: PeerBounds | null = stored?.n === undefined ? null : stored as PeerBounds;
        const verdict = typeof budget === "number"
          ? verdictFor(reason ? { budget, eligible: false, reason } : { budget, eligible: true }, bounds, {
            method: this.deps.config.stats.method, minN: this.deps.config.stats.peerMinN,
            iqrMultiplier: this.deps.config.stats.iqrMultiplier, zScoreLimit: this.deps.config.stats.zScoreLimit,
          })
          : verdictFor({ budget: 0, eligible: false, reason: "no-budget" }, bounds, {
            method: this.deps.config.stats.method, minN: this.deps.config.stats.peerMinN,
            iqrMultiplier: this.deps.config.stats.iqrMultiplier, zScoreLimit: this.deps.config.stats.zScoreLimit,
          });
        const publicRecord = redactTor({ fields: record.fields }, "public");
        return { id: record._id.toString(), fields: publicRecord.fields, announcedAt: record.announcedAt, sourceUrl: record.sourceUrl, createdAt: record.createdAt, verdict };
      }), total, page, pageSize,
    };
  }
}
