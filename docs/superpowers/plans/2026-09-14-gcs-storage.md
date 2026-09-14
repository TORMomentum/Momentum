# Object Storage on Google Cloud Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the MinIO adapter with Google Cloud Storage behind the existing `Storage` port, and deliver original documents by streaming them through the API and Next — never by signed link.

**Architecture:** A `GcsStorage` adapter implements the port with a checksummed, generation-conditioned write. Two pure helpers (`byte-range`, `content-disposition`) and one Express helper (`streamDocument`) give both document routes an identical `GET`/`HEAD`/`Range` contract with `nosniff` and `no-store`. Next route handlers proxy the stream so the browser only ever talks to its own origin. `fake-gcs-server` replaces MinIO in Compose and CI.

**Tech Stack:** Node 24 · TypeScript · Express 5 · `@google-cloud/storage` · Next.js 16 route handlers · Vitest + supertest · Docker Compose · `fsouza/fake-gcs-server`

**Spec:** [`docs/superpowers/specs/2026-09-14-object-storage-gcs-design.md`](../specs/2026-09-14-object-storage-gcs-design.md) — revision 3. Section numbers below (`§5.4`) refer to it.

---

## How this plan lands

The spec (§8) forbids a tree that is half on each design. Every task commits **on the branch
`feat/gcs-storage`**; the branch reaches `main` as **one squash-merge** in Task 15, only after live
verification. `main` therefore never sees an intermediate state.

**Gates, each as its own command — never chained into a commit:**

```bash
npm run lint
npx tsc --noEmit -p apps/api/tsconfig.json
npx tsc --noEmit -p apps/web/tsconfig.json
npm test
```

Integration tests need the stack: `docker compose up -d mongo gcs` (from Task 6 on).

## File map

| File | Status | Responsibility |
| :--- | :--- | :--- |
| `apps/api/src/lib/byte-range.ts` | create | Parse a `Range` header against an object size (§5.4) |
| `apps/api/src/lib/content-disposition.ts` | create | Allowlist `?disposition=` and build a safe header (§5.2–5.3) |
| `apps/api/src/lib/stream-document.ts` | create | The one `GET`/`HEAD`/range streaming contract (§5.3–5.5) |
| `apps/api/src/adapters/gcs.storage.ts` | create | `Storage` on Google Cloud Storage (§4.1–4.3) |
| `apps/api/src/adapters/storage.factory.ts` | create | The single place storage is constructed (§4.5) |
| `apps/api/src/ports/storage.port.ts` | modify | Drop `signedUrl`; add a range to `getStream` (§4) |
| `apps/api/src/core/errors.ts` | modify | Add `ServiceUnavailableError` (503) |
| `apps/api/src/core/config.ts` | modify | Add `GCS_*` and two timeouts; remove `MINIO_*`, `SIGNED_URL_TTL_SECONDS` |
| `apps/api/src/modules/intake/intake.repository.ts`, `intake.service.ts` | modify | Persist `originalFilename` on the source reference |
| `packages/shared/src/tor.ts` | modify | `SourceRef.originalFilename?` |
| `apps/api/src/modules/tors/*`, `apps/api/src/modules/admin/*` | modify | Document routes stream; services return what to stream |
| `apps/api/src/app.ts`, `apps/api/src/workers/extract.worker.ts` | modify | Use the factory |
| `apps/api/src/adapters/minio.storage.ts` + test | delete | |
| `apps/web/app/(app)/tors/[id]/document/route.ts` | create | Public stream proxy |
| `apps/web/app/(app)/admin/tors/[id]/document/route.ts` | create | Staff stream proxy |
| `apps/web/src/shared/api/document-proxy.ts` | create | Shared proxy logic for both handlers |
| `apps/web/src/shared/api/tors.api.ts`, `shared/lib/admin-api.ts` | modify | Remove signed-URL fetchers (no replacement — the proxy is the only path) |
| `apps/web/app/(app)/tors/[id]/page.tsx`, `admin/review/page.tsx`, both views | modify | Point viewer and button at the proxy routes |
| `tools/seed_review_queue.mjs` | modify | Upload through the GCS client |
| `apps/api/src/adapters/gcs.storage.real.test.ts` | create | Real-bucket suite, credential-gated (§7) |
| `.github/workflows/gcs-real.yml` | create | Manually triggered real-bucket job |
| `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example` | modify | Emulator replaces MinIO |
| `CLAUDE.md`, `docs/API.md`, `docs/ARCHITECTURE.md`, rendering spec | modify | §10 |

---

### Task 0: Branch and baseline

- [ ] **Step 1: Branch from a clean, green `main`**

```bash
git switch main && git pull --ff-only
git status --short          # expected: empty
git switch -c feat/gcs-storage
```

- [ ] **Step 2: Record the baseline**

Run the four gates. Expected: lint clean, both `tsc` clean, `205 passed | 6 skipped`. If the count
differs, stop and report — the plan's later counts assume this baseline.

---

### Task 1: Byte-range parser

**Files:**
- Create: `apps/api/src/lib/byte-range.ts`
- Test: `apps/api/src/lib/byte-range.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { parseRange } from "./byte-range.js";

const SIZE = 1000;

describe("parseRange", () => {
  it("serves the whole object when there is no Range header", () => {
    expect(parseRange(undefined, SIZE)).toEqual({ kind: "full" });
  });

  it("parses a closed range", () => {
    expect(parseRange("bytes=0-99", SIZE)).toEqual({ kind: "partial", start: 0, end: 99 });
  });

  it("parses an open-ended range to the last byte", () => {
    expect(parseRange("bytes=900-", SIZE)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("parses a suffix range as the last n bytes", () => {
    expect(parseRange("bytes=-100", SIZE)).toEqual({ kind: "partial", start: 900, end: 999 });
  });

  it("clamps a suffix longer than the object to the whole object", () => {
    expect(parseRange("bytes=-5000", SIZE)).toEqual({ kind: "partial", start: 0, end: 999 });
  });

  it("clamps an end past the object to the last byte", () => {
    expect(parseRange("bytes=500-99999", SIZE)).toEqual({ kind: "partial", start: 500, end: 999 });
  });

  it("is unsatisfiable when the start is at or beyond the end", () => {
    expect(parseRange("bytes=1000-", SIZE)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=5000-6000", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("is unsatisfiable for a zero-length suffix", () => {
    expect(parseRange("bytes=-0", SIZE)).toEqual({ kind: "unsatisfiable" });
  });

  it("ignores multiple ranges and serves the whole object (RFC 9110 permits this)", () => {
    expect(parseRange("bytes=0-10,20-30", SIZE)).toEqual({ kind: "full" });
  });

  it("ignores malformed ranges and serves the whole object", () => {
    expect(parseRange("bytes=abc", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("items=0-10", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("bytes=-", SIZE)).toEqual({ kind: "full" });
    expect(parseRange("bytes=50-10", SIZE)).toEqual({ kind: "full" });
  });

  it("treats any range on an empty object as unsatisfiable", () => {
    expect(parseRange("bytes=0-10", 0)).toEqual({ kind: "unsatisfiable" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/api/src/lib/byte-range.test.ts`
Expected: FAIL — cannot resolve `./byte-range.js`.

- [ ] **Step 3: Implement**

