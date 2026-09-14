# Object storage — originals on Google Cloud Storage, delivered through the API

**Date:** 2026-09-14 · **Revision 3**, after two rounds of cross-model review
**Decides:** [PLAN.md](../../PLAN.md) Q7
**Applies to:** the `Storage` port and its adapter, document delivery, configuration, Compose, CI, and the
documents that name MinIO

---

## 0. Decisions (Zen, 2026-09-14)

| Decision | Answer |
| :--- | :--- |
| Where originals live | **Google Cloud Storage**, in **Bangkok** (`asia-southeast3`), replacing MinIO |
| How development and CI run storage | **`fake-gcs-server`**, plus an integration test against a real bucket where credentials exist |
| How hard "never deleted" is enforced | **Least-privilege permissions plus an unlocked retention policy** (§3) |
| How documents reach the browser | **Streamed through the API only.** Direct signed links are removed entirely (§5) |
| Is a taken-down original ever deleted? | **No.** `FR-A-2`, `FR-B-6` and `NFR-S3` say it is kept *"for the life of the system"*; a takedown hides it |

## 1. What the earlier revisions got wrong

**Revision 1** claimed a conditional write makes "never overwritten" a property of the storage service, on a
truncated quotation. A generation-match precondition of `0` also proceeds *"if there are only noncurrent
versions of the object in the bucket."* A precondition stops one write; it does not stop a delete
permission or a lifecycle rule.

**Revision 2** carried four factual errors, corrected here: Object Versioning being off does not stop a
replacement (permissions and the precondition do; versioning off only means no hidden noncurrent copy);
signed URLs *can* be revoked early, by rotating the signing key; a locked retention policy stops deletion
only until an object reaches the retention age, not forever; and the nearest region is Bangkok, not
Singapore. It also left the streaming protocol underspecified — §5 now defines it.

## 2. Why Google Cloud Storage

MinIO's community edition is now distributed as source code only; its last image is frozen and unpatched,
and its removal from Docker Hub broke CI on 2026-09-13. The project already runs on Google Cloud for
Vertex AI, and a Bangkok region keeps Thai procurement documents in Thailand.

## 3. Immutability — layers, and their limit

| Layer | Setting | What it contributes |
| :--- | :--- | :--- |
| Dedicated bucket | holds originals only | no other workload's rules or permissions reach them |
| Least-privilege identity | a **dedicated** service account, bound on this bucket only, custom role of exactly `storage.objects.create` + `storage.objects.get` | the application cannot delete or replace an object — replacement requires delete as well as create |
| Conditional write | `ifGenerationMatch: 0` on every upload | a concurrent duplicate cannot replace a live object |
| Object Versioning | **off** | no replaced object survives hidden as a noncurrent version |
| Lifecycle rules | **no `Delete` action** | originals never age out automatically |
| Uniform bucket-level access, public access prevention | **on** | no per-object ACLs, no accidental public exposure |
| Retention policy | **maximum period, left unlocked** | a guardrail against accidental deletion by a broader identity |

**Why the maximum period.** `NFR-S3` requires originals to remain *"for the life of the system."* No
retention policy can promise that on its own — the maximum is 100 years, and an unlocked policy can be
shortened or removed. The period is set to the maximum so the policy never becomes the reason an original
is deletable; the guarantee itself rests on the identity above and on the process that controls who holds
broader rights.

**The limit.** A project Owner can remove an unlocked policy and then delete an object. A **locked** policy
would stop that until objects reach retention age, but it can never be removed or shortened, and a bucket
under one cannot be deleted until every object has aged out — which keeps the bucket, and its bill, alive
for up to a century. That is disproportionate now and is revisited only before a real agency deployment.

**Audit inherited roles.** A narrow bucket binding means nothing if the account holds Editor, Owner or a
Storage Admin role on the project or folder. It is created for this purpose alone and checked.

## 4. The port and the adapter

`signedUrl` is removed; delivery is streamed (§5). The route reads size and content type from the TOR
record, which already stores them, so the port needs no metadata method:

```ts
interface Storage {
  putIfAbsent(key, bytes, contentType, metadata?): Promise<StoredObject>;
  exists(key): Promise<boolean>;
  getStream(key, range?: { start: number; end: number }): Promise<NodeJS.ReadableStream>;
}
```

