import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Job, Queue } from "../ports/queue.port.js";
import { loadConfig } from "../core/config.js";
import { extractionBlocker, runCycle, runOnce } from "./extract.worker.js";

/** A queue with one claimable job, then nothing. */
function oneJobQueue(job: Job, failResult: { willRetry: boolean }) {
  let claimed = false;
  return {
    enqueue: vi.fn(async () => {}),
    claim: vi.fn(async () => {
      if (claimed) return null;
      claimed = true;
      return job;
    }),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => failResult),
    abandon: vi.fn(async () => {}),
  } satisfies Queue;
}

const job: Job = { id: "job-1", torId: "tor-1", type: "extract", attempts: 0 };

function transitions() {
  return {
    onExtracting: vi.fn(async () => {}),
    onPublished: vi.fn(async () => {}),
    onFailed: vi.fn(async () => {}),
  };
}

describe("runOnce", () => {
  it("returns idle and does nothing when no job is due", async () => {
    const queue = oneJobQueue(job, { willRetry: true });
    queue.claim = vi.fn(async () => null);
    const t = transitions();

    const result = await runOnce({ queue, handle: vi.fn(async () => {}), ...t });

    expect(result).toBe("idle");
    expect(t.onExtracting).not.toHaveBeenCalled();
  });

  it("marks extracting, runs the handler, marks published, completes the job", async () => {
    const queue = oneJobQueue(job, { willRetry: true });
    const handle = vi.fn(async () => {});
    const t = transitions();

    const result = await runOnce({ queue, handle, ...t });

    expect(result).toBe("published");
    expect(t.onExtracting).toHaveBeenCalledWith("tor-1");
    expect(handle).toHaveBeenCalledWith("tor-1");
    expect(t.onPublished).toHaveBeenCalledWith("tor-1");
    expect(queue.complete).toHaveBeenCalledWith("job-1");
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("on a handler failure that will retry: fails the job, leaves the record for another attempt", async () => {
    const queue = oneJobQueue(job, { willRetry: true });
    const handle = vi.fn(async () => {
      throw new Error("vertex timeout");
    });
    const t = transitions();

    const result = await runOnce({ queue, handle, ...t });

    expect(result).toBe("retry");
    expect(queue.fail).toHaveBeenCalledWith("job-1", "vertex timeout");
    expect(t.onFailed).not.toHaveBeenCalled();
    expect(t.onPublished).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("on a handler failure with attempts exhausted: marks the record failed with the reason (NFR-S5)", async () => {
    const queue = oneJobQueue(job, { willRetry: false });
    const handle = vi.fn(async () => {
      throw new Error("unreadable document");
    });
    const t = transitions();

    const result = await runOnce({ queue, handle, ...t });

    expect(result).toBe("failed");
    expect(queue.fail).toHaveBeenCalledWith("job-1", "unreadable document");
    expect(t.onFailed).toHaveBeenCalledWith("tor-1", "unreadable document");
  });

  it("a terminal error abandons the job immediately, without a retry", async () => {
    const queue = oneJobQueue(job, { willRetry: true });
    const handle = vi.fn(async () => {
      throw Object.assign(new Error("no title, no agency"), { retryable: false });
    });
    const t = transitions();

    const result = await runOnce({ queue, handle, ...t });

    expect(result).toBe("failed");
    expect(queue.abandon).toHaveBeenCalledWith("job-1", "no title, no agency");
    expect(queue.fail).not.toHaveBeenCalled();
    expect(t.onFailed).toHaveBeenCalledWith("tor-1", "no title, no agency");
  });
});

describe("when extraction cannot run", () => {
  const config = (vertex: { project?: string; credentialsPath?: string }) => ({ ...loadConfig({ ...process.env, GOOGLE_CLOUD_PROJECT: vertex.project ?? "", GOOGLE_APPLICATION_CREDENTIALS: vertex.credentialsPath ?? "" }) });

  it("names what is missing, including a credential path that points at no file", () => {
    expect(extractionBlocker(config({}))).toContain("GOOGLE_CLOUD_PROJECT");
    expect(extractionBlocker(config({ project: "p" }))).toContain("GOOGLE_APPLICATION_CREDENTIALS");
    expect(extractionBlocker(config({ project: "p", credentialsPath: "no/such/credential.json" }))).toContain("does not exist");
    expect(extractionBlocker(config({ project: "p", credentialsPath: fileURLToPath(import.meta.url) }))).toBeNull();
  });

  it("claims nothing, so no record is published without being read", async () => {
    const queue = oneJobQueue(job, { willRetry: true });
    const t = transitions();

    const result = await runCycle({ queue, ...t }, null);

    expect(result).toBe("idle");
    expect(queue.claim).not.toHaveBeenCalled();
    expect(t.onPublished).not.toHaveBeenCalled();
  });

  it("runs the job when there is a handler", async () => {
    const queue = oneJobQueue(job, { willRetry: true });
    expect(await runCycle({ queue, ...transitions() }, vi.fn(async () => {}))).toBe("published");
  });
});