```ts
/**
 * One `Range` header against one object size (RFC 9110 §14).
 *
 * Only a single byte range is honoured. Multiple or malformed ranges are
 * IGNORED and the whole object is served — the RFC permits a server to ignore
 * Range, and doing so is safer than trying to answer a multipart/byteranges
 * request nobody here needs. A PDF viewer asks for one range at a time.
 */
export type RangeResult =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: "full" };

  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return { kind: "full" };

  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return { kind: "full" };
  if (size === 0) return { kind: "unsatisfiable" };

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  if (start >= size) return { kind: "unsatisfiable" };

  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (end < start) return { kind: "full" };

  return { kind: "partial", start, end };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `npx vitest run apps/api/src/lib/byte-range.test.ts` — Expected: 11 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/byte-range.ts apps/api/src/lib/byte-range.test.ts
git commit -m "feat(api): parse a single byte range against an object size"
```

---

### Task 2: Content-Disposition

**Files:**
- Create: `apps/api/src/lib/content-disposition.ts`
- Test: `apps/api/src/lib/content-disposition.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { contentDisposition, parseDisposition } from "./content-disposition.js";

describe("parseDisposition", () => {
  it("defaults to attachment when absent", () => {
    expect(parseDisposition(undefined)).toBe("attachment");
  });
  it("accepts the two allowlisted values", () => {
    expect(parseDisposition("inline")).toBe("inline");
    expect(parseDisposition("attachment")).toBe("attachment");
  });
  it("rejects anything else, including arrays from repeated query keys", () => {
    expect(parseDisposition("INLINE")).toBeNull();
    expect(parseDisposition("download")).toBeNull();
    expect(parseDisposition(["inline", "attachment"])).toBeNull();
  });
});

describe("contentDisposition", () => {
  it("is bare inline for the in-app viewer", () => {
    expect(contentDisposition("inline", "anything.pdf")).toBe("inline");
  });

  it("encodes a Thai filename with filename* and an ASCII fallback", () => {
    const header = contentDisposition("attachment", "ประกาศ.pdf");
    expect(header).toBe(
      `attachment; filename="______.pdf"; filename*=UTF-8''%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B8%81%E0%B8%B2%E0%B8%A8.pdf`,
    );
  });

  it("cannot be broken out of by quotes, CR/LF, or path separators", () => {
    const header = contentDisposition("attachment", 'evil"\r\nX-Injected: 1/../a.pdf');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).not.toContain('evil"');
    expect(header).not.toContain("/");
  });

  it("percent-encodes the RFC 5987 characters encodeURIComponent leaves alone", () => {
    expect(contentDisposition("attachment", "a'b(c)*.pdf")).toContain("filename*=UTF-8''a%27b%28c%29%2A.pdf");
  });

  it("falls back to 'document' for an empty name", () => {
    expect(contentDisposition("attachment", "")).toContain('filename="document"');
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run apps/api/src/lib/content-disposition.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * The download header for an original document (spec §5.2–5.3).
 *
 * The filename is a submitter-controlled string going into a response header,
 * so it is treated as hostile: control characters, quotes, backslashes and path
 * separators are replaced before it is used, and the non-ASCII form travels only
 * in RFC 5987 `filename*`, never raw.
 */
export type Disposition = "inline" | "attachment";

const MAX_NAME_LENGTH = 200;

export function parseDisposition(value: unknown): Disposition | null {
  if (value === undefined) return "attachment";
  return value === "inline" || value === "attachment" ? value : null;
}

function rfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function contentDisposition(kind: Disposition, filename: string): string {
  if (kind === "inline") return "inline";

  const safe =
    filename.replace(/[ -"\\/]/g, "_").slice(0, MAX_NAME_LENGTH) || "document";
  const asciiFallback = safe.replace(/[^\x20-\x7e]/g, "_");

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${rfc5987(safe)}`;
}
```

- [ ] **Step 4: Run it and confirm it passes** — Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/content-disposition.ts apps/api/src/lib/content-disposition.test.ts
git commit -m "feat(api): allowlist disposition and build a header a filename cannot break"
```

---

### Task 3: Persist the original filename on the source reference

The download filename must come from the record, not storage metadata (§5.3). Today the filename
reaches storage metadata only.

**Files:**
- Modify: `packages/shared/src/tor.ts` (`SourceRef`)
- Modify: `apps/api/src/core/db.ts` (`TorDocument.sourceRefs` element type)
- Modify: `apps/api/src/modules/intake/intake.repository.ts:6-11` (`SourceRefInput`)
- Modify: `apps/api/src/modules/intake/intake.service.ts:66-71`
- Test: `apps/api/src/modules/intake/intake.service.test.ts`

- [ ] **Step 1: Write the failing test** — add to `intake.service.test.ts`. The service signature is
  `submit(bytes, source)`, the file's PDF buffer is `pdf`, and the repository fake's `insert` is a plain
  function, not a mock. Make that fake record its third argument (`source`) into an array the test can read
  — e.g. `insertedSources.push(source)` — then:

```ts
it("records the submitted filename on the source reference", async () => {
  await service.submit(pdf, { ...uploadSource, filename: "ประกาศจ้างเหมา.pdf" });

  expect(insertedSources[0]).toMatchObject({ originalFilename: "ประกาศจ้างเหมา.pdf" });
});
```

`uploadSource` stands for whichever upload source object the file already builds; read the top of the
file first and use its real name.

- [ ] **Step 2: Run it** — `npx vitest run apps/api/src/modules/intake/intake.service.test.ts`.
  Expected: FAIL — `originalFilename` absent.

- [ ] **Step 3: Implement**

In `packages/shared/src/tor.ts`, add to `SourceRef`:

```ts
  /** As submitted, percent-free and unencoded. Used for the download filename (spec §5.3). */
  originalFilename?: string;
```

In `intake.repository.ts`, add the same optional field to `SourceRefInput`, and in `core/db.ts` to the
persisted source-reference type inside `TorDocument` (Task 9 reads it back from there). In `intake.service.ts`,
set it where `sourceRef` is built:

```ts
    const sourceRef: SourceRefInput = {
      route: source.route,
      url: source.url,
      submittedBy: source.submittedBy,
      submittedAt: new Date(),
      ...(source.filename ? { originalFilename: source.filename } : {}),
    };
```

Rebuild shared: `npm run build --workspace packages/shared`.

- [ ] **Step 4: Run the intake tests and the full suite** — expected all green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/tor.ts apps/api/src/modules/intake/
git commit -m "feat(intake): keep the submitted filename on the source reference"
```

---

### Task 4: Configuration for Google Cloud Storage

MinIO settings stay until the swap (Task 9); this task only **adds**.

**Files:**
- Modify: `apps/api/src/core/config.ts`
- Test: `apps/api/src/core/config.test.ts`

- [ ] **Step 1: Write the failing tests** — add to `config.test.ts`:

```ts
it("reads the storage bucket, endpoint and both timeouts", () => {
  const config = loadConfig({ ...base, GCS_BUCKET: "tor-originals", GCS_API_ENDPOINT: "http://gcs:4443" });
  expect(config.gcs.bucket).toBe("tor-originals");
  expect(config.gcs.apiEndpoint).toBe("http://gcs:4443");
  expect(config.gcs.timeoutApiMs).toBe(10_000);
  expect(config.gcs.timeoutWorkerMs).toBe(60_000);
});

