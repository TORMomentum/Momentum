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
  ADMIN_API_KEYS: "admin-key",
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
  ADMIN_API_KEYS: z.string().min(1),

  // Outbound fetch, URL intake route
  FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  FETCH_MAX_REDIRECTS: z.coerce.number().int().nonnegative().default(3),
  FETCH_MAX_BYTES: z.coerce.number().int().positive().default(26_214_400),

  // Queue
  JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  JOB_BACKOFF_MS: z.coerce.number().int().positive().default(30_000),
  JOB_LOCK_MS: z.coerce.number().int().positive().default(120_000),
  JOB_POLL_MS: z.coerce.number().int().positive().default(2_000),
  RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  RECONCILE_MIN_AGE_MS: z.coerce.number().int().positive().default(120_000),

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
  adminApiKeys: string[];
  fetchTimeoutMs: number;
  fetchMaxRedirects: number;
  fetchMaxBytes: number;
  jobMaxAttempts: number;
  jobBackoffMs: number;
  jobLockMs: number;
  jobPollMs: number;
  reconcileIntervalMs: number;
  reconcileMinAgeMs: number;
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
    adminApiKeys: parsed.ADMIN_API_KEYS.split(",").map((value) => value.trim()).filter(Boolean),
    fetchTimeoutMs: parsed.FETCH_TIMEOUT_MS,
    fetchMaxRedirects: parsed.FETCH_MAX_REDIRECTS,
    fetchMaxBytes: parsed.FETCH_MAX_BYTES,
    jobMaxAttempts: parsed.JOB_MAX_ATTEMPTS,
    jobBackoffMs: parsed.JOB_BACKOFF_MS,
    jobLockMs: parsed.JOB_LOCK_MS,
    jobPollMs: parsed.JOB_POLL_MS,
    reconcileIntervalMs: parsed.RECONCILE_INTERVAL_MS,
    reconcileMinAgeMs: parsed.RECONCILE_MIN_AGE_MS,
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

---

## Task 7: Queue port and MongoDB adapter

The claim must be atomic: two workers must never take the same job. Enqueue must be idempotent, because the reconciler in Task 11 may enqueue a record that already has a job.

**Files:**
- Create: `apps/api/src/ports/queue.port.ts`, `apps/api/src/core/db.ts`, `apps/api/src/adapters/mongo.queue.ts`, `apps/api/src/adapters/mongo.queue.test.ts`

- [ ] **Step 1: Define the port**

Create `apps/api/src/ports/queue.port.ts`:

```typescript
export interface Job {
  id: string;
  torId: string;
  type: "extract";
  attempts: number;
}

export interface Queue {
  /** Idempotent per record: a second call while a job is live is a no-op. */
  enqueue(torId: string): Promise<void>;
  /** Atomically claims one due job, or returns null. */
  claim(): Promise<Job | null>;
  complete(jobId: string): Promise<void>;
  /** Records the failure and either schedules a retry or gives up permanently. */
  fail(jobId: string, reason: string): Promise<{ willRetry: boolean }>;
}
```

- [ ] **Step 2: Write the database module**

Create `apps/api/src/core/db.ts`:

```typescript
import { MongoClient, type Collection, type Db } from "mongodb";

export interface TorDocument {
  contentHash: string;
  storage: { bucket: string; key: string; contentType: string; bytes: number };
  sourceRefs: Array<{ route: string; url?: string; submittedBy: string; submittedAt: Date }>;
  pipeline: { state: string; attempts: number; failedReason?: string };
  fields: Record<string, unknown>;
  /** The TOR's own publication date, extracted in slice 2 - never the ingestion time. */
  announcedAt: Date | null;
  sourceUrl: string | null;
  confidenceLevel?: string;
  unverified: boolean;
  statusHistory: Array<{ from: string | null; to: string; at: Date; actor: string; source: string }>;
  access: { restricted: boolean; reason?: string; auditRef?: string };
  duplicateOf: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface JobDocument {
  torId: string;
  type: "extract";
  state: "pending" | "running" | "failed" | "done";
  attempts: number;
  lastError?: string;
  nextRunAt: Date;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
}

let client: MongoClient | null = null;

export async function connect(mongoUrl: string): Promise<Db> {
  client = new MongoClient(mongoUrl);
  await client.connect();
  return client.db();
}

export async function disconnect(): Promise<void> {
  await client?.close();
  client = null;
}

export function tors(db: Db): Collection<TorDocument> {
  return db.collection<TorDocument>("tors");
}

export function jobs(db: Db): Collection<JobDocument> {
  return db.collection<JobDocument>("ingest_jobs");
}

/** Indexes from spec section 4.5. The unique contentHash index is the dedupe guarantee. */
export async function ensureIndexes(db: Db): Promise<void> {
  await tors(db).createIndex({ contentHash: 1 }, { unique: true });
  await tors(db).createIndex({ "pipeline.state": 1, createdAt: -1 });
  await tors(db).createIndex({ "fields.agency.value": 1, createdAt: -1 });
  await tors(db).createIndex({ "fields.category.value": 1, createdAt: -1 });
  await tors(db).createIndex({ announcedAt: -1 });
  await tors(db).createIndex({
    "fields.agency.value": 1,
    announcedAt: -1,
    "fields.torStatus.value": 1,
  });
  await tors(db).createIndex({ "access.restricted": 1 });
  await jobs(db).createIndex({ state: 1, nextRunAt: 1 });
  await jobs(db).createIndex({ torId: 1, state: 1 });
}
```

- [ ] **Step 3: Write the failing test**

Create `apps/api/src/adapters/mongo.queue.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { connect, disconnect, ensureIndexes, jobs } from "../core/db.js";
import { MongoQueue } from "./mongo.queue.js";
import { loadConfig } from "../core/config.js";

const config = loadConfig(process.env);
let db: Db;
let queue: MongoQueue;

beforeAll(async () => {
  db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });
});

beforeEach(async () => {
  await jobs(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("MongoQueue", () => {
  it("claims an enqueued job", async () => {
    await queue.enqueue("tor-1");
    const claimed = await queue.claim();
    expect(claimed?.torId).toBe("tor-1");
  });

  it("never hands the same job to two claimants", async () => {
    await queue.enqueue("tor-1");
    const [first, second] = await Promise.all([queue.claim(), queue.claim()]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it("does not create a second live job for the same record", async () => {
    await queue.enqueue("tor-1");
    await queue.enqueue("tor-1");
    expect(await jobs(db).countDocuments({ torId: "tor-1" })).toBe(1);
  });

  it("returns null when nothing is due", async () => {
    expect(await queue.claim()).toBeNull();
  });

  it("schedules a retry on failure while attempts remain", async () => {
    await queue.enqueue("tor-1");
    const job = await queue.claim();
    const result = await queue.fail(job.id, "vertex timeout");
    expect(result.willRetry).toBe(true);

    const stored = await jobs(db).findOne({ torId: "tor-1" });
    expect(stored?.state).toBe("pending");
    expect(stored?.attempts).toBe(1);
    expect(stored?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("gives up permanently once attempts are exhausted", async () => {
    await queue.enqueue("tor-1");
    for (let attempt = 0; attempt < config.jobMaxAttempts; attempt += 1) {
      await jobs(db).updateOne({ torId: "tor-1" }, { $set: { nextRunAt: new Date(0) } });
      const job = await queue.claim();
      await queue.fail(job.id, "still failing");
    }
    expect((await jobs(db).findOne({ torId: "tor-1" }))?.state).toBe("failed");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `docker compose up -d mongo` then `npm test -w @tor-radar/api -- mongo.queue`
Expected: FAIL, cannot find module `./mongo.queue.js`.

- [ ] **Step 5: Write the implementation**

Run: `npm install mongodb -w @tor-radar/api`

Create `apps/api/src/adapters/mongo.queue.ts`:

```typescript
import { ObjectId, type Db } from "mongodb";
import { jobs, type JobDocument } from "../core/db.js";
import type { Job, Queue } from "../ports/queue.port.js";

export interface QueueSettings {
  maxAttempts: number;
  backoffMs: number;
  lockMs: number;
}

