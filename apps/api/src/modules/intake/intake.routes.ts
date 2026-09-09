import { Router, type Request } from "express";
import busboy from "busboy";
import rateLimit from "express-rate-limit";
import { urlIntakeSchema } from "@tor-radar/shared";
import { requireKey } from "./intake.auth.js";
import { safeFetchDocument } from "../../lib/safe-fetch.js";
import { BadRequestError, PayloadTooLargeError } from "../../core/errors.js";
import type { IntakeService } from "./intake.service.js";

const RATE_LIMIT_WINDOW_MS = 60_000;

/** The parsed part: the bytes, and what the submitter called them. */
interface UploadedFile {
  bytes: Buffer;
  filename?: string;
}

export interface IntakeRouterDeps {
  service: IntakeService;
  adminKeys: string[];
  intakeKeys: string[];
  maxUploadBytes: number;
  multipartMaxFiles: number;
  multipartMaxFieldBytes: number;
  fetchLimits: { timeoutMs: number; maxRedirects: number; maxBytes: number };
  rateLimitPerMinute: number;
}

/**
 * Reads one multipart file, aborting the moment it exceeds the limit.
 *
 * Buffering is deliberate rather than lazy: the storage key IS the content
 * hash, so the key cannot be known until every byte has been read. Streaming
 * straight to storage would mean writing under a temporary key and copying
 * afterwards. `MAX_UPLOAD_BYTES` bounds what a caller can hold in memory.
 */
function readSingleFile(req: Request, deps: IntakeRouterDeps): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const parser = busboy({
      headers: req.headers,
      // busboy decodes multipart parameter values as latin1 by default, which
      // turns every Thai filename into mojibake. The documents this system
      // ingests are Thai, so UTF-8 is the only sensible default here.
      defParamCharset: "utf8",
      limits: {
        files: deps.multipartMaxFiles,
        fileSize: deps.maxUploadBytes,
        fieldSize: deps.multipartMaxFieldBytes,
      },
    });

    const chunks: Buffer[] = [];
    let received = false;
    let settled = false;
    let filename: string | undefined;

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    parser.on("file", (_name, stream, info) => {
      received = true;
      filename = info.filename;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () =>
        fail(new PayloadTooLargeError("Document exceeds the maximum accepted size")),
      );
      stream.on("error", (error: Error) => fail(error));
    });

    parser.on("filesLimit", () => fail(new BadRequestError("Only one file may be submitted")));
    parser.on("error", (error) => fail(error as Error));

    parser.on("close", () => {
      if (settled) return;
      if (!received) {
        fail(new BadRequestError("No file was submitted"));
        return;
      }
      settled = true;
      resolve({ bytes: Buffer.concat(chunks), filename });
    });

    req.pipe(parser);
  });
}

export function buildIntakeRouter(deps: IntakeRouterDeps): Router {
  const router = Router();

  router.use(
    rateLimit({
      windowMs: RATE_LIMIT_WINDOW_MS,
      limit: deps.rateLimitPerMinute,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  // A repeat submission is not new work, so it answers 200 rather than 202.
  const statusFor = (result: { duplicate: boolean }) => (result.duplicate ? 200 : 202);

  router.post("/upload", requireKey(deps.adminKeys, "admin"), async (req, res) => {
    const file = await readSingleFile(req, deps);
    const result = await deps.service.submit(file.bytes, {
      route: "upload",
      submittedBy: "admin",
      filename: file.filename,
    });
    res.status(statusFor(result)).json(result);
  });

  router.post("/url", requireKey(deps.adminKeys, "admin"), async (req, res) => {
    const { url } = urlIntakeSchema.parse(req.body);
    const fetched = await safeFetchDocument(url, deps.fetchLimits);
    const result = await deps.service.submit(fetched.bytes, {
      route: "url",
      url: fetched.finalUrl,
      submittedBy: "admin",
      // The last path segment of the fetched URL is the closest thing to a name.
      filename: decodeURIComponent(new URL(fetched.finalUrl).pathname.split("/").pop() ?? ""),
    });
    res.status(statusFor(result)).json(result);
  });

  router.post("/", requireKey(deps.intakeKeys, "api"), async (req, res) => {
    const file = await readSingleFile(req, deps);
    const result = await deps.service.submit(file.bytes, {
      route: "api",
      submittedBy: "api",
      filename: file.filename,
    });
    res.status(statusFor(result)).json(result);
  });

  return router;
}
