import { Readable } from "node:stream";
import express from "express";
import request, { type Response } from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorMiddleware, NotFoundError } from "../core/errors.js";
import { streamDocument } from "./stream-document.js";

// Includes bytes that are not valid UTF-8, so a text parser would corrupt them visibly.
const BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80, 0x0a, 0x39]);
const doc = { key: "tors/x.pdf", contentType: "application/pdf", bytes: BYTES.length, filename: "ประกาศ.pdf" };

// supertest's .parse() callback type is superagent's Response, not
// NodeJS.ReadableStream — but at runtime it IS one (Node's http.IncomingMessage,
// which superagent hands through as-is here), which is what makes .on("data"/"end")
// work below.
function binary(res: Response, callback: (error: Error | null, body: Buffer) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stream.on("end", () => callback(null, Buffer.concat(chunks)));
}

function appWith(storage: { exists: (k: string) => Promise<boolean>; getStream: (k: string, r?: { start: number; end: number }) => Promise<NodeJS.ReadableStream> }) {
  const app = express();
  const handler = async (req: express.Request, res: express.Response) => {
    await streamDocument(req, res, storage as never, doc, req.query.disposition === "inline" ? "inline" : "attachment");
  };
  // HEAD first: in Express 5 a GET route answers HEAD when no earlier HEAD route matches.
  app.head("/doc", handler);
  app.get("/doc", handler);
  app.use(errorMiddleware);
  return app;
}

function fakeStorage() {
  return {
    exists: vi.fn(async () => true),
    getStream: vi.fn(async (_k: string, r?: { start: number; end: number }) =>
      Readable.from([r ? BYTES.subarray(r.start, r.end + 1) : BYTES]),
    ),
  };
}

describe("streamDocument", () => {
  it("serves the whole object with every required header", async () => {
    const response = await request(appWith(fakeStorage())).get("/doc").buffer(true).parse(binary);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/pdf");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers["content-length"]).toBe("10");
    expect(response.headers["content-disposition"]).toContain("filename*=UTF-8''");
    expect(Buffer.from(response.body as Buffer)).toEqual(BYTES);
  });

  it("answers a range with 206 and Content-Range", async () => {
    const storage = fakeStorage();
    const response = await request(appWith(storage)).get("/doc").set("Range", "bytes=2-5").buffer(true).parse(binary);
    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 2-5/10");
    expect(response.headers["content-length"]).toBe("4");
    expect(response.body as Buffer).toEqual(BYTES.subarray(2, 6));
    expect(storage.getStream).toHaveBeenCalledWith("tors/x.pdf", { start: 2, end: 5 });
  });

  it("answers an unsatisfiable range with 416 and never opens the object", async () => {
    const storage = fakeStorage();
    const response = await request(appWith(storage)).get("/doc").set("Range", "bytes=50-60");
    expect(response.status).toBe(416);
    expect(response.headers["content-range"]).toBe("bytes */10");
    expect(storage.getStream).not.toHaveBeenCalled();
  });

  it("answers HEAD with the same headers, no body, and without opening a stream", async () => {
    const storage = fakeStorage();
    const response = await request(appWith(storage)).head("/doc");
    expect(response.status).toBe(200);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["content-length"]).toBe("10");
    expect(storage.getStream).not.toHaveBeenCalled();
    expect(storage.exists).toHaveBeenCalledWith("tors/x.pdf");
  });

  it("sends inline disposition when asked", async () => {
    const response = await request(appWith(fakeStorage())).get("/doc?disposition=inline");
    expect(response.headers["content-disposition"]).toBe("inline");
  });

  it("maps a missing object to 404 before sending document headers", async () => {
    const storage = fakeStorage();
    storage.getStream.mockRejectedValueOnce(new NotFoundError());
    const response = await request(appWith(storage)).get("/doc");
    expect(response.status).toBe(404);
    expect(response.headers["content-disposition"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBeUndefined();
  });

  it("checks existence for an empty object before claiming 200", async () => {
    const storage = fakeStorage();
    storage.exists.mockResolvedValueOnce(false);
    const app = express();
    app.get("/empty", async (req, res) => {
      await streamDocument(req, res, storage as never, { ...doc, bytes: 0 }, "attachment");
    });
    app.use(errorMiddleware);
    expect((await request(app).get("/empty")).status).toBe(404);
  });
});