it("requires dedicated storage credentials and a project when not using the emulator", () => {
  const { GCS_API_ENDPOINT: _emulator, ...real } = base;
  expect(() => loadConfig({ ...real, GCS_BUCKET: "tor-originals" })).toThrow(/GCS_CREDENTIALS/);
  expect(() =>
    loadConfig({ ...real, GCS_BUCKET: "tor-originals", GCS_CREDENTIALS: "/secrets/storage.json" }),
  ).toThrow(/GOOGLE_CLOUD_PROJECT/);
});

it("refuses the emulator endpoint in production", () => {
  expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(/GCS_API_ENDPOINT/);
});

it("never falls back to the Vertex AI credential for storage", () => {
  const config = loadConfig({
    ...base,
    GCS_BUCKET: "tor-originals",
    GCS_CREDENTIALS: "/secrets/storage.json",
    GOOGLE_APPLICATION_CREDENTIALS: "/secrets/vertex.json",
  });
  expect(config.gcs.credentialsPath).toBe("/secrets/storage.json");
});
```

- [ ] **Step 2: Run** — `npx vitest run apps/api/src/core/config.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — in the schema, under a `// Storage — Google Cloud Storage (spec §6)` comment:

```ts
  GCS_BUCKET: z.string().min(1),
  /** Set only for fake-gcs-server. Unset in deployment. */
  GCS_API_ENDPOINT: z.url().optional(),
  /**
   * The DEDICATED storage service account's key file. Deliberately not
   * GOOGLE_APPLICATION_CREDENTIALS: that is Vertex AI's identity, and the Google
   * client would silently adopt it if this were left to application-default
   * credentials — giving one compromised key both powers.
   */
  GCS_CREDENTIALS: z.string().min(1).optional(),
  STORAGE_TIMEOUT_API_MS: z.coerce.number().int().positive().default(10_000),
  STORAGE_TIMEOUT_WORKER_MS: z.coerce.number().int().positive().default(60_000),
```

Add these refinements after the existing one (if the schema has no `NODE_ENV`, add
`NODE_ENV: z.enum(["development", "test", "production"]).default("development")` first):

```ts
.refine((v) => !(v.NODE_ENV === "production" && v.GCS_API_ENDPOINT), {
  message: "GCS_API_ENDPOINT is for the emulator only and must be unset in production",
  path: ["GCS_API_ENDPOINT"],
})
.refine((v) => Boolean(v.GCS_API_ENDPOINT) || Boolean(v.GCS_CREDENTIALS), {
  message: "GCS_CREDENTIALS is required unless GCS_API_ENDPOINT points at the emulator",
  path: ["GCS_CREDENTIALS"],
})
.refine((v) => Boolean(v.GCS_API_ENDPOINT) || Boolean(v.GOOGLE_CLOUD_PROJECT), {
  message: "GOOGLE_CLOUD_PROJECT is required unless GCS_API_ENDPOINT points at the emulator",
  path: ["GOOGLE_CLOUD_PROJECT"],
})
```

Add to `Config` and to the returned object:

```ts
  gcs: {
    bucket: string;
    apiEndpoint?: string;
    credentialsPath?: string;
    projectId?: string;
    timeoutApiMs: number;
    timeoutWorkerMs: number;
  };
```

```ts
    gcs: {
      bucket: parsed.GCS_BUCKET,
      apiEndpoint: parsed.GCS_API_ENDPOINT,
      credentialsPath: parsed.GCS_CREDENTIALS,
      projectId: parsed.GOOGLE_CLOUD_PROJECT,
      timeoutApiMs: parsed.STORAGE_TIMEOUT_API_MS,
      timeoutWorkerMs: parsed.STORAGE_TIMEOUT_WORKER_MS,
    },
```

Add `GCS_BUCKET: "tor-raw"` and `GCS_API_ENDPOINT: "http://localhost:4443"` to the `base` fixture in
`config.test.ts`, and to `.env` (untracked) so the running app still starts.

- [ ] **Step 4: Run the config tests and the full suite** — expected green.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/core/config.ts apps/api/src/core/config.test.ts
git commit -m "feat(config): Google Cloud Storage settings, never borrowing Vertex AI's credential"
```

---

### Task 5: `ServiceUnavailableError`

**Files:** Modify `apps/api/src/core/errors.ts`

- [ ] **Step 1: Add**, after `PayloadTooLargeError`:

```ts
/** A dependency — object storage — did not answer. The caller may retry. */
export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(503, "service_unavailable", message);
  }
}
```

- [ ] **Step 2: Gates** — lint and api `tsc`.
- [ ] **Step 3: Commit** — `git commit -am "feat(api): a 503 error for an unavailable dependency"`

---

### Task 6: Emulator and client dependency

**Files:** Modify `docker-compose.yml`, `apps/api/package.json`

- [ ] **Step 1: Confirm the pinned emulator image exists upstream** — a cached local image proves
  nothing (the MinIO failure):

```bash
docker manifest inspect fsouza/fake-gcs-server:1.56.1 > /dev/null && echo EXISTS
```

Expected: `EXISTS`. If not, stop and report the available tags; do not use `latest`.

- [ ] **Step 2: Add the service** alongside `minio`, which Task 12 removes:

```yaml
  gcs:
    # Google Cloud Storage emulator for development and CI. Pinned: `latest`
    # resolves wherever it was pulled before and fails everywhere else, which is
    # exactly how the MinIO image broke CI. It does NOT validate signed-URL
    # signatures or checksums the way the real service does (spec §7) — the
    # real-bucket suite proves those.
    image: fsouza/fake-gcs-server:1.56.1
    command: ["-scheme", "http", "-port", "4443", "-backend", "filesystem", "-filesystem-root", "/data"]
    ports:
      - "${GCS_EMULATOR_PORT:-4443}:4443"
    volumes:
      - gcs_data:/data
```

Add `gcs_data:` under `volumes:`.

- [ ] **Step 3: Install the client, pinned exactly**

```bash
npm install --workspace apps/api --save-exact @google-cloud/storage@latest
grep '"@google-cloud/storage"' apps/api/package.json      # expected: an exact version, no ^ or ~
```

- [ ] **Step 4: Start and probe**

```bash
docker compose up -d gcs
curl -sf http://localhost:4443/storage/v1/b && echo UP
```

Expected: JSON then `UP`.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml apps/api/package.json package-lock.json
git commit -m "build: fake-gcs-server in compose, @google-cloud/storage pinned"
```

---

### Task 7: The `GcsStorage` adapter

**Files:**
- Create: `apps/api/src/adapters/gcs.storage.ts`
- Test: `apps/api/src/adapters/gcs.storage.test.ts`

This task adds the adapter **without** touching the port; it implements `putIfAbsent`, `exists`, and a
ranged `getStream`. The port itself changes in Task 9.

- [ ] **Step 1: Write the failing test** (emulator-backed)

