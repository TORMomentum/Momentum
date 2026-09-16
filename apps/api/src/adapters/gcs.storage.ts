import { createHash } from "node:crypto";
import { Storage as GcsClient, type File } from "@google-cloud/storage";
import { NotFoundError, ServiceUnavailableError } from "../core/errors.js";
import { encodeMetadataValue } from "../lib/metadata-header.js";
import type { Storage, StorageMetadata, StoredObject } from "../ports/storage.port.js";

export interface GcsSettings {
  bucket: string;
  apiEndpoint?: string;
  /** The dedicated storage account's key. Always passed explicitly — see config.ts. */
  keyFilename?: string;
  projectId?: string;
  timeoutMs: number;
}

const PRECONDITION_FAILED = 412;
const NOT_FOUND = 404;

function statusOf(error: unknown): number | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

/**
 * Originals on Google Cloud Storage (spec §4).
 *
 * The application's identity may create and read objects and nothing else, so
 * this adapter never deletes — not even to recover from a bad upload. That is
 * why integrity is checked BY THE SERVICE: the MD5 travels with the upload and
 * a mismatch is refused with 400 before any object exists. The client's own
 * post-upload validation stays off, because on a mismatch it deletes.
 */
export class GcsStorage implements Storage {
  private readonly client: GcsClient;

  constructor(private readonly settings: GcsSettings) {
    this.client = new GcsClient({
      ...(settings.apiEndpoint ? { apiEndpoint: settings.apiEndpoint } : {}),
      ...(settings.keyFilename ? { keyFilename: settings.keyFilename } : {}),
      ...(settings.projectId ? { projectId: settings.projectId } : {}),
      retryOptions: {
        autoRetry: true,
        // @google-cloud/storage's RetryOptions.totalTimeout is in SECONDS (its
        // default is 600) — unlike gaxios's field of the same name. Confirm in
        // the installed build/cjs/src/storage.d.ts before trusting this.
        totalTimeout: Math.ceil(settings.timeoutMs / 1000),
      },
    });
  }

  private file(key: string): File {
    return this.client.bucket(this.settings.bucket).file(key);
  }

  async putIfAbsent(
    key: string,
    bytes: Buffer,
    contentType: string,
    metadata: StorageMetadata = {},
  ): Promise<StoredObject> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const md5Hash = createHash("md5").update(bytes).digest("base64");

    try {
      await this.file(key).save(bytes, {
        resumable: false,
        validation: false,
        // Conditionally idempotent: a retry cannot create a second object.
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType,
          md5Hash,
          metadata: {
            sha256,
            ...(metadata.originalFilename
              ? { originalFilename: encodeMetadataValue(metadata.originalFilename) }
              : {}),
            ...(metadata.route ? { route: metadata.route } : {}),
          },
        },
      });
      return { bucket: this.settings.bucket, key, contentType, bytes: bytes.byteLength };
    } catch (error) {
      if (statusOf(error) !== PRECONDITION_FAILED) throw this.translate(error);
      return this.existingWithSameContent(key, sha256);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const [found] = await this.file(key).exists();
      return found;
    } catch (error) {
      // exists() already answers false for a 404. Anything that reaches here —
      // a 403, a timeout, a 5xx — is NOT evidence of absence.
      throw this.translate(error);
    }
  }

  async getStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<NodeJS.ReadableStream> {
    const stream = this.file(key).createReadStream(
      range ? { start: range.start, end: range.end, validation: false } : { validation: false },
    );

    // createReadStream returns at once and reports a missing object or a
    // transport failure LATER, as an 'error' event. Resolving only once storage
    // has answered means a 404 or 503 still maps to a status BEFORE any response
    // header is sent (spec §5.5). A separate exists() first would leave a
    // check-then-use gap.
    return new Promise((resolve, reject) => {
      const onError = (error: unknown) => {
        stream.off("response", onResponse);
        reject(statusOf(error) === NOT_FOUND ? new NotFoundError(`object ${key} not found`) : this.translate(error));
      };
      const onResponse = (res: { statusCode?: number }) => {
        // 'response' fires for every HTTP response, success or failure — it only
        // means headers arrived. A 404/5xx is still followed, asynchronously, by
        // an 'error' event once the client reads the error body and destroys the
        // stream. Resolving here for an error status would hand back a stream
        // that is about to be destroyed out from under its reader, and detaching
        // the error listener would drop that destroy event entirely.
        if (res.statusCode !== undefined && res.statusCode >= 400) return;
        stream.off("error", onError);
        resolve(stream);
      };
      stream.once("error", onError);
      stream.once("response", onResponse);
      // The underlying request is made lazily, the first time something pulls
      // from the stream (PassThroughShim._read -> 'reading' -> the request).
      // Nothing has started reading yet — only 'response'/'error' listeners are
      // attached above — so without this the promise never settles. read(0) is
      // the standard no-op pull: it triggers _read() without consuming bytes.
      stream.read(0);
    });
  }

  private async existingWithSameContent(key: string, sha256: string): Promise<StoredObject> {
    let meta;
    try {
      [meta] = await this.file(key).getMetadata();
    } catch (error) {
      if (statusOf(error) === NOT_FOUND) {
        throw new Error(`object ${key} answered 412 and then was not found`);
      }
      throw this.translate(error);
    }
    if (meta.metadata?.sha256 !== sha256) {
      throw new Error(`object ${key} exists with different content (sha256 mismatch)`);
    }
    return {
      bucket: this.settings.bucket,
      key,
      contentType: String(meta.contentType ?? "application/octet-stream"),
      bytes: Number(meta.size),
    };
  }

  private translate(error: unknown): Error {
    const status = statusOf(error);
    if (status === undefined || status >= 500) return new ServiceUnavailableError("object storage unavailable");
    return error instanceof Error ? error : new Error(String(error));
  }
}