export class MongoQueue implements Queue {
  constructor(
    private readonly db: Db,
    private readonly settings: QueueSettings,
  ) {}

  /**
   * Idempotent: the reconciler may enqueue a record that already has a live
   * job, and that must not produce duplicate work.
   */
  async enqueue(torId: string): Promise<void> {
    const now = new Date();
    await jobs(this.db).updateOne(
      { torId, state: { $in: ["pending", "running"] } },
      {
        $setOnInsert: {
          torId,
          type: "extract",
          state: "pending",
          attempts: 0,
          nextRunAt: now,
          createdAt: now,
          updatedAt: now,
        } as JobDocument,
      },
      { upsert: true },
    );
  }

  /**
   * findOneAndUpdate is atomic, so two workers racing for the same document
   * produce exactly one winner. The lock expiry lets a job abandoned by a
   * crashed worker become claimable again.
   */
  async claim(): Promise<Job | null> {
    const now = new Date();
    const result = await jobs(this.db).findOneAndUpdate(
      {
        state: "pending",
        nextRunAt: { $lte: now },
        $or: [{ lockedUntil: { $exists: false } }, { lockedUntil: { $lte: now } }],
      },
      {
        $set: {
          state: "running",
          lockedUntil: new Date(now.getTime() + this.settings.lockMs),
          updatedAt: now,
        },
      },
      { sort: { nextRunAt: 1 }, returnDocument: "after" },
    );
    if (!result) return null;
    return {
      id: result._id.toString(),
      torId: result.torId,
      type: "extract",
      attempts: result.attempts,
    };
  }

  async complete(jobId: string): Promise<void> {
    await jobs(this.db).updateOne(
      { _id: new ObjectId(jobId) },
      { $set: { state: "done", updatedAt: new Date() }, $unset: { lockedUntil: "" } },
    );
  }

  async fail(jobId: string, reason: string): Promise<{ willRetry: boolean }> {
    const now = new Date();
    const job = await jobs(this.db).findOne({ _id: new ObjectId(jobId) });
    if (!job) return { willRetry: false };

    const attempts = job.attempts + 1;
    const willRetry = attempts < this.settings.maxAttempts;
    await jobs(this.db).updateOne(
      { _id: new ObjectId(jobId) },
      {
        $set: {
          state: willRetry ? "pending" : "failed",
          attempts,
          lastError: reason,
          nextRunAt: new Date(now.getTime() + this.settings.backoffMs * attempts),
          updatedAt: now,
        },
        $unset: { lockedUntil: "" },
      },
    );
    return { willRetry };
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- mongo.queue`
Expected: 6 passing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/ports/queue.port.ts apps/api/src/core/db.ts apps/api/src/adapters/mongo.queue.ts apps/api/src/adapters/mongo.queue.test.ts apps/api/package.json package-lock.json
git commit -m "feat(api): add the queue port and its MongoDB adapter"
```

---

## Task 8: Intake repository

The only intake code that touches MongoDB.

**Files:**
- Create: `apps/api/src/modules/intake/intake.repository.ts`, `apps/api/src/modules/intake/intake.repository.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/intake/intake.repository.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { connect, disconnect, ensureIndexes, tors } from "../../core/db.js";
import { IntakeRepository } from "./intake.repository.js";
import { loadConfig } from "../../core/config.js";

const config = loadConfig(process.env);
let db: Db;
let repository: IntakeRepository;

const stored = { bucket: "tor-raw", key: "abc", contentType: "application/pdf", bytes: 10 };
const source = { route: "upload" as const, submittedBy: "admin", submittedAt: new Date() };

beforeAll(async () => {
  db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  repository = new IntakeRepository(db);
});

beforeEach(async () => {
  await tors(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("IntakeRepository", () => {
  it("inserts a queued record and finds it by hash", async () => {
    const id = await repository.insert("abc", stored, source);
    const found = await repository.findByHash("abc");
    expect(found?.id).toBe(id);
    expect(found?.pipeline.state).toBe("queued");
  });

  it("returns null for an unknown hash", async () => {
    expect(await repository.findByHash("missing")).toBeNull();
  });

  it("appends a source reference without duplicating the record", async () => {
    const id = await repository.insert("abc", stored, source);
    await repository.appendSourceRef(id, {
      route: "url",
      url: "https://example.org/a.pdf",
      submittedBy: "admin",
      submittedAt: new Date(),
    });
    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.sourceRefs).toHaveLength(2);
    expect(await tors(db).countDocuments()).toBe(1);
  });

  it("records the source URL when the submission had one", async () => {
    await repository.insert("abc", stored, {
      route: "url",
      url: "https://example.org/a.pdf",
      submittedBy: "admin",
      submittedAt: new Date(),
    });
    const document = await tors(db).findOne({ contentHash: "abc" });
    expect(document?.sourceUrl).toBe("https://example.org/a.pdf");
  });

  it("rejects a second insert of the same hash", async () => {
    await repository.insert("abc", stored, source);
    await expect(repository.insert("abc", stored, source)).rejects.toMatchObject({ code: 11000 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- intake.repository`
Expected: FAIL, cannot find module `./intake.repository.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/intake/intake.repository.ts`:

```typescript
import { ObjectId, type Db } from "mongodb";
import { tors, type TorDocument } from "../../core/db.js";
import type { StoredObject } from "../../ports/storage.port.js";

export interface SourceRefInput {
  route: "upload" | "url" | "api";
  url?: string;
  submittedBy: string;
  submittedAt: Date;
}

export interface FoundTor {
  id: string;
  contentHash: string;
  pipeline: { state: string; attempts: number };
}

export class IntakeRepository {
  constructor(private readonly db: Db) {}

  async findByHash(contentHash: string): Promise<FoundTor | null> {
    const document = await tors(this.db).findOne({ contentHash });
    if (!document) return null;
    return {
      id: document._id.toString(),
      contentHash: document.contentHash,
      pipeline: { state: document.pipeline.state, attempts: document.pipeline.attempts },
    };
  }

  /** Throws a duplicate-key error (code 11000) when the hash already exists. */
  async insert(
    contentHash: string,
    storedObject: StoredObject,
    source: SourceRefInput,
  ): Promise<string> {
    const now = new Date();
    const result = await tors(this.db).insertOne({
      contentHash,
      storage: storedObject,
      sourceRefs: [source],
      pipeline: { state: "queued", attempts: 0 },
      fields: {},
      announcedAt: null,
      sourceUrl: source.url ?? null,
      unverified: true,
      statusHistory: [
        { from: null, to: "queued", at: now, actor: source.submittedBy, source: source.route },
      ],
      access: { restricted: false },
      duplicateOf: null,
      createdAt: now,
      updatedAt: now,
    } as TorDocument);
    return result.insertedId.toString();
  }

  async appendSourceRef(id: string, source: SourceRefInput): Promise<void> {
    await tors(this.db).updateOne(
      { _id: new ObjectId(id) },
      { $push: { sourceRefs: source }, $set: { updatedAt: new Date() } },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- intake.repository`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/intake/intake.repository.ts apps/api/src/modules/intake/intake.repository.test.ts
git commit -m "feat(intake): add the intake repository"
```

---

## Task 9: Intake service

The single entry all three routes share. Order is fixed: store the bytes, insert the record, then enqueue.

**Files:**
- Create: `apps/api/src/modules/intake/intake.service.ts`, `apps/api/src/modules/intake/intake.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/intake/intake.service.test.ts`. Ports are replaced by fakes, so this test needs no infrastructure:

```typescript
import { describe, expect, it, vi } from "vitest";
import { IntakeService } from "./intake.service.js";
import type { Storage, StoredObject } from "../../ports/storage.port.js";
import type { Queue } from "../../ports/queue.port.js";

const pdf = Buffer.from("%PDF-1.7 body");
const limits = { allowedMimeTypes: ["application/pdf"], maxUploadBytes: 1_000 };

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
      throw new Error("not used in this test");
    },
    async signedUrl(key) {
      return "http://localhost:9000/" + key;
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
  };