```ts
import { createHash, randomUUID } from "node:crypto";
import { Storage as GcsClient } from "@google-cloud/storage";
import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../core/config.js";
import { GcsStorage } from "./gcs.storage.js";

const config = loadConfig(process.env);
const bucket = `${config.gcs.bucket}-adapter-test`;
const settings = {
  bucket,
  apiEndpoint: config.gcs.apiEndpoint,
  projectId: "emulator",
  timeoutMs: config.gcs.timeoutApiMs,
};
const storage = new GcsStorage(settings);

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  const client = new GcsClient({ apiEndpoint: config.gcs.apiEndpoint, projectId: "emulator" });
  const [exists] = await client.bucket(bucket).exists();
  if (!exists) await client.createBucket(bucket);
});

describe("GcsStorage (emulator)", () => {
  it("stores bytes, reports existence, and streams them back", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.7 hello");

    const stored = await storage.putIfAbsent(key, bytes, "application/pdf", { route: "upload" });

    expect(stored).toEqual({ bucket, key, contentType: "application/pdf", bytes: bytes.byteLength });
    expect(await storage.exists(key)).toBe(true);
    expect(await readAll(await storage.getStream(key))).toEqual(bytes);
  });

  it("returns the existing object when the same bytes are written twice", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.7 duplicate");

    await storage.putIfAbsent(key, bytes, "application/pdf");
    const second = await storage.putIfAbsent(key, bytes, "application/pdf");

    expect(second.bytes).toBe(bytes.byteLength);
    expect(await readAll(await storage.getStream(key))).toEqual(bytes);
  });

  it("refuses to treat different bytes at the same key as already stored", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    await storage.putIfAbsent(key, Buffer.from("%PDF-1.7 original"), "application/pdf");

    await expect(
      storage.putIfAbsent(key, Buffer.from("%PDF-1.7 different"), "application/pdf"),
    ).rejects.toThrow(/sha256/);
  });

  it("streams an inclusive byte range", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    await storage.putIfAbsent(key, Buffer.from("0123456789"), "application/pdf");

    expect((await readAll(await storage.getStream(key, { start: 2, end: 5 }))).toString()).toBe("2345");
  });

  it("answers false for a missing object and throws not-found when streaming it", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.getStream(key)).rejects.toMatchObject({ status: 404 });
  });

  it("stores the sha256 and an ASCII-safe filename as custom metadata", async () => {
    const key = `tors/test/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.7 thai name");
    await storage.putIfAbsent(key, bytes, "application/pdf", { originalFilename: "ประกาศ.pdf" });

    const client = new GcsClient({ apiEndpoint: config.gcs.apiEndpoint, projectId: "emulator" });
    const [meta] = await client.bucket(bucket).file(key).getMetadata();
    expect(meta.metadata?.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(String(meta.metadata?.originalFilename)).toMatch(/^[\x20-\x7e]*$/);
  });
});
```

- [ ] **Step 2: Run** — `docker compose up -d gcs` then `npx vitest run apps/api/src/adapters/gcs.storage.test.ts`.
  Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { createHash } from "node:crypto";
import { Storage as GcsClient, type File } from "@google-cloud/storage";
import { NotFoundError, ServiceUnavailableError } from "../core/errors.js";
import { encodeMetadataValue } from "../lib/metadata-header.js";
import type { StorageMetadata, StoredObject } from "../ports/storage.port.js";

export interface GcsSettings {
  bucket: string;
  apiEndpoint?: string;
  /** The dedicated storage account's key. Always passed explicitly — see config.ts. */
  keyFilename?: string;
  projectId?: string;
  timeoutMs: number;
}

const PRECONDITION_FAILED = 412;
const NOT_FOUND = 404;

function statusOf(error: unknown): number | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

/**
 * Originals on Google Cloud Storage (spec §4).
 *
 * The application's identity may create and read objects and nothing else, so
 * this adapter never deletes — not even to recover from a bad upload. That is
 * why integrity is checked BY THE SERVICE: the MD5 travels with the upload and
 * a mismatch is refused with 400 before any object exists. The client's own
 * post-upload validation stays off, because on a mismatch it deletes.
 */
export class GcsStorage {
  private readonly client: GcsClient;

  constructor(private readonly settings: GcsSettings) {
    this.client = new GcsClient({
      ...(settings.apiEndpoint ? { apiEndpoint: settings.apiEndpoint } : {}),
      ...(settings.keyFilename ? { keyFilename: settings.keyFilename } : {}),
      ...(settings.projectId ? { projectId: settings.projectId } : {}),
      retryOptions: {
        autoRetry: true,
        // @google-cloud/storage's RetryOptions.totalTimeout is in SECONDS (its
        // default is 600) — unlike gaxios's field of the same name. Confirm in
        // the installed build/cjs/src/storage.d.ts before trusting this.
        totalTimeout: Math.ceil(settings.timeoutMs / 1000),
      },
    });
  }

  private file(key: string): File {
    return this.client.bucket(this.settings.bucket).file(key);
  }

  async putIfAbsent(
    key: string,
    bytes: Buffer,
    contentType: string,
    metadata: StorageMetadata = {},
  ): Promise<StoredObject> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const md5Hash = createHash("md5").update(bytes).digest("base64");

    try {
      await this.file(key).save(bytes, {
        resumable: false,
        validation: false,
        // Conditionally idempotent: a retry cannot create a second object.
        preconditionOpts: { ifGenerationMatch: 0 },
        metadata: {
          contentType,
          md5Hash,
          metadata: {
            sha256,
            ...(metadata.originalFilename
              ? { originalFilename: encodeMetadataValue(metadata.originalFilename) }
              : {}),
            ...(metadata.route ? { route: metadata.route } : {}),
          },
        },
      });
      return { bucket: this.settings.bucket, key, contentType, bytes: bytes.byteLength };
    } catch (error) {
      if (statusOf(error) !== PRECONDITION_FAILED) throw this.translate(error);
      return this.existingWithSameContent(key, sha256);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const [found] = await this.file(key).exists();
      return found;
    } catch (error) {
      // exists() already answers false for a 404. Anything that reaches here —
      // a 403, a timeout, a 5xx — is NOT evidence of absence.
      throw this.translate(error);
    }
  }

  async getStream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<NodeJS.ReadableStream> {
    const stream = this.file(key).createReadStream(
      range ? { start: range.start, end: range.end, validation: false } : { validation: false },
    );

    // createReadStream returns at once and reports a missing object or a
    // transport failure LATER, as an 'error' event. Resolving only once storage
    // has answered means a 404 or 503 still maps to a status BEFORE any response
    // header is sent (spec §5.5). A separate exists() first would leave a
    // check-then-use gap.
    return new Promise((resolve, reject) => {
      const onError = (error: unknown) => {
        stream.off("response", onResponse);
        reject(statusOf(error) === NOT_FOUND ? new NotFoundError(`object ${key} not found`) : this.translate(error));
      };
      const onResponse = () => {
        stream.off("error", onError);
        resolve(stream);
      };
      stream.once("error", onError);
      stream.once("response", onResponse);
    });
  }

  private async existingWithSameContent(key: string, sha256: string): Promise<StoredObject> {
    let meta;
    try {
      [meta] = await this.file(key).getMetadata();
    } catch (error) {
      if (statusOf(error) === NOT_FOUND) {
        throw new Error(`object ${key} answered 412 and then was not found`);
      }
      throw this.translate(error);
    }
    if (meta.metadata?.sha256 !== sha256) {
      throw new Error(`object ${key} exists with different content (sha256 mismatch)`);
    }
    return {
      bucket: this.settings.bucket,
      key,
      contentType: String(meta.contentType ?? "application/octet-stream"),
      bytes: Number(meta.size),
    };
  }

  private translate(error: unknown): Error {
    const status = statusOf(error);
    if (status === undefined || status >= 500) return new ServiceUnavailableError("object storage unavailable");
    return error instanceof Error ? error : new Error(String(error));
  }
}
```