### 4.1 `putIfAbsent`

1. Compute the MD5 of the bytes and send it **with** the upload, so Cloud Storage rejects a mismatch
   server-side before the object exists. Client-side post-upload validation is turned **off**: on a
   mismatch it deletes the object, which the application's identity cannot do.
2. Upload with `preconditionOpts: { ifGenerationMatch: 0 }`, the verified content type, and ASCII-safe
   custom metadata including the object's `sha256`.
3. On `412`: read the existing object's metadata. A `404` on that read (removed in between) is an error, not
   an invented result. If it exists, compare its stored `sha256` with the one being written; a mismatch is
   an integrity error, never a silent "already stored".

The server-side rejection of a wrong checksum is proven by a test that sends a deliberately wrong hash and
asserts the upload fails and no object exists. The `@google-cloud/storage` version is pinned exactly.

### 4.2 `exists` and `getStream`

`exists` answers only on a definite result: `404` is `false`; `403`, timeouts, DNS failures and `5xx`
**propagate**. `getStream` maps a missing object to not-found. Ranged reads do not receive the client's
full-object integrity check; that is acceptable because objects are immutable and were validated on upload.

### 4.3 Metadata, retries, deadlines

Custom metadata stays ASCII — Google's metadata documentation advises against non-ASCII because the XML API
carries it in HTTP headers — using the existing percent-encoding helper. The conditional upload is safe to
retry and uses the client's policy; nothing unconditional is retried. Deadlines come from two settings,
one for the API and one for the worker (§6).

### 4.4 Uploads stay buffered — a known deviation

`CLAUDE.md` asks for streamed uploads; the port takes a whole `Buffer`, bounded by `MAX_UPLOAD_BYTES`. That
predates this change and is recorded here, not fixed inside a storage migration.

### 4.5 One construction point

Storage is built by a single `createStorage(config)` used by both `app.ts` and the worker, so the adapter
is chosen in one place — the intent of `CLAUDE.md`'s "wiring happens once".

## 5. Delivery — streamed through the API

```
browser ──▶ Next route handler ──▶ API ──▶ Google Cloud Storage
                                    │ restricted?  checked on EVERY request
browser ◀── bytes, streamed ◀───────┘
```

### 5.1 Routes

| Route | Who | Restricted record |
| :--- | :--- | :--- |
| `GET`, `HEAD` `/api/v1/tors/:id/document` | public | **`404`** — a `403` would confirm a taken-down record exists |
| `GET`, `HEAD` `/api/v1/admin/tors/:id/document` | staff | served — a reviewer needs to see it |

Both **replace** today's same-path routes, which return a signed URL as JSON. The web app reaches them only
through Next route handlers, so the browser never calls the API (rendering spec, decision 1).

### 5.2 Query contract

`?disposition=inline` or `?disposition=attachment`, allowlisted. **Default is `attachment`.** The in-app
viewer asks for `inline` explicitly. Any other value is `400`.

### 5.3 Response headers — every response, every hop

| Header | Value |
| :--- | :--- |
| `Content-Type` | the verified type from the TOR record |
| `X-Content-Type-Options` | `nosniff` |
| `Content-Disposition` | `inline`, or `attachment; filename*=UTF-8''<encoded name>` |
| `Cache-Control` | `private, no-store` — otherwise a browser or proxy could serve a copy after a takedown |
| `Accept-Ranges` | `bytes` |
| `Content-Length` | full size, or the range length |

The filename comes from `originalFilename`, **persisted on the record's source reference at intake**. It is
not read back from storage metadata, which remains operator convenience. A record with no filename gets
`tor-<id>.<ext>`. A raw submitted name is never inserted into a header.

### 5.4 Ranges

| Request | Response |
| :--- | :--- |
| no `Range` | `200`, whole object |
| `bytes=a-b`, `bytes=a-` | `206`, `Content-Range: bytes a-b/size` |
| `bytes=-n` (suffix) | `206`, the last `n` bytes |
| more than one range, or malformed | ignored — `200`, whole object (RFC 9110 permits ignoring `Range`) |
| start beyond the end | `416`, `Content-Range: bytes */size` |

`HEAD` returns the same status and headers with no body and **never opens the object stream**.

### 5.5 Streaming, cancellation, errors