  const records = new Map<string, { id: string; hash: string }>();
  const repository = {
    async findByHash(hash: string) {
      const found = [...records.values()].find((record) => record.hash === hash);
      return found
        ? { id: found.id, contentHash: hash, pipeline: { state: "queued", attempts: 0 } }
        : null;
    },
    async insert(hash: string) {
      const id = "id-" + (records.size + 1);
      records.set(id, { id, hash });
      return id;
    },
    async appendSourceRef() {},
  };

  return { storage, queue, repository, enqueued, objects };
}

const source = { route: "upload" as const, submittedBy: "admin" };

describe("IntakeService.submit", () => {
  it("stores, records, and queues a new document", async () => {
    const { storage, queue, repository, enqueued, objects } = fakes();
    const service = new IntakeService(storage, queue, repository as never, limits);

    const result = await service.submit(pdf, source);

    expect(result.duplicate).toBe(false);
    expect(objects.size).toBe(1);
    expect(enqueued).toEqual([result.torId]);
  });

  it("converges a repeat submission on the existing record without re-queueing", async () => {
    const { storage, queue, repository, enqueued } = fakes();
    const service = new IntakeService(storage, queue, repository as never, limits);

    const first = await service.submit(pdf, source);
    const second = await service.submit(pdf, {
      route: "url",
      submittedBy: "admin",
      url: "https://example.org/a.pdf",
    });

    expect(second.duplicate).toBe(true);
    expect(second.torId).toBe(first.torId);
    expect(enqueued).toHaveLength(1);
  });

  it("treats a duplicate-key race as a duplicate rather than an error", async () => {
    const { storage, queue, repository } = fakes();
    const service = new IntakeService(storage, queue, repository as never, limits);

    const first = await service.submit(pdf, source);
    vi.spyOn(repository, "findByHash").mockResolvedValueOnce(null);
    vi.spyOn(repository, "insert").mockRejectedValueOnce({ code: 11000 });

    const second = await service.submit(pdf, source);
    expect(second.duplicate).toBe(true);
    expect(second.torId).toBe(first.torId);
  });

  it("rejects content whose bytes are not an accepted type", async () => {
    const { storage, queue, repository } = fakes();
    const service = new IntakeService(storage, queue, repository as never, limits);

    await expect(service.submit(Buffer.from("<html>nope</html>"), source)).rejects.toThrow(/type/i);
  });

  it("rejects content larger than the configured limit", async () => {
    const { storage, queue, repository } = fakes();
    const service = new IntakeService(storage, queue, repository as never, {
      ...limits,
      maxUploadBytes: 4,
    });

    await expect(service.submit(pdf, source)).rejects.toThrow(/size|large/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- intake.service`
Expected: FAIL, cannot find module `./intake.service.js`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/intake/intake.service.ts`:

```typescript
import { sha256 } from "../../lib/hash.js";
import { detectMimeType } from "../../lib/file-type.js";
import { BadRequestError, PayloadTooLargeError } from "../../core/errors.js";
import type { Storage } from "../../ports/storage.port.js";
import type { Queue } from "../../ports/queue.port.js";
import type { IntakeRepository, SourceRefInput } from "./intake.repository.js";

export interface SubmitSource {
  route: "upload" | "url" | "api";
  url?: string;
  submittedBy: string;
}

export interface SubmitResult {
  torId: string;
  duplicate: boolean;
  state: "queued";
}

export interface IntakeLimits {
  allowedMimeTypes: string[];
  maxUploadBytes: number;
}

export class IntakeService {
  constructor(
    private readonly storage: Storage,
    private readonly queue: Queue,
    private readonly repository: IntakeRepository,
    private readonly limits: IntakeLimits,
  ) {}

  /**
   * The single entry point for all three intake routes (FR-A-1). Order is
   * fixed - store the bytes, insert the record, then enqueue - so a crash
   * between steps leaves an orphaned object rather than a job pointing at
   * nothing. The reconciler in Task 11 covers the insert-then-enqueue gap.
   */
  async submit(bytes: Buffer, source: SubmitSource): Promise<SubmitResult> {
    if (bytes.byteLength > this.limits.maxUploadBytes) {
      throw new PayloadTooLargeError("Document exceeds the maximum accepted size");
    }

    // The declared content type is attacker-controlled; the bytes decide.
    const contentType = detectMimeType(bytes);
    if (!contentType || !this.limits.allowedMimeTypes.includes(contentType)) {
      throw new BadRequestError("Unsupported document type");
    }

    const contentHash = sha256(bytes);
    const sourceRef: SourceRefInput = {
      route: source.route,
      url: source.url,
      submittedBy: source.submittedBy,
      submittedAt: new Date(),
    };

    const existing = await this.repository.findByHash(contentHash);
    if (existing) {
      await this.repository.appendSourceRef(existing.id, sourceRef);
      return { torId: existing.id, duplicate: true, state: "queued" };
    }

    const storedObject = await this.storage.putIfAbsent(contentHash, bytes, contentType);

    let torId: string;
    try {
      torId = await this.repository.insert(contentHash, storedObject, sourceRef);
    } catch (error) {
      // The unique index is the real dedupe guarantee: two simultaneous
      // submissions both pass findByHash, and the loser lands here.
      if ((error as { code?: number }).code === 11000) {
        const winner = await this.repository.findByHash(contentHash);
        if (winner) {
          await this.repository.appendSourceRef(winner.id, sourceRef);
          return { torId: winner.id, duplicate: true, state: "queued" };
        }
      }
      throw error;
    }

    await this.queue.enqueue(torId);
    return { torId, duplicate: false, state: "queued" };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- intake.service`
Expected: 5 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/intake/intake.service.ts apps/api/src/modules/intake/intake.service.test.ts
git commit -m "feat(intake): add the intake service shared by all three routes"
```

---

## Task 10: Intake routes and access control

Three routes, one service. Upload and URL are admin routes; the programmatic route takes an intake key. Network placement is not access control (spec §5.5).

**Files:**
- Create: `apps/api/src/modules/intake/intake.auth.ts`, `apps/api/src/modules/intake/intake.auth.test.ts`, `apps/api/src/modules/intake/intake.routes.ts`, `apps/api/src/modules/intake/intake.routes.test.ts`
- Modify: `packages/shared/src/intake.ts`

- [ ] **Step 1: Write the failing auth test**

Create `apps/api/src/modules/intake/intake.auth.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { matchesAnyKey } from "./intake.auth.js";

describe("matchesAnyKey", () => {
  it("accepts a key present in the list", () => {
    expect(matchesAnyKey("Bearer good", ["good", "other"])).toBe(true);
  });

  it("rejects a key absent from the list", () => {
    expect(matchesAnyKey("Bearer wrong", ["good"])).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(matchesAnyKey(undefined, ["good"])).toBe(false);
  });

  it("rejects a header without the Bearer scheme", () => {
    expect(matchesAnyKey("good", ["good"])).toBe(false);
  });

  it("rejects a prefix of a valid key", () => {
    expect(matchesAnyKey("Bearer goo", ["good"])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- intake.auth`
Expected: FAIL, cannot find module `./intake.auth.js`.

- [ ] **Step 3: Write the auth implementation**

Create `apps/api/src/modules/intake/intake.auth.ts`:

```typescript
import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { UnauthorizedError } from "../../core/errors.js";

/** Constant-time comparison, so a wrong key cannot be discovered byte by byte. */
function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function matchesAnyKey(header: string | undefined, keys: string[]): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const presented = header.slice("Bearer ".length);
  return keys.some((key) => constantTimeEquals(presented, key));
}

/** NFR-S1: admin and API routes enforce access level. */
export function requireKey(keys: string[], actor: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!matchesAnyKey(req.header("authorization"), keys)) {
      next(new UnauthorizedError());
      return;
    }
    (req as Request & { actor?: string }).actor = actor;
    next();
  };
}
```

- [ ] **Step 4: Run the auth test to verify it passes**

Run: `npm test -w @tor-radar/api -- intake.auth`
Expected: 5 passing.

- [ ] **Step 5: Write the failing routes test**

Create `apps/api/src/modules/intake/intake.routes.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { buildIntakeRouter } from "./intake.routes.js";
import { errorMiddleware } from "../../core/errors.js";

const pdf = Buffer.from("%PDF-1.7 test body");

function appWith(submit = vi.fn().mockResolvedValue({ torId: "t1", duplicate: false, state: "queued" })) {
  const service = { submit } as never;
  const app = express();
  app.use(
    "/api/v1/intake",
    buildIntakeRouter({
      service,
      adminKeys: ["admin-key"],
      intakeKeys: ["intake-key"],
      maxUploadBytes: 1_000_000,
      multipartMaxFiles: 1,
      multipartMaxFieldBytes: 8_192,
      fetchLimits: { timeoutMs: 1_000, maxRedirects: 2, maxBytes: 1_000_000 },
    }),
  );
  app.use(errorMiddleware);
  return { app, submit };
}

describe("intake routes", () => {
  it("accepts an upload from an admin key and returns 202", async () => {
    const { app, submit } = appWith();
    const response = await request(app)
      .post("/api/v1/intake/upload")
      .set("authorization", "Bearer admin-key")
      .attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ torId: "t1", state: "queued" });
    expect(submit).toHaveBeenCalledOnce();
  });

  it("rejects an upload with no credentials", async () => {
    const { app, submit } = appWith();
    const response = await request(app).post("/api/v1/intake/upload").attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(401);
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects an upload presenting the intake key rather than the admin key", async () => {
    const { app } = appWith();
    const response = await request(app)
      .post("/api/v1/intake/upload")
      .set("authorization", "Bearer intake-key")
      .attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(401);
  });

  it("rejects a URL that resolves to a private address", async () => {
    const { app, submit } = appWith();
    const response = await request(app)
      .post("/api/v1/intake/url")
      .set("authorization", "Bearer admin-key")
      .send({ url: "http://169.254.169.254/latest/meta-data/" });

    expect(response.status).toBe(400);
    expect(submit).not.toHaveBeenCalled();
  });

  it("rejects a non-http scheme on the URL route", async () => {
    const { app } = appWith();
    const response = await request(app)
      .post("/api/v1/intake/url")
      .set("authorization", "Bearer admin-key")
      .send({ url: "file:///etc/passwd" });

    expect(response.status).toBe(400);
  });

  it("accepts the programmatic route with an intake key", async () => {
    const { app, submit } = appWith();
    const response = await request(app)
      .post("/api/v1/intake")
      .set("authorization", "Bearer intake-key")
      .attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(202);
    expect(submit).toHaveBeenCalledOnce();
  });

  it("reports a duplicate as 200 rather than 202", async () => {
    const submit = vi.fn().mockResolvedValue({ torId: "t1", duplicate: true, state: "queued" });
    const { app } = appWith(submit);
    const response = await request(app)
      .post("/api/v1/intake/upload")
      .set("authorization", "Bearer admin-key")
      .attach("file", pdf, "tor.pdf");

    expect(response.status).toBe(200);
    expect(response.body.duplicate).toBe(true);
  });
});
```

- [ ] **Step 6: Run the routes test to verify it fails**

Run: `npm test -w @tor-radar/api -- intake.routes`
Expected: FAIL, cannot find module `./intake.routes.js`.

- [ ] **Step 7: Add the URL request schema**

Replace the contents of `packages/shared/src/intake.ts`:

```typescript
import { z } from "zod";

/** Primitives only: an object here would reach a query as an operator (spec §5.6). */
export const urlIntakeSchema = z.object({
  url: z.string().url(),
});

export type UrlIntakeRequest = z.infer<typeof urlIntakeSchema>;

export interface IntakeResponse {
  torId: string;
  duplicate: boolean;
  state: "queued";
}
```

- [ ] **Step 8: Write the routes implementation**

Run: `npm install busboy express-rate-limit -w @tor-radar/api`
Run: `npm install -D @types/busboy supertest @types/supertest -w @tor-radar/api`

Create `apps/api/src/modules/intake/intake.routes.ts`:

```typescript
import { Router, type Request } from "express";
import busboy from "busboy";
import rateLimit from "express-rate-limit";
import { urlIntakeSchema } from "@tor-radar/shared";
import { requireKey } from "./intake.auth.js";
import { safeFetchDocument } from "../../lib/safe-fetch.js";
import { BadRequestError, PayloadTooLargeError } from "../../core/errors.js";
import type { IntakeService } from "./intake.service.js";

export interface IntakeRouterDeps {
  service: IntakeService;
  adminKeys: string[];
  intakeKeys: string[];
  maxUploadBytes: number;
  multipartMaxFiles: number;
  multipartMaxFieldBytes: number;
  fetchLimits: { timeoutMs: number; maxRedirects: number; maxBytes: number };
  rateLimitPerMinute?: number;
}

/**
 * Reads one multipart file into memory, aborting the moment it exceeds the
 * limit. Buffering is deliberate: the storage key is the content hash, so the
 * key cannot be known until every byte has been read (see the plan header).
 */
function readSingleFile(req: Request, deps: IntakeRouterDeps): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parser = busboy({
      headers: req.headers,
      limits: {
        files: deps.multipartMaxFiles,
        fileSize: deps.maxUploadBytes,
        fieldSize: deps.multipartMaxFieldBytes,
      },
    });
    const chunks: Buffer[] = [];
    let received = false;

    parser.on("file", (_name, stream) => {
      received = true;
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("limit", () =>
        reject(new PayloadTooLargeError("Document exceeds the maximum accepted size")),
      );
    });
    parser.on("filesLimit", () => reject(new BadRequestError("Only one file may be submitted")));
    parser.on("error", (error) => reject(error as Error));
    parser.on("close", () => {
      if (!received) {
        reject(new BadRequestError("No file was submitted"));
        return;
      }
      resolve(Buffer.concat(chunks));
    });

    req.pipe(parser);
  });
}

export function buildIntakeRouter(deps: IntakeRouterDeps): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: deps.rateLimitPerMinute ?? 60,
    standardHeaders: true,
    legacyHeaders: false,
  });
  router.use(limiter);

  const respond = (result: { duplicate: boolean }) => (result.duplicate ? 200 : 202);

  router.post("/upload", requireKey(deps.adminKeys, "admin"), async (req, res) => {
    const bytes = await readSingleFile(req, deps);
    const result = await deps.service.submit(bytes, { route: "upload", submittedBy: "admin" });
    res.status(respond(result)).json(result);
  });

  router.post("/url", requireKey(deps.adminKeys, "admin"), async (req, res) => {
    const { url } = urlIntakeSchema.parse(req.body);
    const fetched = await safeFetchDocument(url, deps.fetchLimits);
    const result = await deps.service.submit(fetched.bytes, {
      route: "url",
      url: fetched.finalUrl,
      submittedBy: "admin",
    });
    res.status(respond(result)).json(result);
  });

  router.post("/", requireKey(deps.intakeKeys, "api"), async (req, res) => {
    const bytes = await readSingleFile(req, deps);
    const result = await deps.service.submit(bytes, { route: "api", submittedBy: "api" });
    res.status(respond(result)).json(result);
  });

  return router;
}
```

- [ ] **Step 9: Run the routes test to verify it passes**

Run: `npm test -w @tor-radar/api -- intake.routes`
Expected: 7 passing.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/intake packages/shared/src/intake.ts apps/api/package.json package-lock.json
git commit -m "feat(intake): add the three intake routes with access control"
```