If `tsc` rejects a `retryOptions` or `save` option name, correct it against the installed
`@google-cloud/storage` type definitions — do not cast it away.

- [ ] **Step 4: Run** — expected 6 passed. The missing-object test is the one that proves the
  `'response'`/`'error'` wait works against a real client stream; if the installed client does not emit
  `'response'` on the read stream, find the event it does emit in its source (`file.js`,
  `createReadStream`) rather than reintroducing an `exists()` pre-check. **If the emulator does not return `412` on the duplicate
  write,** do not weaken the test: mark only that assertion `it.skip` with a comment naming the emulator
  limitation, and add the same assertion to the real-bucket suite in Task 13.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/adapters/gcs.storage.ts apps/api/src/adapters/gcs.storage.test.ts
git commit -m "feat(storage): Google Cloud Storage adapter with a checksummed conditional write"
```

---

### Task 8: `streamDocument` — the one delivery contract

**Files:**
- Create: `apps/api/src/lib/stream-document.ts`
- Test: `apps/api/src/lib/stream-document.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { Readable } from "node:stream";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { errorMiddleware, NotFoundError } from "../core/errors.js";
import { streamDocument } from "./stream-document.js";

// Includes bytes that are not valid UTF-8, so a text parser would corrupt them visibly.
const BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0xff, 0xfe, 0x00, 0x80, 0x0a, 0x39]);
const doc = { key: "tors/x.pdf", contentType: "application/pdf", bytes: BYTES.length, filename: "ประกาศ.pdf" };

function binary(res: NodeJS.ReadableStream, callback: (error: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
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
```

- [ ] **Step 2: Run** — `npx vitest run apps/api/src/lib/stream-document.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run** — expected 7 passed.
- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/stream-document.ts apps/api/src/lib/stream-document.test.ts
git commit -m "feat(api): one streaming contract for original documents — range, HEAD, nosniff, no-store"
```

---

### Task 9: The swap — port, services, routes, wiring

This is the atomic migration (§8). One commit. It must leave every gate green.

**Files:**
- Modify: `apps/api/src/ports/storage.port.ts`
- Create: `apps/api/src/adapters/storage.factory.ts`
- Modify: `apps/api/src/modules/tors/tors.repository.ts`, `tors.service.ts`, `tors.routes.ts`, `tors.routes.test.ts`
- Modify: `apps/api/src/modules/admin/admin.repository.ts`, `admin.service.ts`, `admin.routes.ts`, `admin.routes.test.ts`
- Modify: `apps/api/src/app.ts`, `apps/api/src/workers/extract.worker.ts`
- Modify: `apps/api/src/modules/intake/intake.service.test.ts` (fake storage)
- Modify: `apps/api/src/core/config.ts`, `config.test.ts`
- Delete: `apps/api/src/adapters/minio.storage.ts`, `minio.storage.test.ts`

- [ ] **Step 1: Change the port**

```ts
export interface Storage {
  putIfAbsent(
    key: string,
    bytes: Buffer,
    contentType: string,
    metadata?: StorageMetadata,
  ): Promise<StoredObject>;
  exists(key: string): Promise<boolean>;
  /** An inclusive byte range when given (spec §5.4). */
  getStream(key: string, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream>;
}
```

Remove `signedUrl` and its doc comment. Correct the port's claim that immutability is "enforced by the
interface": replace it with *"There is deliberately no `put`. The interface stops callers asking for an
overwrite; immutability itself is enforced by the bucket's permissions and policy (spec §3)."* Make
`GcsStorage` declare `implements Storage`.

- [ ] **Step 2: Add the factory**

```ts
import type { Config } from "../core/config.js";
import type { Storage } from "../ports/storage.port.js";
import { GcsStorage } from "./gcs.storage.js";

/**
 * The one place an object-storage adapter is constructed (spec §4.5). The API
 * and the worker both call it, so the choice of adapter and its settings
 * cannot drift between them. The deadline differs by caller: request-path
 * reads must fail fast; the worker reads whole documents.
 */
export function createStorage(config: Config, caller: "api" | "worker"): Storage {
  return new GcsStorage({
    bucket: config.gcs.bucket,
    apiEndpoint: config.gcs.apiEndpoint,
    keyFilename: config.gcs.credentialsPath,
    projectId: config.gcs.projectId,
    timeoutMs: caller === "api" ? config.gcs.timeoutApiMs : config.gcs.timeoutWorkerMs,
  });
}
```

- [ ] **Step 3: Repositories return the filename**

In `tors.repository.ts`, extend the projection with `"sourceRefs.originalFilename": 1` and return
`filename: record.sourceRefs?.find((s) => s.originalFilename)?.originalFilename`. Add
`filename?: string` to `PublicTorDocumentRecord`. In `admin.repository.ts`, add `filename?: string` to
`ReviewRecord` and populate it the same way in `load`.

- [ ] **Step 4: Services return what to stream**

`tors.service.ts` — replace `document()` and drop `signedUrlTtlSeconds` from the deps. Both services add:

```ts
import { extensionFor } from "../../lib/content-disposition.js";
import type { StreamableDocument } from "../../lib/stream-document.js";
```

```ts
  /** What to stream for a public request. A restricted record deliberately looks absent (FR-B-6). */
  async documentToStream(id: string): Promise<StreamableDocument> {
    const record = await this.deps.repo.loadDocument(id);
    if (!record || record.restricted) throw new NotFoundError();
    return {
      key: record.storage.key,
      contentType: record.storage.contentType,
      bytes: record.storage.bytes,
      filename: record.filename ?? `tor-${id}${extensionFor(record.storage.contentType)}`,
    };
  }
```

Add to `apps/api/src/lib/content-disposition.ts`:

```ts
const EXTENSIONS: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
};

/** A fallback download name's extension, from the verified content type. */
export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType] ?? "";
}
```

`admin.service.ts` — the same method, `documentToStream(torId)`, **without** the restricted check (a
reviewer must see a restricted record), drop `signedUrlTtlSeconds`. Both keep the existing comment that
the key comes from the loaded record, never the caller.

- [ ] **Step 5: Routes stream, for `GET` and `HEAD`**

`tors.routes.ts` (the router gains the storage dependency):

```ts
export interface TorsRouterDeps {
  service: TorsService;
  storage: Storage;
}

