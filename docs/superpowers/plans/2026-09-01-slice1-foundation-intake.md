# TOR Radar Slice 1 — Foundation and Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A TOR document submitted by upload, URL, or authenticated API is stored immutably, deduplicated, recorded in MongoDB, queued for extraction, and visible on a Thai admin screen fed by real data.

**Architecture:** Express API packaged by feature (`modules/intake`, `modules/tors`), with external systems behind ports (`storage.port.ts`, `queue.port.ts`) and adapters (`minio.storage.ts`, `mongo.queue.ts`). A separate worker process claims jobs from a MongoDB-backed queue. Next.js holds routing in `app/` and UI code in `src/` as `views → features → entities → shared`. Every threshold comes from `core/config.ts`.

**Tech Stack:** Node 22, TypeScript, Express 5, MongoDB driver, MinIO SDK, Zod, Busboy, Vitest, Supertest, Next.js 16, Docker Compose.

**Spec:** [2026-09-01 foundation and intake design](../specs/2026-09-01-tor-radar-foundation-intake-design.md)

**Spec amendment made during planning:** §5.6 says uploads are "streamed to storage and hashed in the same pass". That is not achievable with content-addressed keys, because the key *is* the hash and therefore is not known until the bytes have been read. This plan buffers the request body in memory with `MAX_UPLOAD_BYTES` as a hard bound, aborting the stream the moment the bound is exceeded, so memory stays bounded without a temp-key-then-copy round trip. Update the spec wording when this task lands.

---

## File Structure

**`packages/shared/`** — types and schemas both apps import
- `src/tor.ts` — `TorRecord`, `ExtractedField`, `SourceRef`, `PipelineState` types
- `src/intake.ts` — Zod schemas for intake requests and responses

**`apps/api/src/`**
- `core/config.ts` — every threshold and tunable, validated at startup
- `core/db.ts` — Mongo client, collection accessors, index creation
- `core/errors.ts` — typed errors and the Express error middleware
- `core/logging.ts` — logger that never receives field values
- `lib/hash.ts` — SHA-256 of a buffer
- `lib/safe-fetch.ts` — SSRF-resistant outbound fetch
- `lib/file-type.ts` — magic-byte verification
- `ports/storage.port.ts`, `ports/queue.port.ts` — interfaces
- `adapters/minio.storage.ts`, `adapters/mongo.queue.ts` — implementations
- `modules/intake/intake.repository.ts` — the only intake code touching Mongo
- `modules/intake/intake.service.ts` — the single entry all three routes share
- `modules/intake/intake.routes.ts` — upload, URL, API routes
- `modules/intake/intake.auth.ts` — API key verification
- `modules/tors/tors.repository.ts`, `tors.service.ts`, `tors.routes.ts`, `tors.serializer.ts`
- `workers/extract.worker.ts` — claim loop
- `app.ts`, `server.ts` — wiring and process entry

**`apps/web/src/`**
- `shared/styles/tokens.css` — palette and type scale lifted from the mockups
- `shared/lib/api/client.ts`, `shared/lib/api/tors.ts`
- `features/tor-upload/UploadForm.tsx`, `UploadForm.module.css`
- `views/UploadView.tsx`
- `app/(admin)/upload/page.tsx`

---

## Task 1: Workspace plumbing and shared types

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/tor.ts`, `packages/shared/src/index.ts`
- Modify: `package.json` (workspaces array)

- [ ] **Step 1: Add the package manifest**

Create `packages/shared/package.json`:

```json
{
  "name": "@tor-radar/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": {
    "zod": "^4.1.12"
  }
}
```

- [ ] **Step 2: Add the record types**

Create `packages/shared/src/tor.ts`:

```typescript
export type IntakeRoute = "upload" | "url" | "api";

export type PipelineState = "queued" | "extracting" | "published" | "failed";

export interface SourceRef {
  route: IntakeRoute;
  url?: string;
  submittedBy: string;
  submittedAt: string;
}

/** Every extracted value carries its own confidence and provenance (NFR-F6). */
export interface ExtractedField<T = string> {
  raw: string;
  value?: T;
  confidence: number;
  verified: boolean;
}

