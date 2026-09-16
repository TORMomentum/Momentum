import type { Request, Response } from "express";
import { pipeline } from "node:stream/promises";
import { NotFoundError } from "../core/errors.js";
import { parseRange } from "./byte-range.js";
import { contentDisposition, type Disposition } from "./content-disposition.js";

export interface StreamableDocument {
  key: string;
  contentType: string;
  bytes: number;
  filename: string;
}

interface ReadableStore {
  exists(key: string): Promise<boolean>;
  getStream(key: string, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream>;
}

/**
 * The single delivery contract for an original document (spec §5.3–5.5).
 *
 * Order matters. Everything that can fail with a status — a missing object, an
 * unavailable store — happens BEFORE a document header is set, so the error
 * middleware can still answer 404 or 503 cleanly. Once bytes start flowing the
 * status is committed, and a failure can only end the transfer.
 */
export async function streamDocument(
  req: Request,
  res: Response,
  store: ReadableStore,
  doc: StreamableDocument,
  disposition: Disposition,
): Promise<void> {
  const range = parseRange(req.headers.range, doc.bytes);

  if (range.kind === "unsatisfiable") {
    res.status(416).set({
      "Content-Range": `bytes */${doc.bytes}`,
      "Cache-Control": "private, no-store",
    });
    res.end();
    return;
  }

  const partial = range.kind === "partial" ? { start: range.start, end: range.end } : undefined;

  let source: NodeJS.ReadableStream | undefined;
  if (req.method === "HEAD" || doc.bytes === 0) {
    // No body to stream, but a missing object must still answer 404.
    if (!(await store.exists(doc.key))) throw new NotFoundError();
  } else {
    source = await store.getStream(doc.key, partial);
  }

  const length = partial ? partial.end - partial.start + 1 : doc.bytes;
  res.status(partial ? 206 : 200).set({
    "Content-Type": doc.contentType,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": contentDisposition(disposition, doc.filename),
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "Content-Length": String(length),
    ...(partial ? { "Content-Range": `bytes ${partial.start}-${partial.end}/${doc.bytes}` } : {}),
  });

  if (!source) {
    res.end();
    return;
  }

  try {
    // pipeline respects backpressure and destroys the storage stream when the
    // client disconnects, so an abandoned download stops reading storage.
    await pipeline(source, res);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ERR_STREAM_PREMATURE_CLOSE") {
      console.error(JSON.stringify({ event: "document_stream_failed", key: doc.key, error: String(error) }));
    }
    res.destroy();
  }
}