---

## Task 11: Extraction worker and reconciler

The worker is a separate process. The reconciler closes the gap the cross-check found: a crash between inserting the record and enqueueing its job would otherwise leave a document stored, recorded, and never processed.

**Files:**
- Create: `apps/api/src/workers/extract.worker.ts`, `apps/api/src/workers/reconcile.ts`, `apps/api/src/workers/reconcile.test.ts`

- [ ] **Step 1: Write the failing reconciler test**

Create `apps/api/src/workers/reconcile.test.ts`:

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "mongodb";
import { connect, disconnect, ensureIndexes, jobs, tors } from "../core/db.js";
import { MongoQueue } from "../adapters/mongo.queue.js";
import { reconcileOrphanedRecords } from "./reconcile.js";
import { loadConfig } from "../core/config.js";

const config = loadConfig(process.env);
let db: Db;
let queue: MongoQueue;

const record = (createdAt: Date) => ({
  contentHash: "hash-" + createdAt.getTime(),
  storage: { bucket: "tor-raw", key: "k", contentType: "application/pdf", bytes: 1 },
  sourceRefs: [],
  pipeline: { state: "queued", attempts: 0 },
  fields: {},
  announcedAt: null,
  sourceUrl: null,
  unverified: true,
  statusHistory: [],
  access: { restricted: false },
  duplicateOf: null,
  createdAt,
  updatedAt: createdAt,
});

