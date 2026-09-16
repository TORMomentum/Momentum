import { NotFoundError } from "../../core/errors.js";
import { extensionFor } from "../../lib/content-disposition.js";
import type { StreamableDocument } from "../../lib/stream-document.js";
import type { TorsRepository } from "./tors.repository.js";

export interface TorsServiceDeps {
  repo: TorsRepository;
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
}