export interface TorRecord {
  id: string;
  contentHash: string;
  storage: { bucket: string; key: string; contentType: string; bytes: number };
  sourceRefs: SourceRef[];
  pipeline: { state: PipelineState; attempts: number; failedReason?: string };
  fields: Record<string, ExtractedField>;
  confidenceLevel?: "high" | "medium" | "low";
  unverified: boolean;
  access: { restricted: boolean; reason?: string };
  duplicateOf: string | null;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 3: Add the barrel file**

Create `packages/shared/src/index.ts`:

```typescript
export * from "./tor.js";
export * from "./intake.js";
```

Create `packages/shared/src/intake.ts` with a placeholder export so the barrel compiles; Task 9 fills it:

```typescript
import { z } from "zod";

export const urlIntakeSchema = z.object({
  url: z.string().url(),
});

export type UrlIntakeRequest = z.infer<typeof urlIntakeSchema>;
```

- [ ] **Step 4: Register the workspace**

In root `package.json`, change `"workspaces": ["apps/*"]` to:

```json
  "workspaces": ["apps/*", "packages/*"],
```

- [ ] **Step 5: Install and verify resolution**

Run: `npm install`
Expected: `node_modules/@tor-radar/shared` exists as a symlink.

Run: `npm ls @tor-radar/shared`
Expected: the package is listed, not "missing".

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json packages/shared
git commit -m "feat(shared): add the shared types workspace package"
```

---

## Task 2: Configuration module

Every threshold in the system lives here (NFR-S7). Values belonging to later slices are declared now with their open-issue status, so no later task introduces a literal.

**Files:**
- Create: `apps/api/src/core/config.ts`, `apps/api/src/core/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/core/config.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const base = {
  MONGO_URL: "mongodb://mongo:27017/tor_radar",
  MINIO_ENDPOINT: "minio",
  MINIO_PORT: "9000",
  MINIO_ACCESS_KEY: "key",
  MINIO_SECRET_KEY: "secret",
  MINIO_BUCKET: "tor-raw",
  MINIO_PUBLIC_URL: "http://localhost:9000",
  INTAKE_API_KEYS: "test-key",
};

describe("loadConfig", () => {
  it("applies documented defaults when optional values are absent", () => {
    const config = loadConfig(base);
    expect(config.maxUploadBytes).toBe(26_214_400);
    expect(config.jobMaxAttempts).toBe(5);
    expect(config.signedUrlTtlSeconds).toBe(300);
  });

  it("parses the API key list into individual keys", () => {
    const config = loadConfig({ ...base, INTAKE_API_KEYS: "a,b , c" });
    expect(config.intakeApiKeys).toEqual(["a", "b", "c"]);
  });

  it("fails fast when a required value is missing", () => {
    const { MONGO_URL, ...withoutMongo } = base;
    expect(() => loadConfig(withoutMongo)).toThrow(/MONGO_URL/);
  });

  it("rejects a non-numeric override instead of silently coercing", () => {
    expect(() => loadConfig({ ...base, MAX_UPLOAD_BYTES: "big" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- config`
Expected: FAIL — cannot find module `./config.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/core/config.ts`:

```typescript
import { z } from "zod";

/**
 * Every threshold and tunable in the system (NFR-S7). Nothing below may appear
 * as a literal anywhere else in the codebase.
 */
const schema = z.object({
  // Storage — two endpoints: one reachable inside the compose network, one from a browser.
  MONGO_URL: z.string().min(1),
  MINIO_ENDPOINT: z.string().min(1),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  MINIO_PUBLIC_URL: z.string().url(),
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(300),

  // Intake limits
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(26_214_400),
  ALLOWED_MIME_TYPES: z.string().default("application/pdf,image/jpeg,image/png"),
  MULTIPART_MAX_FILES: z.coerce.number().int().positive().default(1),
  MULTIPART_MAX_FIELD_BYTES: z.coerce.number().int().positive().default(8_192),
  INTAKE_RATE_LIMIT: z.coerce.number().int().positive().default(60),
  INTAKE_API_KEYS: z.string().min(1),

  // Outbound fetch, URL intake route
  FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  FETCH_MAX_REDIRECTS: z.coerce.number().int().nonnegative().default(3),
  FETCH_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400),

  // Queue
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  JOB_BACKOFF_MS: z.coerce.number().int().positive().default(30_000),
  JOB_LOCK_MS: z.coerce.number().int().positive().default(120_000),
  JOB_POLL_MS: z.coerce.number().int().positive().default(2_000),

  API_PORT: z.coerce.number().int().positive().default(4000),
});

export interface Config {
  mongoUrl: string;
  minio: {
    endPoint: string;
    port: number;
    accessKey: string;
    secretKey: string;
    bucket: string;
    publicUrl: string;
  };
  signedUrlTtlSeconds: number;
  maxUploadBytes: number;
  allowedMimeTypes: string[];
  multipartMaxFiles: number;
  multipartMaxFieldBytes: number;
  intakeRateLimit: number;
  intakeApiKeys: string[];
  fetchTimeoutMs: number;
  fetchMaxRedirects: number;
  fetchMaxBytes: number;
  jobMaxAttempts: number;
  jobBackoffMs: number;
  jobLockMs: number;
  jobPollMs: number;
  apiPort: number;
}

/**
 * Values awaiting measurement or calibration (SRS §8). They are declared here so
 * no later slice writes them as literals, and are read only once settled.
 * O1 T_LOW / T_HIGH · O2 MIN_BID_WINDOW_DAYS · O3 MIN_SCOPE_CHARS / MIN_SCOPE_SECTIONS
 * O4 ANOMALY_METHOD (IQR or ZSCORE)
 */
export const OPEN_VALUES = [
  "T_LOW",
  "T_HIGH",
  "MIN_BID_WINDOW_DAYS",
  "MIN_SCOPE_CHARS",
  "MIN_SCOPE_SECTIONS",
  "ANOMALY_METHOD",
] as const;

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Config {
  const parsed = schema.parse(env);
  return {
    mongoUrl: parsed.MONGO_URL,
    minio: {
      endPoint: parsed.MINIO_ENDPOINT,
      port: parsed.MINIO_PORT,
      accessKey: parsed.MINIO_ACCESS_KEY,
      secretKey: parsed.MINIO_SECRET_KEY,
      bucket: parsed.MINIO_BUCKET,
      publicUrl: parsed.MINIO_PUBLIC_URL,
    },
    signedUrlTtlSeconds: parsed.SIGNED_URL_TTL_SECONDS,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    allowedMimeTypes: parsed.ALLOWED_MIME_TYPES.split(",").map((value) => value.trim()),
    multipartMaxFiles: parsed.MULTIPART_MAX_FILES,
    multipartMaxFieldBytes: parsed.MULTIPART_MAX_FIELD_BYTES,
    intakeRateLimit: parsed.INTAKE_RATE_LIMIT,
    intakeApiKeys: parsed.INTAKE_API_KEYS.split(",").map((value) => value.trim()).filter(Boolean),
    fetchTimeoutMs: parsed.FETCH_TIMEOUT_MS,
    fetchMaxRedirects: parsed.FETCH_MAX_REDIRECTS,
    fetchMaxBytes: parsed.FETCH_MAX_BYTES,
    jobMaxAttempts: parsed.JOB_MAX_ATTEMPTS,
    jobBackoffMs: parsed.JOB_BACKOFF_MS,
    jobLockMs: parsed.JOB_LOCK_MS,
    jobPollMs: parsed.JOB_POLL_MS,
    apiPort: parsed.API_PORT,
  };
}
```

- [ ] **Step 4: Add the dependencies**

Run: `npm install zod -w @tor-radar/api`
Run: `npm install -D vitest -w @tor-radar/api`

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- config`
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/core/config.ts apps/api/src/core/config.test.ts apps/api/package.json package-lock.json
git commit -m "feat(api): add the validated configuration module"
```

---

## Task 3: Content hashing

**Files:**
- Create: `apps/api/src/lib/hash.ts`, `apps/api/src/lib/hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/hash.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { sha256 } from "./hash.js";

describe("sha256", () => {
  it("produces the known digest for a known input", () => {
    expect(sha256(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("produces the same digest for identical bytes", () => {
    expect(sha256(Buffer.from("same"))).toBe(sha256(Buffer.from("same")));
  });

  it("produces different digests for different bytes", () => {
    expect(sha256(Buffer.from("a"))).not.toBe(sha256(Buffer.from("b")));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- hash`
Expected: FAIL — cannot find module `./hash.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/lib/hash.ts`:

```typescript
import { createHash } from "node:crypto";

/** Content address for a stored document. The digest IS the storage key (FR-A-3). */
export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- hash`
Expected: 3 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/hash.ts apps/api/src/lib/hash.test.ts
git commit -m "feat(api): add content hashing"
```

---

## Task 4: Magic-byte verification

The declared content type and the file extension are attacker-controlled (spec §5.6), so the bytes decide.

**Files:**
- Create: `apps/api/src/lib/file-type.ts`, `apps/api/src/lib/file-type.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/file-type.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { detectMimeType } from "./file-type.js";

describe("detectMimeType", () => {
  it("detects a PDF from its signature", () => {
    expect(detectMimeType(Buffer.from("%PDF-1.7\n..."))).toBe("application/pdf");
  });

  it("detects a JPEG from its signature", () => {
    expect(detectMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
  });

  it("detects a PNG from its signature", () => {
    expect(
      detectMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("image/png");
  });

  it("returns null for HTML masquerading as a PDF", () => {
    expect(detectMimeType(Buffer.from("<html><script>alert(1)</script>"))).toBeNull();
  });

  it("returns null for a buffer too short to identify", () => {
    expect(detectMimeType(Buffer.from([0x25]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- file-type`
Expected: FAIL — cannot find module `./file-type.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/lib/file-type.ts`:

```typescript
/** Signatures for the three formats FR-A-1 accepts. */
const SIGNATURES: ReadonlyArray<{ mime: string; bytes: number[] }> = [
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/**
 * Identifies a document by its leading bytes. Returns null when the content does
 * not match an accepted format, whatever the caller claimed it was.
 */
export function detectMimeType(bytes: Buffer): string | null {
  for (const signature of SIGNATURES) {
    if (bytes.length < signature.bytes.length) continue;
    const matches = signature.bytes.every((byte, index) => bytes[index] === byte);
    if (matches) return signature.mime;
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- file-type`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/file-type.ts apps/api/src/lib/file-type.test.ts
git commit -m "feat(api): verify uploads by magic bytes rather than declared type"
```

---

## Task 5: SSRF-resistant fetch

The URL route makes the server fetch an attacker-supplied address. Without these checks it reaches cloud metadata endpoints and internal services (spec §5.6).

**Files:**
- Create: `apps/api/src/lib/safe-fetch.ts`, `apps/api/src/lib/safe-fetch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/safe-fetch.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isBlockedAddress, assertAllowedUrl } from "./safe-fetch.js";

describe("isBlockedAddress", () => {
  it("blocks loopback", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
  });

  it("blocks the cloud metadata address", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks private ranges", () => {
    expect(isBlockedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedAddress("172.16.0.1")).toBe(true);
    expect(isBlockedAddress("192.168.1.1")).toBe(true);
  });

  it("blocks unique-local IPv6", () => {
    expect(isBlockedAddress("fd00::1")).toBe(true);
  });

  it("allows a public address", () => {
    expect(isBlockedAddress("1.1.1.1")).toBe(false);
  });
});

describe("assertAllowedUrl", () => {
  it("rejects a non-http scheme", () => {
    expect(() => assertAllowedUrl(new URL("file:///etc/passwd"))).toThrow(/scheme/i);
  });

  it("accepts https", () => {
    expect(() => assertAllowedUrl(new URL("https://example.org/a.pdf"))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- safe-fetch`
Expected: FAIL — cannot find module `./safe-fetch.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/lib/safe-fetch.ts`:

```typescript
import { lookup } from "node:dns/promises";
import { isIPv4 } from "node:net";
import { BadRequestError } from "../core/errors.js";

/**
 * True when an address is one this server must never be tricked into fetching:
 * loopback, link-local (including the cloud metadata address), private, or
 * unique-local ranges.
 */
export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    if (a === 127 || a === 0 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    return false;
  }
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fe80")) return true;
  return false;
}

export function assertAllowedUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BadRequestError(`Unsupported URL scheme: ${url.protocol}`);
  }
}

/** Resolves the hostname and rejects the request if it points anywhere internal. */
export async function assertResolvesPublicly(url: URL): Promise<void> {
  const { address } = await lookup(url.hostname);
  if (isBlockedAddress(address)) {
    throw new BadRequestError("URL resolves to a non-public address");
  }
}

export interface FetchedDocument {
  bytes: Buffer;
  declaredType: string;
  finalUrl: string;
}

/**
 * Fetches a user-supplied URL with every control from spec §5.6: scheme
 * allowlist, resolved-address check re-run after each redirect, redirect cap,
 * response size cap, and a hard timeout.
 */
export async function safeFetchDocument(
  rawUrl: string,
  limits: { timeoutMs: number; maxRedirects: number; maxBytes: number },
): Promise<FetchedDocument> {
  let current = new URL(rawUrl);
  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    assertAllowedUrl(current);
    await assertResolvesPublicly(current);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    try {
      const response = await fetch(current, { redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new BadRequestError("Redirect without a location header");
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) {
        throw new BadRequestError(`Source responded with status ${response.status}`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > limits.maxBytes) {
        throw new BadRequestError("Document exceeds the maximum accepted size");
      }
      return {
        bytes: buffer,
        declaredType: response.headers.get("content-type") ?? "application/octet-stream",
        finalUrl: current.toString(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new BadRequestError("Too many redirects");
}
```

- [ ] **Step 4: Create the errors module this depends on**

Create `apps/api/src/core/errors.ts`:

```typescript
import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, "bad_request", message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message: string) {
    super(413, "payload_too_large", message);
  }
}

/**
 * The single translation point from thrown errors to responses. Stack traces
 * never leave the process.
 */
export function errorMiddleware(
  error: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  console.error("unhandled_error", { name: error.name, message: error.message });
  res.status(500).json({ error: { code: "internal", message: "Internal server error" } });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- safe-fetch`
Expected: 7 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/safe-fetch.ts apps/api/src/lib/safe-fetch.test.ts apps/api/src/core/errors.ts
git commit -m "feat(api): add SSRF-resistant fetch and typed errors"
```

---

## Task 6: Storage port and MinIO adapter

**Files:**
- Create: `apps/api/src/ports/storage.port.ts`, `apps/api/src/adapters/minio.storage.ts`, `apps/api/src/adapters/minio.storage.test.ts`

- [ ] **Step 1: Define the port**

Create `apps/api/src/ports/storage.port.ts`:

```typescript
export interface StoredObject {
  bucket: string;
  key: string;
  contentType: string;
  bytes: number;
}

/**
 * Object storage for original documents. There is deliberately no `put`: FR-A-2
 * forbids overwriting a stored object, so the prohibition is enforced by the
 * interface rather than by convention.
 */
export interface Storage {
  putIfAbsent(key: string, bytes: Buffer, contentType: string): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  getStream(key: string): Promise<NodeJS.ReadableStream>;
  /** Generated on demand, never persisted — signed URLs expire. */
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
}
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/adapters/minio.storage.test.ts`. This is an integration test and needs MinIO from Compose:

```typescript
import { beforeAll, describe, expect, it } from "vitest";
import { MinioStorage } from "./minio.storage.js";
import { loadConfig } from "../core/config.js";

const config = loadConfig(process.env);
const storage = new MinioStorage(config.minio);

describe("MinioStorage", () => {
  beforeAll(async () => {
    await storage.ensureBucket();
  });

  it("stores an object and reports it exists", async () => {
    const key = `test-${Date.now()}`;
    await storage.putIfAbsent(key, Buffer.from("hello"), "application/pdf");
    expect(await storage.exists(key)).toBe(true);
  });

  it("does not overwrite an existing object", async () => {
    const key = `test-${Date.now()}-noclobber`;
    const first = await storage.putIfAbsent(key, Buffer.from("original"), "application/pdf");
    const second = await storage.putIfAbsent(key, Buffer.from("replacement"), "application/pdf");
    expect(second.bytes).toBe(first.bytes);

    const chunks: Buffer[] = [];
    const stream = await storage.getStream(key);
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe("original");
  });

  it("signs a URL against the public origin, not the internal endpoint", async () => {
    const key = `test-${Date.now()}-url`;
    await storage.putIfAbsent(key, Buffer.from("x"), "application/pdf");
    const url = await storage.signedUrl(key, 60);
    expect(url.startsWith(config.minio.publicUrl)).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `docker compose up -d minio` then `npm test -w @tor-radar/api -- minio`
Expected: FAIL — cannot find module `./minio.storage.js`.

- [ ] **Step 4: Write the implementation**

Run: `npm install minio -w @tor-radar/api`

Create `apps/api/src/adapters/minio.storage.ts`:

```typescript
import { Client } from "minio";
import type { Storage, StoredObject } from "../ports/storage.port.js";

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
  async putIfAbsent(key: string, bytes: Buffer, contentType: string): Promise<StoredObject> {
    const existing = await this.head(key);
    if (existing) return existing;
    await this.client.putObject(this.settings.bucket, key, bytes, bytes.byteLength, {
      "Content-Type": contentType,
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- minio`
Expected: 3 passing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/ports/storage.port.ts apps/api/src/adapters/minio.storage.ts apps/api/src/adapters/minio.storage.test.ts apps/api/package.json package-lock.json
git commit -m "feat(api): add the storage port and its MinIO adapter"
```
