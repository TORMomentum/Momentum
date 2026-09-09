import { Client } from "minio";
import type { Storage, StorageMetadata, StoredObject } from "../ports/storage.port.js";

/**
 * A filename arrives from the client, so it cannot go into a header as-is: a
 * newline would let a caller inject headers of their own, and a non-ASCII byte
 * is not valid there. Thai filenames are common here, so they are percent-
 * encoded rather than dropped.
 */
function sanitiseHeader(value: string): string {
  return encodeURIComponent(value.replace(/[\r\n]/g, " ")).slice(0, 200);
}

export interface MinioSettings {
  endPoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  publicUrl: string;
}

export class MinioStorage implements Storage {
  private readonly client: Client;
  /** Signing client bound to the browser-reachable origin (spec §5.8). */
  private readonly publicClient: Client;

  constructor(private readonly settings: MinioSettings) {
    this.client = new Client({
      endPoint: settings.endPoint,
      port: settings.port,
      useSSL: false,
      accessKey: settings.accessKey,
      secretKey: settings.secretKey,
    });
    const publicUrl = new URL(settings.publicUrl);
    this.publicClient = new Client({
      endPoint: publicUrl.hostname,
      port: Number(publicUrl.port || (publicUrl.protocol === "https:" ? 443 : 80)),
      useSSL: publicUrl.protocol === "https:",
      accessKey: settings.accessKey,
      secretKey: settings.secretKey,
    });
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.settings.bucket);
    if (!exists) await this.client.makeBucket(this.settings.bucket);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.statObject(this.settings.bucket, key);
      return true;
    } catch {
      return false;
    }
  }

  /** FR-A-2: an existing object is returned untouched, never replaced. */
  async putIfAbsent(
    key: string,
    bytes: Buffer,
    contentType: string,
    metadata: StorageMetadata = {},
  ): Promise<StoredObject> {
    const existing = await this.head(key);
    if (existing) return existing;
    await this.client.putObject(this.settings.bucket, key, bytes, bytes.byteLength, {
      "Content-Type": contentType,
      // x-amz-meta-* is what an operator sees beside the object. The key itself
      // is a hash by design, so this is where the human-readable trace lives.
      ...(metadata.originalFilename
        ? { "x-amz-meta-original-filename": sanitiseHeader(metadata.originalFilename) }
        : {}),
      ...(metadata.route ? { "x-amz-meta-route": metadata.route } : {}),
    });
    return { bucket: this.settings.bucket, key, contentType, bytes: bytes.byteLength };
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    return this.client.getObject(this.settings.bucket, key);
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    return this.publicClient.presignedGetObject(this.settings.bucket, key, ttlSeconds);
  }

  private async head(key: string): Promise<StoredObject | null> {
    try {
      const stat = await this.client.statObject(this.settings.bucket, key);
      return {
        bucket: this.settings.bucket,
        key,
        contentType: String(stat.metaData?.["content-type"] ?? "application/octet-stream"),
        bytes: stat.size,
      };
    } catch {
      return null;
    }
  }
}