beforeAll(async () => {
  db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });
});

beforeEach(async () => {
  await tors(db).deleteMany({});
  await jobs(db).deleteMany({});
});

afterAll(async () => {
  await disconnect();
});

describe("reconcileOrphanedRecords", () => {
  it("enqueues a queued record old enough to have no job", async () => {
    const old = new Date(Date.now() - config.reconcileMinAgeMs - 1_000);
    await tors(db).insertOne(record(old) as never);

    const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);

    expect(requeued).toBe(1);
    expect(await jobs(db).countDocuments()).toBe(1);
  });

  it("leaves a record that already has a job alone", async () => {
    const old = new Date(Date.now() - config.reconcileMinAgeMs - 1_000);
    const inserted = await tors(db).insertOne(record(old) as never);
    await queue.enqueue(inserted.insertedId.toString());

    const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);

    expect(requeued).toBe(0);
    expect(await jobs(db).countDocuments()).toBe(1);
  });

  it("leaves a record younger than the minimum age alone, since its enqueue may be in flight", async () => {
    await tors(db).insertOne(record(new Date()) as never);

    const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);

    expect(requeued).toBe(0);
    expect(await jobs(db).countDocuments()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- reconcile`
Expected: FAIL, cannot find module `./reconcile.js`.

- [ ] **Step 3: Write the reconciler**

Create `apps/api/src/workers/reconcile.ts`:

```typescript
import type { Db } from "mongodb";
import { jobs, tors } from "../core/db.js";
import type { Queue } from "../ports/queue.port.js";

/**
 * Closes the gap between inserting a record and enqueueing its job. A process
 * that dies between those two writes leaves a document that is stored,
 * recorded, and never processed - it would sit in "queued" forever without
 * ever surfacing as failed. Enqueue is idempotent, so a sweep that races a
 * successful enqueue produces no duplicate work.
 */
export async function reconcileOrphanedRecords(
  db: Db,
  queue: Queue,
  minAgeMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - minAgeMs);
  const candidates = await tors(db)
    .find({ "pipeline.state": "queued", createdAt: { $lte: cutoff } })
    .project({ _id: 1 })
    .toArray();

  let requeued = 0;
  for (const candidate of candidates) {
    const torId = candidate._id.toString();
    const live = await jobs(db).countDocuments({ torId, state: { $in: ["pending", "running"] } });
    if (live > 0) continue;
    await queue.enqueue(torId);
    requeued += 1;
  }
  return requeued;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- reconcile`
Expected: 3 passing.

- [ ] **Step 5: Write the worker entry point**

Create `apps/api/src/workers/extract.worker.ts`:

```typescript
import { loadConfig } from "../core/config.js";
import { connect, ensureIndexes, tors } from "../core/db.js";
import { MongoQueue } from "../adapters/mongo.queue.js";
import { reconcileOrphanedRecords } from "./reconcile.js";
import { ObjectId } from "mongodb";

const config = loadConfig(process.env);

/**
 * Slice 1 ships a pass-through handler so the seam is exercised end to end
 * before Vertex AI is wired. Slice 2 replaces the body of this function with
 * the extraction service; nothing around it changes.
 */
async function handle(torId: string, db: Awaited<ReturnType<typeof connect>>): Promise<void> {
  await tors(db).updateOne(
    { _id: new ObjectId(torId) },
    { $set: { "pipeline.state": "published", updatedAt: new Date() } },
  );
}

async function main(): Promise<void> {
  const db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  const queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });

  let lastReconcile = 0;
  console.log(JSON.stringify({ event: "worker_started", pollMs: config.jobPollMs }));

  for (;;) {
    if (Date.now() - lastReconcile > config.reconcileIntervalMs) {
      const requeued = await reconcileOrphanedRecords(db, queue, config.reconcileMinAgeMs);
      if (requeued > 0) console.log(JSON.stringify({ event: "reconciled", requeued }));
      lastReconcile = Date.now();
    }

    const job = await queue.claim();
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, config.jobPollMs));
      continue;
    }

    try {
      await handle(job.torId, db);
      await queue.complete(job.id);
      console.log(JSON.stringify({ event: "job_done", torId: job.torId }));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      const { willRetry } = await queue.fail(job.id, reason);
      // NFR-S5: the raw document stays in storage and the reason is recorded.
      if (!willRetry) {
        await tors(db).updateOne(
          { _id: new ObjectId(job.torId) },
          { $set: { "pipeline.state": "failed", "pipeline.failedReason": reason } },
        );
      }
      console.error(JSON.stringify({ event: "job_failed", torId: job.torId, willRetry }));
    }
  }
}

main().catch((error: Error) => {
  console.error(JSON.stringify({ event: "worker_crashed", message: error.message }));
  process.exit(1);
});
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers
git commit -m "feat(worker): add the extraction worker with an orphan reconciler"
```

---

## Task 12: TOR read API

What the admin screen reads. The source link is signed on demand and never stored; contact fields are redacted in one place.

**Files:**
- Create: `apps/api/src/modules/tors/tors.repository.ts`, `apps/api/src/modules/tors/tors.serializer.ts`, `apps/api/src/modules/tors/tors.serializer.test.ts`, `apps/api/src/modules/tors/tors.routes.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/server.ts`

- [ ] **Step 1: Write the failing serializer test**

Create `apps/api/src/modules/tors/tors.serializer.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { toPublicTor } from "./tors.serializer.js";

const document = {
  _id: { toString: () => "t1" },
  contentHash: "abc",
  storage: { bucket: "tor-raw", key: "abc", contentType: "application/pdf", bytes: 10 },
  sourceRefs: [{ route: "upload", submittedBy: "admin", submittedAt: new Date("2026-09-01") }],
  pipeline: { state: "queued", attempts: 0 },
  fields: {
    title: { raw: "จ้างเหมาบริการ", confidence: 0.9, verified: false },
    contact: { raw: "somchai@example.go.th 081-234-5678", confidence: 0.8, verified: false },
  },
  announcedAt: null,
  sourceUrl: null,
  unverified: true,
  statusHistory: [],
  access: { restricted: false },
  duplicateOf: null,
  createdAt: new Date("2026-09-01"),
  updatedAt: new Date("2026-09-01"),
};

