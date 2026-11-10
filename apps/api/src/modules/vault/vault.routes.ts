import { Router, type Request } from "express";
import busboy from "busboy";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CERTIFICATIONS } from "@tor-radar/seeds";
import type { Config } from "../../core/config.js";
import { VAULT_KINDS, type VaultDocument, type VaultKind } from "../../core/db.js";
import { AppError, BadRequestError, NotFoundError, PayloadTooLargeError, UnauthorizedError } from "../../core/errors.js";
import { requireSameOrigin } from "../../core/require-same-origin.js";
import { detectMimeType } from "../../lib/file-type.js";
import { sha256 } from "../../lib/hash.js";
import { streamDocument } from "../../lib/stream-document.js";
import type { VaultStorage } from "../../ports/vault-storage.port.js";
import { VaultRepository } from "./vault.repository.js";
import type { VaultService } from "./vault.service.js";

export interface VaultRouterDeps {
  config: Config;
  vault: VaultRepository;
  service: VaultService;
  storage: VaultStorage;
}

const certificationIds = new Set<string>(CERTIFICATIONS.map((item) => item.id));
const fieldsSchema = z.object({
  kind: z.enum(VAULT_KINDS),
  certificationId: z.string().optional(),
});
const FILENAME_MAX = 200;

interface Upload {
  bytes: Buffer;
  filename: string;
  fields: Record<string, string>;
}

/**
 * One file and its few text fields, read whole and refused the moment it passes the cap. Whole, not streamed:
 * the magic bytes are checked before anything is stored and the size is recorded.
 *
 * ponytail: a near copy of the intake parser (which takes no fields); share them if a third caller appears.
 */
function readUpload(req: Request, config: Config): Promise<Upload> {
  return new Promise((resolve, reject) => {
    const parser = busboy({
      headers: req.headers,
      defParamCharset: "utf8", // Thai filenames
      limits: { files: 1, fileSize: config.vault.maxFileBytes, fieldSize: config.multipartMaxFieldBytes, fields: 5 },
    });
    const chunks: Buffer[] = [];
    const fields: Record<string, string> = {};
    let filename: string | undefined;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    parser.on("field", (name, value) => {
      fields[name] = value;
    });
    parser.on("file", (_name, stream, info) => {
      filename = info.filename;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () => fail(new PayloadTooLargeError("ไฟล์ใหญ่เกินที่รับได้")));
      stream.on("error", (error: Error) => fail(error));
    });
    parser.on("filesLimit", () => fail(new BadRequestError("อัปโหลดได้ครั้งละหนึ่งไฟล์")));
    parser.on("error", (error) => fail(error as Error));
    parser.on("close", () => {
      if (settled) return;
      if (filename === undefined) {
        fail(new BadRequestError("ไม่ได้แนบไฟล์"));
        return;
      }
      settled = true;
      resolve({ bytes: Buffer.concat(chunks), filename, fields });
    });
    req.pipe(parser);
  });
}

/** The name the vendor gave it, without any directory part and kept short. Never rewritten beyond that. */
function cleanFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop()?.trim() ?? "";
  return (base || "document").slice(0, FILENAME_MAX);
}

function present(doc: VaultDocument) {
  return {
    id: doc._id.toString(),
    kind: doc.kind,
    ...(doc.certificationId ? { certificationId: doc.certificationId } : {}),
    filename: doc.filename,
    contentType: doc.contentType,
    bytes: doc.bytes,
    uploadedAt: doc.uploadedAt.toISOString(),
  };
}

/**
 * The vendor's own files, kept to reuse for every TOR (TOR-218). Everything here is the signed-in vendor's
 * own: another account's file answers 404, exactly like one that does not exist.
 */
export function buildVaultRouter(deps: VaultRouterDeps): Router {
  const router = Router();
  const write = requireSameOrigin(deps.config.appOrigin);
  const owner = (req: Request): string => {
    if (!req.auth) throw new UnauthorizedError();
    return req.auth.account._id.toString();
  };

  router.get("/me/vault", async (req, res) => {
    const docs = await deps.vault.list(owner(req));
    res.set("Cache-Control", "private, no-store").json({
      documents: docs.map(present),
      limits: { maxFileBytes: deps.config.vault.maxFileBytes, maxFiles: deps.config.vault.maxFiles },
    });
  });

  router.post("/me/vault", write, async (req, res) => {
    const accountId = owner(req);
    // Cheap refusals first: a full vault should not cost a whole upload. Concurrent uploads can overshoot the
    // cap by one or two; it bounds storage, it is not a quota that must hold to the byte.
    if ((await deps.vault.count(accountId)) >= deps.config.vault.maxFiles) {
      throw new AppError(409, "vault_full", `เก็บเอกสารได้สูงสุด ${deps.config.vault.maxFiles} ไฟล์ กรุณาลบไฟล์เดิมก่อน`);
    }
    const upload = await readUpload(req, deps.config);
    const parsed = fieldsSchema.safeParse(upload.fields);
    if (!parsed.success) throw new BadRequestError("กรุณาเลือกประเภทเอกสาร");
    const kind: VaultKind = parsed.data.kind;
    const certificationId = kind === "certificate" ? parsed.data.certificationId : undefined;
    if (certificationId !== undefined && !certificationIds.has(certificationId)) throw new BadRequestError("ไม่รู้จักใบรับรองที่ระบุ");
    if (upload.bytes.byteLength === 0) throw new BadRequestError("ไฟล์ว่างเปล่า");

    // The declared type is the sender's word; the bytes decide.
    const contentType = detectMimeType(upload.bytes);
    if (!contentType || !deps.config.allowedMimeTypes.includes(contentType)) throw new BadRequestError("รับเฉพาะไฟล์ PDF, JPG และ PNG");

    // A key of its own per file: two uploads of the same bytes are two files, and deleting one leaves the other.
    const key = `vault/${accountId}/${randomUUID()}`;
    // No filename goes to storage: object metadata is not a place for a person's file names.
    await deps.storage.putIfAbsent(key, upload.bytes, contentType, { route: "vault" });
    try {
      const doc = await deps.vault.insert({
        accountId,
        kind,
        ...(certificationId ? { certificationId } : {}),
        filename: cleanFilename(upload.filename),
        contentType,
        bytes: upload.bytes.byteLength,
        sha256: sha256(upload.bytes),
        key,
        uploadedAt: new Date(),
      });
      res.status(201).json(present(doc));
    } catch (error) {
      await deps.storage.delete(key).catch(() => undefined); // an unreferenced file is the worse outcome
      throw error;
    }
  });

  router.get("/me/vault/:id/file", async (req, res) => {
    const doc = await deps.vault.find(owner(req), String(req.params.id));
    if (!doc) throw new NotFoundError();
    // Always an attachment: these are the vendor's own files, not something this site renders.
    await streamDocument(req, res, deps.storage, { key: doc.key, contentType: doc.contentType, bytes: doc.bytes, filename: doc.filename }, "attachment");
  });

  router.delete("/me/vault/:id", write, async (req, res) => {
    if (!(await deps.service.removeOne(owner(req), String(req.params.id)))) throw new NotFoundError();
    res.json({ ok: true });
  });

  return router;
}