export function buildTorsRouter(deps: TorsRouterDeps): Router {
  const router = Router();

  const document = async (req: Request, res: Response) => {
    const disposition = parseDisposition(req.query.disposition);
    if (!disposition) throw new BadRequestError("disposition must be inline or attachment");
    const doc = await deps.service.documentToStream(req.params.id);
    await streamDocument(req, res, deps.storage, doc, disposition);
  };

  // HEAD before GET: in Express 5 a GET route answers HEAD when no earlier HEAD
  // route matches, and the HEAD path must not open the object.
  router.head("/:id/document", document);
  router.get("/:id/document", document);
  return router;
}
```

The `HEAD` test in Step 7 proves the order. Apply the same shape in `admin.routes.ts` for
`/tors/:id/document`, calling `adminService.documentToStream`.

- [ ] **Step 6: Wire with the factory; remove MinIO**

In `app.ts`: `const storage = createStorage(config, "api");`, pass `storage` to `buildTorsRouter` and
`buildAdminRouter`, delete both `signedUrlTtlSeconds` lines and the `MinioStorage` import. In
`extract.worker.ts`: `storage: createStorage(config, "worker")`, remove the import.

```bash
git rm apps/api/src/adapters/minio.storage.ts apps/api/src/adapters/minio.storage.test.ts
npm uninstall --workspace apps/api minio
```

In `config.ts`: remove the six `MINIO_*` keys, `SIGNED_URL_TTL_SECONDS`, the `minio` and
`signedUrlTtlSeconds` members and their mapping. Update the storage comment at the top of the schema. In
`config.test.ts`, remove `MINIO_*` from `base` and the `signedUrlTtlSeconds` assertion.

- [ ] **Step 7: Rewrite the route tests**

In `tors.routes.test.ts`, replace the signed-URL fake with a fake `Storage` whose `getStream` returns
`Readable.from([bytes])` and whose `exists` returns `true`, and replace the three signed-URL assertions
with:

```ts
it("streams a published record's document with nosniff and no-store", async () => {
  const id = await seedRecord(false);
  const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document`);
  expect(response.status).toBe(200);
  expect(response.headers["x-content-type-options"]).toBe("nosniff");
  expect(response.headers["cache-control"]).toBe("private, no-store");
});

it("returns 404 for a restricted record and never opens the object", async () => {
  const id = await seedRecord(true);
  const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document`);
  expect(response.status).toBe(404);
  expect(getStream).not.toHaveBeenCalled();
});

it("answers HEAD without opening the object", async () => {
  const id = await seedRecord(false);
  const response = await request(buildTestApp()).head(`/api/v1/tors/${id}/document`);
  expect(response.status).toBe(200);
  expect(getStream).not.toHaveBeenCalled();
});

it("rejects a disposition outside the allowlist", async () => {
  const id = await seedRecord(false);
  const response = await request(buildTestApp()).get(`/api/v1/tors/${id}/document?disposition=evil`);
  expect(response.status).toBe(400);
});
```

Keep the existing "works with no Authorization header" and "404 for unknown / malformed id" tests,
adapted to the streaming route. In `admin.routes.test.ts`, the admin equivalents: a **restricted record
streams `200`** for staff, `HEAD` does not open the object, and `401` without the admin key. In
`intake.service.test.ts`, remove `signedUrl` from the fake storage.

- [ ] **Step 8: Prove no caller remains**

```bash
grep -rn "signedUrl\|SIGNED_URL_TTL\|MinioStorage\|MINIO_\|from \"minio\"" apps packages --include=*.ts --include=*.tsx
```

Expected: no output.

- [ ] **Step 9: Run all four gates** — expected green. Web type-check fails at this point only if web
  code imports removed API types; it does not — the web still calls the routes over HTTP and is switched
  in Task 10.

- [ ] **Step 10: Commit**

```bash
git add -A apps/api packages package.json package-lock.json
git commit -m "feat(storage): stream documents through the API on Google Cloud Storage; remove MinIO and signed URLs"
```

---

### Task 10: Web — proxy the stream

**Files:**
- Create: `apps/web/src/shared/api/document-proxy.ts`
- Create: `apps/web/app/(app)/tors/[id]/document/route.ts`
- Create: `apps/web/app/(app)/admin/tors/[id]/document/route.ts`
- Modify: `apps/web/src/shared/api/tors.api.ts`, `apps/web/src/shared/lib/admin-api.ts`
- Modify: `apps/web/app/(app)/tors/[id]/page.tsx`, `apps/web/app/(app)/admin/review/page.tsx`
- Modify: `apps/web/src/views/TorDetailView.tsx`, `apps/web/src/views/AdminReviewView.tsx`

- [ ] **Step 1: Shared proxy**

```ts
import "server-only";

/** Headers the browser may see from the API's document response (spec §5.3). */
const FORWARDED = [
  "content-type",
  "content-length",
  "content-range",
  "content-disposition",
  "accept-ranges",
  "cache-control",
  "x-content-type-options",
] as const;

function apiBaseUrl(): string {
  const value = process.env.API_BASE_URL;
  if (!value) throw new Error("API_BASE_URL is not configured");
  return value;
}

/**
 * Relays one document response without buffering it.
 *
 * The request's abort signal is passed upstream, so closing the tab cancels the
 * API's read of storage. Only the allowlisted headers cross — anything else the
 * API might add stays server-side.
 */
export async function proxyDocument(
  request: Request,
  apiPath: string,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const incoming = new URL(request.url);
  const target = `${apiBaseUrl()}/api/v1${apiPath}${incoming.search}`;

  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      ...extraHeaders,
      ...(request.headers.get("range") ? { range: request.headers.get("range") as string } : {}),
    },
    signal: request.signal,
    cache: "no-store",
  });

  const headers = new Headers();
  for (const name of FORWARDED) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  // Belt and braces: the proxy must never make a taken-down document cacheable.
  headers.set("cache-control", "private, no-store");
  headers.set("x-content-type-options", "nosniff");

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}
```

- [ ] **Step 2: Public handler** — `apps/web/app/(app)/tors/[id]/document/route.ts`:

```ts
import { proxyDocument } from "../../../../../src/shared/api/document-proxy";

type Params = { params: Promise<{ id: string }> };

async function handle(request: Request, { params }: Params): Promise<Response> {
  const { id } = await params;
  return proxyDocument(request, `/tors/${encodeURIComponent(id)}/document`);
}

export { handle as GET, handle as HEAD };
```

- [ ] **Step 3: Staff handler** — `apps/web/app/(app)/admin/tors/[id]/document/route.ts`:

```ts
import { proxyDocument } from "../../../../../../src/shared/api/document-proxy";
import { isStaff } from "../../../../../../src/shared/lib/staff-session";

type Params = { params: Promise<{ id: string }> };

async function handle(request: Request, { params }: Params): Promise<Response> {
  // The staff session is checked BEFORE the server-held admin key is attached.
  if (!(await isStaff())) return new Response(null, { status: 404 });
  const { id } = await params;
  const adminKey = (process.env.ADMIN_API_KEYS ?? "").split(",")[0]?.trim() ?? "";
  return proxyDocument(request, `/admin/tors/${encodeURIComponent(id)}/document`, {
    authorization: `Bearer ${adminKey}`,
  });
}

export { handle as GET, handle as HEAD };
```

Verify every relative import depth by running `npx tsc --noEmit -p apps/web/tsconfig.json` **and**
loading the route in the running app — the error-surfaces work shipped a wrong `../` depth that passed
every gate and 500'd every route.

- [ ] **Step 4: Remove the signed-URL fetchers — no replacement**

Delete `fetchTorDocumentUrl` from `tors.api.ts`, and `ReviewDocument` and `fetchDocument` from
`admin-api.ts`. Pages do **not** pre-check existence: the proxy route handlers are the only path from the
web app to a document route (spec §5.1), and the viewer already handles a document that fails to load.

- [ ] **Step 5: Pages and views**

`tors/[id]/page.tsx`: delete the signed-URL fetch; pass `documentHref={OBJECT_ID.test(id) ? \`/tors/${id}/document\` : null}`
(the existing check that separates real record ids from mock ones). In `TorDetailView`, rename the prop to
`documentHref`; the button's `href` is `documentHref` (attachment by default).

`admin/review/page.tsx`: delete `fetchDocument` and `documentError`; pass
`documentHref={\`/admin/tors/${opened}/document\`}` plus the stored `contentType` and `bytes` from the
record (already on `ReviewRecord.storage`). In `AdminReviewView`, the viewer uses
`${documentHref}?disposition=inline` for the `<iframe>`/`<img>` source and `documentHref` for the
"open in new tab" link. Keep the loads / fails-to-load outcomes; the fail state now comes only from the
element's `onError` (for `<img>`) or from the "open in new tab" fallback (an `<iframe>` does not report a
404 body).