describe("toPublicTor", () => {
  it("omits the contact field entirely (FR-B-5)", () => {
    const result = toPublicTor(document as never, "http://signed");
    expect(result.fields.contact).toBeUndefined();
    expect(result.fields.title.raw).toBe("จ้างเหมาบริการ");
  });

  it("exposes the signed document link it was given rather than a stored one", () => {
    const result = toPublicTor(document as never, "http://signed");
    expect(result.documentUrl).toBe("http://signed");
  });

  it("never exposes the storage key or bucket", () => {
    const serialized = JSON.stringify(toPublicTor(document as never, "http://signed"));
    expect(serialized).not.toContain("tor-raw");
  });

  it("marks an unverified record as unverified", () => {
    const result = toPublicTor(document as never, "http://signed");
    expect(result.unverified).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @tor-radar/api -- tors.serializer`
Expected: FAIL, cannot find module `./tors.serializer.js`.

- [ ] **Step 3: Write the serializer**

Create `apps/api/src/modules/tors/tors.serializer.ts`:

```typescript
import type { TorDocument } from "../../core/db.js";

/** Fields withheld from every response (FR-B-5, NFR-S2). */
const REDACTED_FIELDS = new Set(["contact"]);

export interface PublicTor {
  id: string;
  fields: Record<string, { raw: string; confidence: number; verified: boolean }>;
  announcedAt: string | null;
  sourceUrl: string | null;
  /** Signed at request time, never persisted (spec §5.8). */
  documentUrl: string;
  state: string;
  unverified: boolean;
  createdAt: string;
}

/**
 * The single point where a stored record becomes a response. Redaction lives
 * here so no route can omit it by accident.
 */
export function toPublicTor(
  document: TorDocument & { _id: { toString(): string } },
  documentUrl: string,
): PublicTor {
  const fields: PublicTor["fields"] = {};
  for (const [name, value] of Object.entries(document.fields)) {
    if (REDACTED_FIELDS.has(name)) continue;
    fields[name] = value as PublicTor["fields"][string];
  }

  return {
    id: document._id.toString(),
    fields,
    announcedAt: document.announcedAt ? document.announcedAt.toISOString() : null,
    sourceUrl: document.sourceUrl,
    documentUrl,
    state: document.pipeline.state,
    unverified: document.unverified,
    createdAt: document.createdAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @tor-radar/api -- tors.serializer`
Expected: 4 passing.

- [ ] **Step 5: Write the repository and routes**

Create `apps/api/src/modules/tors/tors.repository.ts`:

```typescript
import { ObjectId, type Db } from "mongodb";
import { tors, type TorDocument } from "../../core/db.js";

export type StoredTor = TorDocument & { _id: ObjectId };

export class TorsRepository {
  constructor(private readonly db: Db) {}

  /** Restricted records are excluded from every read path (FR-B-6). */
  async list(limit: number, skip: number): Promise<StoredTor[]> {
    return tors(this.db)
      .find({ "access.restricted": false })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray() as Promise<StoredTor[]>;
  }

  async count(): Promise<number> {
    return tors(this.db).countDocuments({ "access.restricted": false });
  }

  async byId(id: string): Promise<StoredTor | null> {
    if (!ObjectId.isValid(id)) return null;
    return tors(this.db).findOne({
      _id: new ObjectId(id),
      "access.restricted": false,
    }) as Promise<StoredTor | null>;
  }
}
```

Create `apps/api/src/modules/tors/tors.routes.ts`:

```typescript
import { Router } from "express";
import { z } from "zod";
import { NotFoundError } from "../../core/errors.js";
import { toPublicTor } from "./tors.serializer.js";
import type { TorsRepository } from "./tors.repository.js";
import type { Storage } from "../../ports/storage.port.js";

/** Primitives only, so no operator object can reach a query (spec §5.6). */
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  page: z.coerce.number().int().min(1).default(1),
});

export interface TorsRouterDeps {
  repository: TorsRepository;
  storage: Storage;
  signedUrlTtlSeconds: number;
}

export function buildTorsRouter(deps: TorsRouterDeps): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    const { limit, page } = listQuerySchema.parse(req.query);
    const documents = await deps.repository.list(limit, (page - 1) * limit);
    const total = await deps.repository.count();

    const items = await Promise.all(
      documents.map(async (document) =>
        toPublicTor(
          document,
          await deps.storage.signedUrl(document.storage.key, deps.signedUrlTtlSeconds),
        ),
      ),
    );
    res.json({ items, total, page, limit });
  });

  router.get("/:id", async (req, res) => {
    const document = await deps.repository.byId(req.params.id);
    if (!document) throw new NotFoundError("TOR not found");
    const url = await deps.storage.signedUrl(document.storage.key, deps.signedUrlTtlSeconds);
    res.json(toPublicTor(document, url));
  });

  return router;
}
```

- [ ] **Step 6: Wire everything in app.ts**

Replace `apps/api/src/app.ts`:

```typescript
import express from "express";
import type { Db } from "mongodb";
import { loadConfig } from "./core/config.js";
import { errorMiddleware } from "./core/errors.js";
import { MinioStorage } from "./adapters/minio.storage.js";
import { MongoQueue } from "./adapters/mongo.queue.js";
import { IntakeRepository } from "./modules/intake/intake.repository.js";
import { IntakeService } from "./modules/intake/intake.service.js";
import { buildIntakeRouter } from "./modules/intake/intake.routes.js";
import { TorsRepository } from "./modules/tors/tors.repository.js";
import { buildTorsRouter } from "./modules/tors/tors.routes.js";

/**
 * The one place adapters are chosen. Modules receive ports, never adapters,
 * so swapping MinIO for another store changes only this function.
 */
export function buildApp(db: Db) {
  const config = loadConfig(process.env);
  const storage = new MinioStorage(config.minio);
  const queue = new MongoQueue(db, {
    maxAttempts: config.jobMaxAttempts,
    backoffMs: config.jobBackoffMs,
    lockMs: config.jobLockMs,
  });

  const app = express();
  app.use(express.json({ limit: config.multipartMaxFieldBytes }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "tor-radar-api" });
  });

  app.use(
    "/api/v1/intake",
    buildIntakeRouter({
      service: new IntakeService(storage, queue, new IntakeRepository(db), {
        allowedMimeTypes: config.allowedMimeTypes,
        maxUploadBytes: config.maxUploadBytes,
      }),
      adminKeys: config.adminApiKeys,
      intakeKeys: config.intakeApiKeys,
      maxUploadBytes: config.maxUploadBytes,
      multipartMaxFiles: config.multipartMaxFiles,
      multipartMaxFieldBytes: config.multipartMaxFieldBytes,
      fetchLimits: {
        timeoutMs: config.fetchTimeoutMs,
        maxRedirects: config.fetchMaxRedirects,
        maxBytes: config.fetchMaxBytes,
      },
      rateLimitPerMinute: config.intakeRateLimit,
    }),
  );

  app.use(
    "/api/v1/tors",
    buildTorsRouter({
      repository: new TorsRepository(db),
      storage,
      signedUrlTtlSeconds: config.signedUrlTtlSeconds,
    }),
  );

  app.use(errorMiddleware);
  return app;
}
```

Replace `apps/api/src/server.ts`:

```typescript
import { loadConfig } from "./core/config.js";
import { connect, ensureIndexes } from "./core/db.js";
import { MinioStorage } from "./adapters/minio.storage.js";
import { buildApp } from "./app.js";

const config = loadConfig(process.env);

async function main(): Promise<void> {
  const db = await connect(config.mongoUrl);
  await ensureIndexes(db);
  await new MinioStorage(config.minio).ensureBucket();

  buildApp(db).listen(config.apiPort, () => {
    console.log(JSON.stringify({ event: "api_started", port: config.apiPort }));
  });
}

main().catch((error: Error) => {
  console.error(JSON.stringify({ event: "api_failed_to_start", message: error.message }));
  process.exit(1);
});
```

- [ ] **Step 7: Run the whole suite**

Run: `npm test -w @tor-radar/api`
Expected: every test from Tasks 2 to 12 passes.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/tors apps/api/src/app.ts apps/api/src/server.ts
git commit -m "feat(tors): add the read API with on-demand signed links and redaction"
```

---

## Task 13: Web design tokens and the admin upload screen

The mockups are ported by extracting their tokens and rebuilding components (D9), not by pasting markup. This screen is the first real data on a Thai page.

**Files:**
- Create: `apps/web/src/shared/styles/tokens.css`, `apps/web/src/shared/lib/api/client.ts`, `apps/web/src/shared/lib/api/tors.ts`, `apps/web/src/features/tor-upload/UploadForm.tsx`, `apps/web/src/features/tor-upload/UploadForm.module.css`, `apps/web/src/views/UploadView.tsx`, `apps/web/app/(admin)/layout.tsx`, `apps/web/app/(admin)/upload/page.tsx`
- Reference: `mockups/TOR Radar App.dc.html` for the exact values

- [ ] **Step 1: Extract the tokens**

Create `apps/web/src/shared/styles/tokens.css`. Values are lifted verbatim from the mockup so the design is unchanged; nothing else in the codebase may hard-code a colour:

