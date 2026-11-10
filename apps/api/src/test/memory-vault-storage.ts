import { Readable } from "node:stream";
import { NotFoundError } from "../core/errors.js";
import type { StoredObject } from "../ports/storage.port.js";
import type { VaultStorage } from "../ports/vault-storage.port.js";

/** An in-memory vault bucket for tests, with switches to make storage fail. */
export class MemoryVaultStorage implements VaultStorage {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
  failPut = false;
  failDelete = false;

  async putIfAbsent(key: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
    if (this.failPut) throw new Error("storage down");
    if (this.objects.has(key)) throw new Error("exists");
    this.objects.set(key, { bytes, contentType });
    return { bucket: "memory", key, contentType, bytes: bytes.byteLength };
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  async getStream(key: string, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream> {
    const found = this.objects.get(key);
    if (!found) throw new NotFoundError();
    return Readable.from(range ? found.bytes.subarray(range.start, range.end + 1) : found.bytes);
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error("storage down");
    this.objects.delete(key);
  }
}