- [ ] **Step 6: Gates** — all four green.
- [ ] **Step 7: Commit**

```bash
git add -A apps/web
git commit -m "feat(web): proxy original documents through the app's own origin"
```

---

### Task 11: Seeder

**Files:** Modify `tools/seed_review_queue.mjs`

- [ ] **Step 1: Replace the MinIO client** with `@google-cloud/storage`, constructed from `GCS_API_ENDPOINT`
  and `GCS_BUCKET`. **Refuse to run when `GCS_API_ENDPOINT` is unset** — the seeder writes development
  data and must never touch a real bucket:

```js
import { createHash } from "node:crypto";
import { Storage as GcsClient } from "@google-cloud/storage";

if (!process.env.GCS_API_ENDPOINT) {
  console.error("GCS_API_ENDPOINT is not set — the seeder only writes to the emulator, never a real bucket.");
  process.exit(1);
}
const BUCKET = process.env.GCS_BUCKET ?? "tor-raw";
const gcs = new GcsClient({ apiEndpoint: process.env.GCS_API_ENDPOINT, projectId: "emulator" });
const [bucketExists] = await gcs.bucket(BUCKET).exists();
if (!bucketExists) await gcs.createBucket(BUCKET);
```

- [ ] **Step 2: Make seeds deterministic.** Today every run mints a fresh `ObjectId` and derives
  `contentHash` and `storageKey` from it, so a second run creates three more records and never meets an
  existing object. Derive `contentHash` from the fixture's bytes (sha256) and `storageKey` from that hash,
  and insert records with an upsert keyed on `contentHash`, so a rerun leaves three records. Also make each
  seed record's `contentType` match the bytes actually uploaded — the corpus files are PDFs, so any seed
  record declaring `image/jpeg` becomes `application/pdf` (the streamed viewer trusts the record's type).

- [ ] **Step 3: Upload with the same conditional, checksummed write** as the adapter, treating a `412` as
  already present:

```js
  const md5Hash = createHash("md5").update(bytes).digest("base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    await gcs.bucket(BUCKET).file(storageKey).save(bytes, {
      resumable: false,
      validation: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: { contentType: "application/pdf", md5Hash, metadata: { sha256, route: "upload" } },
    });
  } catch (error) {
    if (error?.code !== 412) throw error;
  }
```

- [ ] **Step 4: `--clear`** keeps removing seeded **records** only. Add a comment that it never deletes
  objects, and why.

- [ ] **Step 5: Verify** — `node tools/seed_review_queue.mjs` prints `seeded 3 records`; run it again: it
  succeeds, logs that each object already existed (412 path — add that log line), and the seeded record
  count is still 3.

- [ ] **Step 6: Commit** — `git commit -am "chore(seed): upload seeds to the storage emulator, never a real bucket"`

---

### Task 12: Compose, CI, environment

**Files:** Modify `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`

- [ ] **Step 1: Compose** — delete the `minio` service but **keep the `minio_data` volume declaration**
  with a comment: *retained for rollback until the cutover is closed (spec §9); removed after Task 15.* In
  **both** the `api` and `worker` services: replace `MINIO_*` with `GCS_BUCKET` and
  `GCS_API_ENDPOINT: http://gcs:4443`, and replace `minio` with `gcs` in `depends_on`.

- [ ] **Step 2: CI** — in `ci.yml`, replace the six `MINIO_*` env entries with
  `GCS_BUCKET: tor-raw` and `GCS_API_ENDPOINT: http://localhost:4443`; change
  `docker compose up -d mongo minio` to `docker compose up -d mongo gcs`; replace the MinIO health probe
  with `curl -sf http://localhost:4443/storage/v1/b`; update the failure-log line.

- [ ] **Step 3: `.env.example`** — remove the MinIO block and `SIGNED_URL_TTL_SECONDS`; add:

```bash
# Object storage — Google Cloud Storage (docs/superpowers/specs/2026-09-14-object-storage-gcs-design.md)
GCS_BUCKET=tor-raw
# Emulator only. Leave unset in deployment.
GCS_API_ENDPOINT=http://localhost:4443
# Deployment only: the DEDICATED storage service account's key. Never Vertex AI's.
GCS_CREDENTIALS=
STORAGE_TIMEOUT_API_MS=10000
STORAGE_TIMEOUT_WORKER_MS=60000
```

- [ ] **Step 4: Gates, then push the branch and watch CI**

```bash
git commit -am "build: emulator replaces MinIO in compose and CI"
git push -u origin feat/gcs-storage
gh run watch --exit-status
```

Expected: CI green. A failure in the setup step is read from its log before anything else.

---

### Task 13: Real-bucket suite

**Files:**
- Create: `apps/api/src/adapters/gcs.storage.real.test.ts`
- Create: `.github/workflows/gcs-real.yml`

- [ ] **Step 1: The suite** runs only when `GCS_REAL_TEST_BUCKET` and `GCS_CREDENTIALS` are both set:

```ts
import { randomUUID } from "node:crypto";
import { Storage as GcsClient } from "@google-cloud/storage";
import { describe, expect, it } from "vitest";
import { GcsStorage } from "./gcs.storage.js";

const bucket = process.env.GCS_REAL_TEST_BUCKET;
const keyFilename = process.env.GCS_CREDENTIALS;
const run = Boolean(bucket && keyFilename);

/**
 * Proves, against the REAL service, what fake-gcs-server cannot (spec §7).
 * Not a pull-request gate: it needs credentials, and is run deliberately.
 * Uses a disposable test bucket — never the originals bucket — whose lifecycle
 * rule deletes objects after a day.
 */
describe.runIf(run)("GcsStorage against a real bucket", () => {
  const storage = new GcsStorage({ bucket: bucket as string, keyFilename, timeoutMs: 30_000 });
  const raw = new GcsClient({ keyFilename });

  it("refuses a duplicate write with a precondition failure, returning the original", async () => {
    const key = `real-test/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.7 real");
    await storage.putIfAbsent(key, bytes, "application/pdf");
    const again = await storage.putIfAbsent(key, bytes, "application/pdf");
    expect(again.bytes).toBe(bytes.byteLength);
  });

  it("rejects an upload whose MD5 does not match, and stores nothing", async () => {
    const key = `real-test/${randomUUID()}.pdf`;
    await expect(
      raw.bucket(bucket as string).file(key).save(Buffer.from("real bytes"), {
        resumable: false,
        validation: false,
        metadata: { md5Hash: Buffer.alloc(16).toString("base64") },
      }),
    ).rejects.toMatchObject({ code: 400 });
    expect(await storage.exists(key)).toBe(false);
  });

  it("cannot delete an object with the application's identity", async () => {
    const key = `real-test/${randomUUID()}.pdf`;
    await storage.putIfAbsent(key, Buffer.from("%PDF-1.7 keep"), "application/pdf");
    await expect(raw.bucket(bucket as string).file(key).delete()).rejects.toMatchObject({ code: 403 });
  });

  it("streams the stored bytes and a range of them", async () => {
    const key = `real-test/${randomUUID()}.pdf`;
    await storage.putIfAbsent(key, Buffer.from("0123456789"), "application/pdf");
    const chunks: Buffer[] = [];
    for await (const c of await storage.getStream(key, { start: 3, end: 6 })) chunks.push(Buffer.from(c as Buffer));
    expect(Buffer.concat(chunks).toString()).toBe("3456");
  });
});
```

- [ ] **Step 2: The manual workflow** — `.github/workflows/gcs-real.yml` with `on: workflow_dispatch`, a job
  named `real-bucket (manual, not a PR gate)`, and `google-github-actions/auth` (step `id: auth`) using
  Workload Identity Federation with `create_credentials_file: true`. The test step sets
  `GCS_CREDENTIALS: ${{ steps.auth.outputs.credentials_file_path }}` and
  `GCS_REAL_TEST_BUCKET: ${{ vars.GCS_REAL_TEST_BUCKET }}` — without that mapping the suite silently skips
  — and runs `npx vitest run apps/api/src/adapters/gcs.storage.real.test.ts`. Add a first assertion step
  that fails the job if either variable is empty. Pin every action to a full release tag.

- [ ] **Step 3: Confirm it is skipped without credentials** — `npm test` reports the file as skipped, and
  the count of passing tests is unchanged.

- [ ] **Step 4: Commit** — `git add` both files, `git commit -m "test(storage): a real-bucket suite for what the emulator cannot prove"`

---

### Task 14: Documents

- [ ] **Step 1: `CLAUDE.md`** — stack table: *Object storage — Google Cloud Storage behind a `Storage`
  port; `fake-gcs-server` in Compose.* Hard rules: replace the two-endpoint MinIO paragraph with *"Storage
  is reached only by the API. Documents are streamed through the API with `nosniff` and `no-store`; there
  are no signed URLs."* Security baseline: replace *"originals served as attachments with `nosniff`"* with
  *"originals served with `nosniff` and `no-store` — as attachments by default, inline only for the in-app
  viewer."*
- [ ] **Step 2: Rendering spec §2.1** — replace with a short section pointing at the storage spec §5, noting
  the reversal and why.
- [ ] **Step 3: `docs/API.md`** — both document routes: streaming, `GET`/`HEAD`, the `disposition`
  parameter, the header table, the range table, and `404` for restricted on the public route.
- [ ] **Step 4: `docs/ARCHITECTURE.md`** — containers and deployment diagrams: `minio` → `gcs` (emulator)
  / Google Cloud Storage; the storage seam.
- [ ] **Step 5: `node tools/check_mermaid.mjs`** — expected `0 failed`.
- [ ] **Step 6: Commit** — `git commit -am "docs: storage on Google Cloud Storage, delivered by streaming"`

---

### Task 15: Live verification, then merge

Run against the real stack (`docker compose up -d mongo gcs`, the API and web dev servers, seeded
data), on **`localhost`**, not `127.0.0.1`.

- [ ] **Step 1: Public document**

```bash
ID=<a seeded record id>
curl -sI "http://localhost:3000/tors/$ID/document" | grep -iE "^HTTP|content-type|x-content-type|cache-control|accept-ranges|content-disposition"
```

Expected: `200`, `application/pdf`, `nosniff`, `private, no-store`, `bytes`, `attachment; filename*=…`.

- [ ] **Step 2: Range** — `curl -s -H "Range: bytes=0-4" -D - "http://localhost:3000/tors/$ID/document" -o /tmp/r.bin; cat /tmp/r.bin` → `206`, `Content-Range: bytes 0-4/…`, body `%PDF-`.
- [ ] **Step 3: Takedown** — restrict the record (reject it on the review screen), then repeat Step 1:
  expected **`404`** on the very next request.
- [ ] **Step 4: Staff route** — signed out: `curl -sI "http://localhost:3000/admin/tors/$ID/document"` →
  `404`. Signed in (browser): the review screen's PDF renders in the viewer, including for the restricted
  record.
- [ ] **Step 5: The detail page button** opens the PDF as a download with the Thai filename.
- [ ] **Step 6: Squash-merge**

```bash
gh pr create --base main --head feat/gcs-storage --title "Object storage on Google Cloud Storage, delivered by streaming" --body-file <summary>
gh pr merge --squash --delete-branch
```

The PR body lists every verification above with its result, and ends with the attribution line.

- [ ] **Step 7: Close rollback** — once the first real original is stored in Google Cloud Storage, remove
  the retained `minio_data` volume declaration in a follow-up commit (`chore(compose): drop the MinIO
  rollback volume`).

---

### Task 16: Google Cloud — Zen, outside the repository

Not an agent task. Each command's flags are checked against `--help` for the installed `gcloud` first.

- [ ] **1. Confirm the Bangkok (`asia-southeast3`) storage price** on the pricing page.
- [ ] **2. Originals bucket**

```bash
gcloud storage buckets create gs://<originals-bucket> \
  --project=<project> --location=asia-southeast3 \
  --uniform-bucket-level-access --public-access-prevention \
  --retention-period=100y