```css
:root {
  --paper: #fbfaf6;
  --card: #ffffff;
  --tint: #f2efe7;
  --line: #e3e0d6;
  --ink: #20252d;
  --soft: #5a6472;
  --gold: #a87e2f;
  --teal: #216a63;
  --warn: #9e4a3c;
  --mark-a: #0e8a74;
  --mark-b: #b8842d;

  --font-thai: "IBM Plex Sans Thai", "Anuphan", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 16px;
  --space-4: 24px;
  --space-5: 32px;
  --radius: 10px;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: var(--font-thai);
}

* {
  box-sizing: border-box;
}
```

- [ ] **Step 2: Write the API client**

Create `apps/web/src/shared/lib/api/client.ts`:

```typescript
/** No literal host anywhere: the base URL comes from the environment (NFR-S7). */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? `คำขอไม่สำเร็จ (${response.status})`);
  }
  return (await response.json()) as T;
}
```

Create `apps/web/src/shared/lib/api/tors.ts`:

```typescript
import { apiFetch } from "./client.js";

export interface TorListItem {
  id: string;
  fields: Record<string, { raw: string; confidence: number; verified: boolean }>;
  state: string;
  unverified: boolean;
  documentUrl: string;
  createdAt: string;
}

export function listTors(): Promise<{ items: TorListItem[]; total: number }> {
  return apiFetch("/api/v1/tors?limit=20&page=1");
}
```

- [ ] **Step 3: Write the upload feature**

Create `apps/web/src/features/tor-upload/UploadForm.module.css`:

```css
.form {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  max-width: 560px;
}

.button {
  padding: var(--space-2) var(--space-4);
  background: var(--teal);
  color: var(--card);
  border: 0;
  border-radius: var(--radius);
  font-family: var(--font-thai);
  cursor: pointer;
}

.button:disabled {
  background: var(--soft);
  cursor: progress;
}

.error {
  color: var(--warn);
}

.result {
  font-family: var(--font-mono);
  color: var(--soft);
}
```

Create `apps/web/src/features/tor-upload/UploadForm.tsx`:

```tsx
"use client";

import { useState } from "react";
import styles from "./UploadForm.module.css";

interface UploadResult {
  torId: string;
  duplicate: boolean;
}

export function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);

    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/upload", { method: "POST", body: form });
      if (!response.ok) throw new Error("อัปโหลดไม่สำเร็จ");
      setResult((await response.json()) as UploadResult);
      onUploaded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เกิดข้อผิดพลาด");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <label htmlFor="file">เลือกไฟล์ TOR (PDF, JPG หรือ PNG)</label>
      <input id="file" name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required />
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? "กำลังส่ง…" : "ส่งเอกสาร"}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
      {result ? (
        <p className={styles.result}>
          {result.duplicate ? "เอกสารนี้มีอยู่แล้ว" : "รับเอกสารแล้ว"} · {result.torId}
        </p>
      ) : null}
    </form>
  );
}
```

- [ ] **Step 4: Write the view and the routes**

Create `apps/web/src/views/UploadView.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { UploadForm } from "../features/tor-upload/UploadForm.js";
import { listTors, type TorListItem } from "../shared/lib/api/tors.js";

export function UploadView() {
  const [items, setItems] = useState<TorListItem[]>([]);

  const refresh = useCallback(() => {
    listTors()
      .then((response) => setItems(response.items))
      .catch(() => setItems([]));
  }, []);

  useEffect(refresh, [refresh]);

  return (
    <main style={{ padding: "var(--space-5)", display: "grid", gap: "var(--space-5)" }}>
      <h1>นำเข้าเอกสาร TOR</h1>
      <UploadForm onUploaded={refresh} />
      <section>
        <h2>เอกสารล่าสุด</h2>
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              {item.fields.title?.raw ?? "(ยังไม่ได้อ่านข้อมูล)"} — {item.state}
              {item.unverified ? " · ยังไม่ตรวจสอบ" : ""}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
```

Create `apps/web/app/(admin)/layout.tsx`:

```tsx
import "../../src/shared/styles/tokens.css";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
```

Create `apps/web/app/(admin)/upload/page.tsx`:

```tsx
export { UploadView as default } from "../../../src/views/UploadView.js";
```

Create `apps/web/app/api/admin/upload/route.ts`, which holds the admin key server-side so it never reaches the browser:

```typescript
import { NextResponse } from "next/server";

/** The admin key stays on the server; the browser never sees it. */
export async function POST(request: Request): Promise<Response> {
  const body = await request.formData();
  const response = await fetch(`${process.env.API_URL}/api/v1/intake/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.ADMIN_API_KEY}` },
    body,
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
```

- [ ] **Step 5: Verify the build**

Run: `npm run build -w @tor-radar/web`
Expected: build succeeds with no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src apps/web/app
git commit -m "feat(web): add design tokens and the admin upload screen"
```

---

## Task 14: Workspace-aware images

The skeleton's Dockerfiles copy one application manifest and run `npm install`, which cannot resolve a workspace dependency and ignores the root lockfile. Both images are rebuilt.

**Files:**
- Modify: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/web/next.config.ts`, `packages/shared/package.json`, `packages/shared/tsconfig.json`

- [ ] **Step 1: Give the shared package a build**

The API compiles to JavaScript, so the package it imports must ship JavaScript too. Replace `packages/shared/package.json`:

```json
{
  "name": "@tor-radar/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "prepare": "npm run build"
  },
  "dependencies": {
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "typescript": "^5.9.2"
  }
}
```

Create `packages/shared/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true
  },
  "include": ["src"]
}
```

Run: `npm install`
Expected: `packages/shared/dist/index.js` exists, because `prepare` runs on install.

- [ ] **Step 2: Set the tracing root before the web image can be correct**

Replace `apps/web/next.config.ts`:

```typescript
import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /**
   * Next traces from the project directory by default and silently excludes
   * anything outside it, which would drop @tor-radar/shared from the bundle
   * with no build error. Tracing from the repo root also moves the emitted
   * server to .next/standalone/apps/web/server.js.
   */
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),
};

export default nextConfig;
```

- [ ] **Step 3: Replace the API Dockerfile**

```dockerfile
# Build context is the repo root (see docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /repo

# Manifests first, so a dependency change is the only thing that busts the layer.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
RUN npm ci

COPY apps/api apps/api
RUN npm run build -w @tor-radar/api

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY --from=build /repo/packages/shared/dist packages/shared/dist
RUN npm ci --omit=dev --ignore-scripts

COPY --from=build /repo/apps/api/dist apps/api/dist

USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
```

- [ ] **Step 4: Replace the web Dockerfile**

```dockerfile
# Build context is the repo root (see docker-compose.yml).
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/shared/src packages/shared/src
RUN npm ci

COPY apps/web apps/web
RUN npm run build -w @tor-radar/web

FROM node:22-alpine AS runtime
WORKDIR /repo
ENV NODE_ENV=production

# outputFileTracingRoot puts the server at apps/web/server.js inside standalone.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
```

- [ ] **Step 5: Confirm the API build script exists**

Check `apps/api/package.json` contains `"build": "tsc -p tsconfig.json"` and that `apps/api/tsconfig.json` sets `"outDir": "dist"`. Add them if absent.

- [ ] **Step 6: Build both images**

Run: `docker compose build`
Expected: both images build. If the web build reports a missing `@tor-radar/shared`, the tracing root is wrong — do not work around it by copying node_modules.

- [ ] **Step 7: Commit**

```bash
git add apps/api/Dockerfile apps/web/Dockerfile apps/web/next.config.ts packages/shared
git commit -m "build: make both images workspace-aware and compile the api"
```

---

## Task 15: Compose services and CI

**Files:**
- Modify: `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`

- [ ] **Step 1: Replace docker-compose.yml**