**API.** `stream.pipeline(storageStream, res)`, so backpressure is respected. When the client disconnects,
the storage stream is destroyed. An error **before** headers are sent maps to an HTTP error — `404` for a
missing object, `503` for storage unavailable. An error **after** headers are sent cannot change the
status: it is logged and the response is destroyed, which the client sees as a truncated transfer.

**Next.** The route handler forwards `Range`, passes the request's abort signal to the upstream fetch so a
closed tab cancels the upstream read, and returns the upstream body as a stream without buffering it. It
copies only the headers in §5.3. The admin handler calls `isStaff()` **before** attaching the server-held
admin credential. Both handlers implement `HEAD`.

### 5.6 What streaming settles, and its cost

`nosniff` is set by the API, which Google's object metadata cannot do. A takedown applies on the next
request, and `no-store` prevents a cached copy outliving it. The browser reads from its own origin, so no
CORS configuration exists, and the emulator needs no public address. The cost is that every byte passes
through the API and the Next server — acceptable at this corpus's sizes. It reverses §2.1 of the rendering
spec, which is updated in the implementation change.

## 6. Configuration

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `GCS_BUCKET` | yes | the originals bucket |
| `GCS_CREDENTIALS` | yes, outside the emulator | key file for the **dedicated** storage account, not Vertex AI's |
| `GOOGLE_CLOUD_PROJECT` | yes, outside the emulator | already present |
| `GCS_API_ENDPOINT` | emulator only | unset in deployment |
| `STORAGE_TIMEOUT_API_MS` | no — documented default | deadline for request-path operations |
| `STORAGE_TIMEOUT_WORKER_MS` | no — documented default | deadline for the worker's larger reads |

The API refuses to start with storage misconfigured. `MINIO_*` and `SIGNED_URL_TTL_SECONDS` are removed.

## 7. Development and CI

**`fake-gcs-server`**, pinned to v1.56.1, reached only by the API on its internal address.

**Real-bucket tests** run against a **separate, disposable test bucket** — never the originals bucket — with a
lifecycle `Delete` rule of one day, permitted there because nothing in it is an original. Tests use a
test-only identity with the same create-and-get role, so they also prove that identity cannot delete. They
run where credentials exist and in a separately named, manually triggered CI job. **They are not a
pull-request gate**, and are labelled so.

## 8. `signedUrl` removal is one atomic change

Current callers: `TorsService`, `AdminService`, their route tests, the MinIO adapter and its tests, the
intake test fakes, `SIGNED_URL_TTL_SECONDS` in configuration, and `app.ts`. All move in the same change as
the adapter, so no commit leaves the tree half on each design.

## 9. Seeder and rollback

The seeder uses the Google Cloud Storage client with the same conditional, checksummed write, creates the
emulator bucket deterministically, and `--clear` removes seeded **records** only.

There is no production data. Until the first original exists only in Google Cloud Storage, rollback means
restoring the MinIO adapter and re-seeding. After that, rollback is forward-only. The MinIO volume is kept
until rollback is formally closed.

## 10. Documents updated in the implementation change

`CLAUDE.md` (stack table; security baseline reworded for §5.2–5.3), the rendering spec §2.1, `docs/API.md`,
`docs/ARCHITECTURE.md`, `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`, and the review
screen and detail page, which point at the new routes.

## 11. Actions outside the repository — Zen, in Google Cloud

1. Confirm the Bangkok (`asia-southeast3`) storage price
2. Create the originals bucket with every setting in §3
3. Create the separate disposable test bucket (§7)
4. Create the dedicated service accounts and custom role; bind on each bucket only; check inherited roles
5. Issue the keys; place them where `GCS_CREDENTIALS` points, untracked

## 12. Still open

| Item | Status |
| :--- | :--- |
| Cost | Not confirmed — Google's pricing page could not be read during this work |
| Legal deletion | Not a storage decision. If a court order ever requires destroying an original, that is an explicit admin process to add to the SRS |

## 13. Sources

Google Cloud Storage: request preconditions; Bucket Lock; Object Versioning; object metadata; locations;
retry strategy; signed URLs. Google Cloud IAM: service-account best practices, Cloud Storage permissions.
`googleapis/nodejs-storage`. `fsouza/fake-gcs-server`. MinIO `README`. RFC 9110 (range requests).
