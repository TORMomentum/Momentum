# Object storage — originals on Google Cloud Storage, delivered through the API

**Date:** 2026-09-14 · **Revision 2**, after cross-model review
**Decides:** [PLAN.md](../../PLAN.md) Q7
**Applies to:** the `Storage` port and its adapter, document delivery, configuration, Compose, CI, and the
documents that name MinIO

---

## 0. Decisions (Zen, 2026-09-14)

| Decision | Answer |
| :--- | :--- |
| Where originals live | **Google Cloud Storage**, replacing MinIO |
| How development and CI run storage | **`fake-gcs-server`**, plus an integration test against a real bucket that runs where credentials exist |
| How hard the bucket enforces "never deleted" | **Least-privilege permissions plus an unlocked retention policy** — reversible, with the limit stated plainly (§3) |
| How documents reach the browser | **Streamed through the API**, which checks takedown status on every request (§5) |

## 1. What revision 1 got wrong

Revision 1 claimed a conditional write makes "an original is never overwritten" a property of the storage
service. **That was false**, and it rested on a truncated quotation. Google's documentation says a
generation-match precondition of `0` proceeds when no object exists *"or if there are only noncurrent
versions of the object in the bucket."*

A precondition stops **one write** from replacing a live object. It does not stop anyone holding delete
permission, a lifecycle rule, or object versioning from removing or replacing an original. Immutability
comes from how the bucket and its permissions are configured (§3); the precondition is defence in depth.

Revision 1 also kept signed URLs, which cannot carry `X-Content-Type-Options: nosniff` and cannot be
revoked once issued. §5 replaces them.

## 2. Why Google Cloud Storage

MinIO's community edition is now source code only; its last published image is frozen and unpatched, and
its removal from Docker Hub broke CI on 2026-09-13. The project already runs on Google Cloud for Vertex AI,
so this adds no new vendor.

## 3. Immutability — layers, and their limit

"An original is never overwritten or deleted" (`FR-A-2`, `NFR-S3`) is held by these together:

| Layer | Setting | What it stops |
| :--- | :--- | :--- |
| A dedicated bucket | holds originals and nothing else | other workloads' permissions and rules touching originals |
| Least-privilege identity | a **dedicated service account**, bound on this bucket only, with a custom role of exactly `storage.objects.create` and `storage.objects.get` | the application deleting or replacing anything, even through a bug or a compromised process |
| Object Versioning | **off** | a replacement quietly becoming the live object while the old one hides as a noncurrent version |
| Lifecycle rules | **no `Delete` action**, ever | originals aged out automatically |
| Uniform bucket-level access, public access prevention | **on** | per-object ACLs and accidental public exposure |
| Retention policy | **set, and left unlocked** | accidental deletion by anyone with broader access |
| Conditional write | `ifGenerationMatch: 0` on every upload | a concurrent duplicate submission replacing a live object |

**The limit, stated so nobody mistakes it for more.** An unlocked retention policy can be removed by a
project Owner. So a person with Owner rights can still, deliberately, delete an original. That is a
chosen trade-off: a **locked** policy would stop even an Owner, but it cannot be undone — Google's
documentation says a locked policy cannot be removed or shortened, and a bucket under one cannot be deleted
until every object has aged out, which keeps the bucket, and its bill, alive for the whole retention period.
That is disproportionate for a project at this stage and is revisited only before a real agency deployment.

**Audit inherited roles.** A narrow bucket binding means nothing if the same service account already holds
Editor, Owner or a Storage Admin role on the project or folder. The account is created for this purpose
alone and checked for inherited roles before it is used.

**It is not the Vertex AI account.** Reusing that key would give a compromise of either workload both
powers. Storage gets its own identity, as Google's service-account guidance recommends.

## 4. The port and the adapter

The port loses `signedUrl`, which nothing uses once delivery is streamed (§5):

```ts
interface Storage {
  putIfAbsent(key, bytes, contentType, metadata?): Promise<StoredObject>;
  exists(key): Promise<boolean>;
  getStream(key, range?): Promise<NodeJS.ReadableStream>;
}
```

`apps/api/src/adapters/gcs.storage.ts` implements it:

| Method | Behaviour |
| :--- | :--- |
| `putIfAbsent` | `file.save(bytes, { contentType, metadata, preconditionOpts: { ifGenerationMatch: 0 } })`. On `412`: read the existing object's metadata; if that read returns `404` (removed between the two calls), surface an error rather than invent a `StoredObject`; if it exists, **confirm its size matches** before returning it as already stored |
| `exists` | `true` or `false` only on a definite answer. `404` is `false`; `403`, timeouts, DNS and `5xx` **propagate** — never read as "absent" |
| `getStream` | `file.createReadStream({ start, end })`. A missing object is a not-found error. Errors that arrive mid-stream are mapped too, not only the ones before it starts |

**Content type** is the magic-byte-derived type from intake, stored explicitly. The declared type from a
submitter is never trusted.

**Integrity.** The upload validates a checksum, so bytes that arrive differently from the bytes that were
hashed are rejected rather than stored under a content-addressed key they do not match.

**Thai filenames.** Custom metadata stays ASCII: Google's metadata documentation advises against non-ASCII
because the XML API carries metadata in HTTP headers. The existing percent-encoding helper is reused, and
the encoded form is documented as encoded.

**Retries and deadlines.** The conditional upload is safe to retry and uses the client's retry policy; an
unconditional write would not be. Operation deadlines come from configuration, sized separately for the
API and the worker.

