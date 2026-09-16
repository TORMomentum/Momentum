import { describe, expect, it, vi } from "vitest";
import { IntakeService } from "./intake.service.js";
import type { Storage, StoredObject } from "../../ports/storage.port.js";
import type { Queue } from "../../ports/queue.port.js";
import type { IntakeRepository } from "./intake.repository.js";

const pdf = Buffer.from("%PDF-1.7 body");
const limits = { allowedMimeTypes: ["application/pdf"], maxUploadBytes: 1_000 };
const source = { route: "upload" as const, submittedBy: "admin" };

/**
 * Ports replaced with fakes, so this suite needs no database and no object
 * store: it tests the service's rules, not the adapters underneath it.
 */
function fakes() {
  const objects = new Map<string, StoredObject>();
  const storage: Storage = {
    async putIfAbsent(key, bytes, contentType) {
      const existing = objects.get(key);
      if (existing) return existing;
      const stored = { bucket: "tor-raw", key, contentType, bytes: bytes.byteLength };
      objects.set(key, stored);
      return stored;
    },
    async exists(key) {
      return objects.has(key);
    },
    async getStream() {
      throw new Error("not used in this suite");
    },
    async signedUrl(key) {
      return `http://localhost:9010/${key}`;
    },
  };

  const enqueued: string[] = [];
  const queue: Queue = {
    async enqueue(torId) {
      enqueued.push(torId);
    },
    async claim() {
      return null;
    },
    async complete() {},
    async fail() {
      return { willRetry: false };
    },
    async abandon() {},
  };

  const records = new Map<string, { id: string; hash: string }>();
  const sourceRefs: string[] = [];
  const insertedSources: unknown[] = [];
  const inserted: { id: string; knownFields?: Record<string, unknown> }[] = [];
  const repository = {
    async findByHash(hash: string) {
      const found = [...records.values()].find((record) => record.hash === hash);
      return found
        ? { id: found.id, contentHash: hash, pipeline: { state: "queued", attempts: 0 } }
        : null;
    },
    async insert(
      hash: string,
      _stored: StoredObject,
      source: unknown,
      knownFields?: Record<string, unknown>,
    ) {
      const id = `id-${records.size + 1}`;
      records.set(id, { id, hash });
      insertedSources.push(source);
      inserted.push({ id, knownFields });
      return id;
    },
    async appendSourceRef(id: string) {
      sourceRefs.push(id);
    },
  };

  return { storage, queue, repository, enqueued, objects, sourceRefs, inserted, insertedSources };
}

function serviceWith(overrides: Partial<typeof limits> = {}) {
  const parts = fakes();
  const service = new IntakeService(
    parts.storage,
    parts.queue,
    parts.repository as unknown as IntakeRepository,
    { ...limits, ...overrides },
  );
  return { ...parts, service };
}

describe("IntakeService.submit", () => {
  it("stores, records, and queues a new document", async () => {
    const { service, enqueued, objects } = serviceWith();

    const result = await service.submit(pdf, source);

    expect(result).toMatchObject({ duplicate: false, state: "queued" });
    expect(objects.size).toBe(1);
    expect(enqueued).toEqual([result.torId]);
  });

  it("stores the document under its content hash, not its filename", async () => {
    const { service, objects } = serviceWith();

    await service.submit(pdf, { ...source, filename: "แผนงาน ฉบับล่าสุด.pdf" });

    // Grouped by arrival month and given an extension so the bucket is
    // browsable, but the hash is still the identity — the submitted name
    // changes nothing about where the bytes land.
    const [key] = [...objects.keys()];
    expect(key).toMatch(/^tors\/\d{4}\/\d{2}\/[0-9a-f]{64}\.pdf$/);
  });

  it("converges a repeat submission on the existing record without re-queueing", async () => {
    const { service, enqueued, sourceRefs } = serviceWith();

    const first = await service.submit(pdf, source);
    const second = await service.submit(pdf, {
      route: "url",
      submittedBy: "admin",
      url: "https://example.org/a.pdf",
    });

    expect(second.duplicate).toBe(true);
    expect(second.torId).toBe(first.torId);
    expect(enqueued).toHaveLength(1);
    expect(sourceRefs).toEqual([first.torId]);
  });

  it("treats a duplicate-key race as a duplicate rather than an error", async () => {
    const { service, repository } = serviceWith();

    const first = await service.submit(pdf, source);
    // the loser of the race: findByHash saw nothing, then the index rejected it
    vi.spyOn(repository, "findByHash").mockResolvedValueOnce(null);
    vi.spyOn(repository, "insert").mockRejectedValueOnce({ code: 11000 });

    const second = await service.submit(pdf, source);

    expect(second.duplicate).toBe(true);
    expect(second.torId).toBe(first.torId);
  });

  it("rethrows an insert failure that is not a duplicate key", async () => {
    const { service, repository } = serviceWith();
    vi.spyOn(repository, "insert").mockRejectedValueOnce(new Error("connection lost"));

    await expect(service.submit(pdf, source)).rejects.toThrow(/connection lost/);
  });

  it("does not enqueue when the record could not be inserted", async () => {
    const { service, repository, enqueued } = serviceWith();
    vi.spyOn(repository, "insert").mockRejectedValueOnce(new Error("connection lost"));

    await service.submit(pdf, source).catch(() => undefined);

    expect(enqueued).toHaveLength(0);
  });

  it("rejects content whose bytes are not an accepted type", async () => {
    const { service } = serviceWith();

    await expect(service.submit(Buffer.from("<html>nope</html>"), source)).rejects.toThrow(/type/i);
  });

  it("stores nothing when the type is rejected", async () => {
    const { service, objects } = serviceWith();

    await service.submit(Buffer.from("<html>nope</html>"), source).catch(() => undefined);

    expect(objects.size).toBe(0);
  });

  it("rejects content larger than the configured limit", async () => {
    const { service } = serviceWith({ maxUploadBytes: 4 });

    await expect(service.submit(pdf, source)).rejects.toThrow(/size|large/i);
  });


  it("records fields the caller already knows, marked verified (FR-B-2)", async () => {
    const { service, inserted } = serviceWith();

    await service.submit(pdf, {
      route: "url",
      url: "https://egp2.bangkok.go.th/api/file/abc/tor.pdf",
      submittedBy: "admin",
      knownFields: {
        agency: { raw: "สำนักการแพทย์", value: "agency-1", confidence: 1, verified: true },
      },
    });

    expect(inserted[0].knownFields).toMatchObject({
      agency: { raw: "สำนักการแพทย์", confidence: 1, verified: true },
    });
  });

  it("ingests a plain upload unchanged, with nothing known up front", async () => {
    const { service, inserted } = serviceWith();

    const result = await service.submit(pdf, source);

    expect(result.duplicate).toBe(false);
    expect(inserted[0].knownFields).toBeUndefined();
  });

  it("records the submitted filename on the source reference", async () => {
    const { service, insertedSources } = serviceWith();

    await service.submit(pdf, { ...source, filename: "ประกาศจ้างเหมา.pdf" });

    expect(insertedSources[0]).toMatchObject({ originalFilename: "ประกาศจ้างเหมา.pdf" });
  });
});