```yaml
name: tor-radar

x-storage-env: &storage-env
  MONGO_URL: mongodb://mongo:27017/tor_radar
  MINIO_ENDPOINT: minio
  MINIO_PORT: 9000
  MINIO_ACCESS_KEY: ${MINIO_ROOT_USER:-minioadmin}
  MINIO_SECRET_KEY: ${MINIO_ROOT_PASSWORD:-change-me-in-local-env}
  MINIO_BUCKET: ${MINIO_BUCKET:-tor-raw}
  MINIO_PUBLIC_URL: ${MINIO_PUBLIC_URL:-http://localhost:9000}
  INTAKE_API_KEYS: ${INTAKE_API_KEYS:-dev-intake-key}
  ADMIN_API_KEYS: ${ADMIN_API_KEYS:-dev-admin-key}

services:
  web:
    container_name: tor-radar-web
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "${WEB_PORT:-3000}:3000"
    environment:
      NEXT_PUBLIC_API_URL: ${PUBLIC_API_URL:-http://localhost:4000}
      API_URL: http://api:4000
      ADMIN_API_KEY: ${ADMIN_API_KEYS:-dev-admin-key}
    depends_on:
      api:
        condition: service_healthy

  api:
    container_name: tor-radar-api
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    ports:
      - "${API_PORT:-4000}:4000"
    environment:
      <<: *storage-env
      API_PORT: 4000
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 10s
    depends_on:
      mongo:
        condition: service_healthy
      minio:
        condition: service_healthy

  # The worker shares the api image and differs only by command, so restarting
  # the api cannot interrupt a job in flight.
  worker:
    container_name: tor-radar-worker
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    command: ["node", "apps/api/dist/workers/extract.worker.js"]
    environment:
      <<: *storage-env
    depends_on:
      mongo:
        condition: service_healthy
      minio:
        condition: service_healthy

  mongo:
    container_name: tor-radar-mongo
    image: mongo:7
    ports:
      - "${MONGO_PORT:-27017}:27017"
    volumes:
      - tor-radar-mongo-data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5

  minio:
    container_name: tor-radar-minio
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "${MINIO_PORT:-9000}:9000"
      - "${MINIO_CONSOLE_PORT:-9001}:9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:-change-me-in-local-env}
    volumes:
      - tor-radar-minio-data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  tor-radar-mongo-data:
  tor-radar-minio-data:
```

- [ ] **Step 2: Update .env.example**

Append to `.env.example`:

```bash
# --- Access control (NFR-S1). Generate real values for any deployed environment. ---
INTAKE_API_KEYS=dev-intake-key
ADMIN_API_KEYS=dev-admin-key

# --- Storage, two endpoints ---
# MINIO_ENDPOINT is internal to the compose network; MINIO_PUBLIC_URL is what a
# browser can resolve. A URL signed with the internal endpoint reaches nothing.
MINIO_PUBLIC_URL=http://localhost:9000
SIGNED_URL_TTL_SECONDS=300

# --- Queue and reconciler ---
JOB_MAX_ATTEMPTS=5
JOB_BACKOFF_MS=30000
JOB_LOCK_MS=120000
JOB_POLL_MS=2000
RECONCILE_INTERVAL_MS=60000
RECONCILE_MIN_AGE_MS=120000
```

- [ ] **Step 3: Add the dependency audit to CI**

Replace the steps block in `.github/workflows/ci.yml`:

```yaml
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
      # NFR-S1: the build audits its dependencies.
      - run: npm audit --audit-level=high
```

- [ ] **Step 4: Verify the stack starts**

Run: `docker compose up -d`
Run: `docker compose ps`
Expected: five containers named `tor-radar-web`, `tor-radar-api`, `tor-radar-worker`, `tor-radar-mongo`, `tor-radar-minio`; mongo and minio report healthy.

Run: `docker compose logs worker | head -5`
Expected: a `worker_started` line.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example .github/workflows/ci.yml
git commit -m "build: add the worker service, health gates, named containers and the CI audit"
```

---

## Task 16: Live verification and documentation

Unit tests passing is not evidence the requirement is met. This task runs the F1 acceptance criteria from SRS §6 against the running stack.

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-09-01-tor-radar-foundation-intake-design.md`

- [ ] **Step 1: Prove upload, dedupe, and immutability**

Run:

```bash
docker compose up -d
curl -s -o /tmp/sample.pdf https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf
curl -si -X POST http://localhost:4000/api/v1/intake/upload \
  -H "authorization: Bearer dev-admin-key" -F "file=@/tmp/sample.pdf" | head -1
curl -si -X POST http://localhost:4000/api/v1/intake/upload \
  -H "authorization: Bearer dev-admin-key" -F "file=@/tmp/sample.pdf" | head -1
```

Expected: the first responds `202`, the second `200` with `"duplicate":true`.

Run: `docker compose exec mongo mongosh tor_radar --quiet --eval 'db.tors.countDocuments()'`
Expected: `1` — one record with two source references.

- [ ] **Step 2: Prove the API refuses an unauthenticated caller**

Run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/v1/intake -F "file=@/tmp/sample.pdf"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/v1/intake/upload -F "file=@/tmp/sample.pdf"
```

Expected: `401` for both.

- [ ] **Step 3: Prove the SSRF controls hold against the running server**

Run:

```bash
curl -s -X POST http://localhost:4000/api/v1/intake/url \
  -H "authorization: Bearer dev-admin-key" -H "content-type: application/json" \
  -d '{"url":"http://169.254.169.254/latest/meta-data/"}'
curl -s -X POST http://localhost:4000/api/v1/intake/url \
  -H "authorization: Bearer dev-admin-key" -H "content-type: application/json" \
  -d '{"url":"http://minio:9000/tor-raw"}'
```

Expected: both return `400` with a `bad_request` code. Neither reaches the target.

- [ ] **Step 4: Prove the browser can actually open the document link**

Run: `curl -s http://localhost:4000/api/v1/tors | head -c 400`

Take the `documentUrl` from the response and run `curl -sI "<documentUrl>" | head -1`.
Expected: `HTTP/1.1 200 OK`. If this fails with a DNS error, the URL was signed with the internal endpoint — the exact bug §5.8 exists to prevent.

- [ ] **Step 5: Prove documents survive a restart**

Run:

```bash
docker compose down
docker compose up -d
docker compose exec mongo mongosh tor_radar --quiet --eval 'db.tors.countDocuments()'
```

Expected: `1`. Named volumes survive `down`; only `down -v` removes them.

- [ ] **Step 6: Prove the screen shows the real record**

Open `http://localhost:3000/upload`, submit a TOR, and confirm the record appears in the list below the form with state `published` once the worker has processed it.

- [ ] **Step 7: Update the documentation**

In `README.md`, replace the Layout section with the structure from the design §3.1 and add the four enforcement rules. In the design spec, amend §5.6 to say uploads are read with a hard byte bound rather than streamed, per the plan header.

- [ ] **Step 8: Commit**

```bash
git add README.md docs/superpowers/specs
git commit -m "docs: record the verified slice-1 behaviour and amend the upload wording"
```

---

## Self-Review

**Spec coverage.** FR-A-1 is Task 10 (three routes into one service). FR-A-2 is Task 6 (`putIfAbsent`, no `put` on the interface). FR-A-3 is Tasks 3, 8, 9 (hash, unique index, duplicate-key path). NFR-S5 is Task 11 (failure keeps the document and records the reason). NFR-S7 is Task 2 and enforced by every later task reading config. Spec §5.6 is Tasks 4, 5, 10, 12. Spec §5.7 is Tasks 14 and 15. Spec §5.8 is Tasks 6, 12, 15, and verified in Task 16 step 4. Spec §4.5 indexes are Task 7.

**Not covered by design, deliberately.** The `sources` collection is defined in the spec but written from slice 2, so no task creates it. `announcedAt` and `sourceUrl` exist on the record and are indexed, but only `sourceUrl` is populated in slice 1 — `announcedAt` is extracted in slice 2.

**Consistency check performed.** `Storage`, `Queue`, `IntakeRepository`, and `IntakeService` signatures used in Tasks 9 to 12 match their definitions in Tasks 6, 7, 8, 9. `loadConfig` returns every field the later tasks read, including `adminApiKeys`, `reconcileIntervalMs`, and `reconcileMinAgeMs`. The queue interface gained an idempotency guarantee in Task 7 that Task 11's reconciler depends on.

**Known amendment.** The plan header records that spec §5.6's "streamed to storage" wording is not achievable with content-addressed keys; Task 16 step 7 corrects the spec.
