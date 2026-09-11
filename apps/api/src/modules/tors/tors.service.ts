import { NotFoundError } from "../../core/errors.js";
import type { Storage } from "../../ports/storage.port.js";
import type { TorsRepository } from "./tors.repository.js";

export interface TorsServiceDeps {
  repo: TorsRepository;
  storage: Storage;
  signedUrlTtlSeconds: number;
}

/** Public reads for published TOR records. */
export class TorsService {
  constructor(private readonly deps: TorsServiceDeps) {}

  async document(id: string) {
    const record = await this.deps.repo.loadDocument(id);

    // A restricted record deliberately looks absent. Returning 403 would
    // confirm both that the record exists and that it was taken down (FR-B-6).
    if (!record || record.restricted) throw new NotFoundError();

    // The storage key is trusted only because it came from the loaded record;
    // callers cannot choose another object in the bucket to sign.
    const url = await this.deps.storage.signedUrl(
      record.storage.key,
      this.deps.signedUrlTtlSeconds,
    );

    return {
      url,
      expiresInSeconds: this.deps.signedUrlTtlSeconds,
      contentType: record.storage.contentType,
      bytes: record.storage.bytes,
    };
  }
}