**Uploads stay buffered — a known deviation.** `CLAUDE.md` asks for streamed uploads, and the port takes a
whole `Buffer`. That predates this change and is bounded by `MAX_UPLOAD_BYTES`. It is recorded here as a
deviation, not fixed as part of a storage migration.

## 5. Delivery — streamed through the API

```
browser ──▶ Next route handler ──▶ API ──▶ Google Cloud Storage
                                    │ restricted?  checked on EVERY request
                                    │ Content-Type from the stored object
                                    │ X-Content-Type-Options: nosniff
                                    │ Content-Disposition: inline | attachment
browser ◀── bytes streamed back ◀───┘
```

| Route | Who | Behaviour |
| :--- | :--- | :--- |
| `GET /api/v1/tors/:id/document` | public | streams the original. **A restricted record answers `404`**, not `403` — a `403` would confirm a taken-down record exists |
| `GET /api/v1/admin/tors/:id/document` | staff | streams the original, including restricted records, which a reviewer needs to see |

Both **replace** today's routes of the same path, which return a signed URL as JSON. The web app reaches
them through Next route handlers, so the browser still never calls the API directly (rendering spec,
decision 1).

**What this resolves at once.** `nosniff` is set by the API, which Google's object metadata cannot do. A
takedown takes effect on the next request rather than when outstanding links expire. The browser fetches
from its own origin, so no CORS configuration exists. And the emulator needs no public address, because
only the API talks to storage.

**Disposition.** The in-app viewer requests `inline`, so the review screen can display the PDF; the "open
original" control requests `attachment`, with an RFC 6266 `filename*` built from the stored, encoded name —
never a raw submitted filename. The security baseline in `CLAUDE.md` is reworded to state exactly this.

**Range requests.** PDF viewers request byte ranges. The route honours `Range` and answers `206`, passing the
range to `getStream`, so a large document is not re-sent whole on every scroll.

**The cost.** Every byte passes through the API and the Next server rather than going straight from storage.
At this corpus's document sizes that is acceptable. It reverses §2.1 of the rendering spec, which is updated
in the same change so the two documents do not contradict each other.

## 6. Configuration

| Variable | Required | Purpose |
| :--- | :--- | :--- |
| `GCS_BUCKET` | yes, when the API starts | the originals bucket |
| `GCS_CREDENTIALS` | yes, outside the emulator | key file for the **dedicated** storage service account — not Vertex AI's |
| `GOOGLE_CLOUD_PROJECT` | yes, outside the emulator | already present |
| `GCS_API_ENDPOINT` | emulator only | unset in deployment |
| `STORAGE_TIMEOUT_MS` | no — default documented | operation deadline |

The API refuses to start with storage misconfigured, as it already does for Mongo. `MINIO_*` variables and
`SIGNED_URL_TTL_SECONDS` are removed.

## 7. Development and CI

**`fake-gcs-server`** in Compose, pinned to an exact release (v1.56.1), reached only by the API on its
internal address. It needs no account and no network.

**One integration test against a real bucket** runs where credentials exist: on a developer machine that
has them, and in a separately named, protected CI job triggered deliberately. It is **not** a pull-request
gate, and it is labelled so — a test silently skipped on every pull request proves nothing, and should not
be presented as if it did. It checks what the emulator cannot: the `412` on a duplicate write, the service
account's inability to delete, and a stream of the stored bytes.

## 8. The seeder

`tools/seed_review_queue.mjs` uses the Google Cloud Storage client directly, with the same conditional
write. It creates the emulator bucket deterministically. `--clear` removes seeded **records** only; it
never deletes stored objects, because the application's identity cannot, by design.

## 9. Rollback

There is no production data. Until the first original is stored only in Google Cloud Storage, rolling back
means restoring the MinIO adapter and re-seeding. After that point rollback is forward-only — reverting the
adapter would orphan those originals. The MinIO volume is kept until rollback is formally closed.

## 10. What else changes

- `CLAUDE.md` — stack table; security baseline reworded for §5; the storage rule loses its two endpoints
- `docs/superpowers/specs/2026-09-10-rendering-data-fetching-design.md` §2.1 — delivery is streamed
- `docs/API.md` — both document routes now stream
- `docs/ARCHITECTURE.md` — containers, deployment, the storage seam
- `docker-compose.yml`, `.github/workflows/ci.yml`, `.env.example`
- the admin review screen and the TOR detail page point their viewer and button at the new routes

## 11. Actions outside the repository

These need Google Cloud console or `gcloud` access, and are done by a person, not the build:

1. **Confirm the cost and pick the region** — Singapore (`asia-southeast1`) is nearest; the always-free
   tier does not cover it
2. Create the dedicated bucket with the settings in §3
3. Create the dedicated service account and its custom role, bind it on the bucket only, and check its
   inherited roles
4. Issue its key and place it where `GCS_CREDENTIALS` points, untracked

## 12. Still open

| Item | Status |
| :--- | :--- |
| Cost | Not confirmed; the pricing page could not be read when this was written. Confirmed before a bucket is created |
| The worker as a second place storage is wired | Pre-existing: `CLAUDE.md` says wiring happens once in `app.ts`. Recorded, not changed here |

## 13. Sources

- Google Cloud Storage — request preconditions; Bucket Lock; object metadata; retry strategy
- Google Cloud IAM — service-account best practices
- `googleapis/nodejs-storage` — conditional upload, `createReadStream` ranges
- `fsouza/fake-gcs-server` — README and releases
- MinIO `README` — community edition distributed as source only