```

Versioning is off by default; confirm with `gcloud storage buckets describe`. Add **no** lifecycle rule.
**Do not lock the retention policy.**

- [ ] **3. Disposable test bucket**, same location, with a one-day lifecycle `Delete` rule.
- [ ] **4. Identity and role**

```bash
gcloud iam roles create torStorageWriter --project=<project> \
  --permissions=storage.objects.create,storage.objects.get
gcloud iam service-accounts create tor-storage --project=<project>
gcloud storage buckets add-iam-policy-binding gs://<originals-bucket> \
  --member=serviceAccount:tor-storage@<project>.iam.gserviceaccount.com \
  --role=projects/<project>/roles/torStorageWriter
```

Then check the account holds **no** project-level roles:
`gcloud projects get-iam-policy <project> --flatten=bindings --filter="bindings.members:tor-storage@"` →
expected empty.

- [ ] **5. Key** — create a key for `tor-storage`, store it outside the repository, point `GCS_CREDENTIALS`
  at it.

---

## Self-review

**Spec coverage.** §3 immutability → Task 16 (bucket, identity) + Task 13 (cannot delete, proven). §4 port
→ Task 9. §4.1 checksummed conditional write, 412 + sha256 → Task 7, proven for real in Task 13. §4.2 error
mapping → Task 7. §4.3 metadata, retries → Task 7. §4.5 single factory → Task 9. §5.1 routes → Task 9. §5.2
disposition allowlist → Task 2. §5.3 headers, filename from the record → Tasks 2, 3, 8, 9. §5.4 ranges → Tasks
1, 8. §5.5 streaming, cancellation, errors → Tasks 8, 10. §6 config → Tasks 4, 12. §7 emulator + real suite →
Tasks 6, 13. §8 atomic removal → Task 9 and the squash-merge. §9 seeder, rollback → Task 11; rollback is the
branch until the squash-merge. §10 documents → Task 14. §11 → Task 16.

**Placeholder scan.** `<a seeded record id>`, `<project>` and `<originals-bucket>` are values only the
operator has, not deferred design.

**Type consistency.** `getStream(key, range?: { start; end })`, `StreamableDocument { key, contentType,
bytes, filename }`, `Disposition`, `parseRange` → `RangeResult`, `createStorage(config, "api" | "worker")`,
`documentToStream` — used identically in every task.
