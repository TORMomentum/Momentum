# Object storage — moving originals from MinIO to Google Cloud Storage

**Date:** 2026-09-14
**Decides:** [PLAN.md](../../PLAN.md) Q7
**Decided by:** Zen, 2026-09-14 — switch to Google Cloud Storage; an emulator for daily development and
CI, plus one integration test against a real bucket that runs only when credentials are present
**Applies to:** the `Storage` port's adapter, its configuration, Compose, CI and the documents that name
MinIO

---

## 1. Why the change

On 2026-09-13 MinIO's image disappeared from Docker Hub, and CI failed on every push before a test ran.
MinIO now distributes its community edition as **source code only**; the last published image is frozen
and receives no security updates. Compose is pinned to it as a stopgap.

Google Cloud Storage fits this project for reasons beyond replacing a broken image:

| | |
| :--- | :--- |
| No new vendor | The project already runs on Google Cloud for Vertex AI, with a service-account key file |
| Immutability enforced by the store | A conditional write refuses to create an object whose name already exists (§4) |
| Maintained | Patched continuously; nothing frozen |
| One address | Signed URLs are publicly reachable, so the internal-versus-public endpoint split MinIO needed disappears in deployment |

## 2. What does not change

The `Storage` port is the contract, and it stays exactly as it is:

```ts
interface Storage {
  putIfAbsent(key, bytes, contentType, metadata?): Promise<StoredObject>;
  exists(key): Promise<boolean>;
  getStream(key): Promise<NodeJS.ReadableStream>;
  signedUrl(key, ttlSeconds): Promise<string>;
}
```

No module, route, worker or screen changes. That is what the port was for. Storage keys keep their
content-addressed shape, `tors/<year>/<month>/<sha256>.<ext>`.

## 3. The adapter

A new `apps/api/src/adapters/gcs.storage.ts` implements the port. It is wired in the two places MinIO is
wired today: `app.ts` and `workers/extract.worker.ts`.

| Port method | MinIO today | Google Cloud Storage |
| :--- | :--- | :--- |
| `putIfAbsent` | `statObject`, then `putObject` if absent | `file.save(bytes, { preconditionOpts: { ifGenerationMatch: 0 } })`; a `412` means it already exists, so return the existing object |
| `exists` | `statObject` succeeds | `file.exists()` |
| `getStream` | `getObject` | `file.createReadStream()` |
| `signedUrl` | `presignedGetObject` on a separate public client | `file.getSignedUrl({ version: "v4", action: "read", expires })` |

The client reuses the credentials Vertex AI already uses — the service-account key file named by
`GOOGLE_APPLICATION_CREDENTIALS`. A key file can sign V4 URLs directly, so no additional IAM role is
required for signing.

## 4. The improvement: a write that cannot overwrite

`putIfAbsent` on MinIO is check-then-write. Two concurrent submissions of the same document can both
observe "absent" and both write. The repository's own task list records this as a known weakness,
benign only because keys are content hashes and the two writes carry identical bytes.

Google Cloud Storage closes it at the store. From the request-preconditions documentation: a
generation-match precondition of `0` means *"the request only proceeds if no object with the specified
name exists in the bucket"*, and otherwise *"the request fails with a status code of 412 Precondition
Failed."*

So `FR-A-2` — an original is never overwritten — becomes a property of the storage service rather than
of the order our code happens to run in. The adapter treats `412` as "already stored" and returns the
existing object's metadata; any other error propagates.

## 5. Signed URLs, and a conflict this surfaced

V4 signed URLs, with the lifetime taken from `SIGNED_URL_TTL_SECONDS`, generated per request and never
persisted — as today.

**An existing conflict, not introduced here, and not resolved here.** The security baseline in
`CLAUDE.md` says originals are *"served as attachments with `nosniff`"*. The MinIO adapter sets no
`Content-Disposition`, so documents are served **inline** — which is precisely what lets the review
screen show the PDF in a frame. The code and the baseline already disagree.

This change preserves today's behaviour (inline) so the review screen keeps working, and records the
conflict for a decision:

- serve inline for the in-app viewer, and amend the baseline to say so and why; or
- serve as an attachment, and give the review screen a different way to display the document.

Signing a URL for a different disposition is one option on `getSignedUrl`, so either answer is cheap to
implement once chosen.

## 6. Configuration

Every value comes from configuration with an overridable default (`NFR-S7`).

| Variable | Purpose |
| :--- | :--- |
| `GCS_BUCKET` | The bucket holding originals |
| `GCS_API_ENDPOINT` | Unset in deployment. Set to the emulator's address for local development and CI |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS` | Already present for Vertex AI; reused |

The `MINIO_*` variables are removed, from `.env.example`, Compose and `core/config.ts`, in the same
change that removes the adapter — so no half-migrated state is ever committed.

## 7. Local development and CI

**Daily work and CI use `fake-gcs-server`** in Compose, pinned to an exact release rather than `latest`
(the MinIO failure was a `latest` tag resolving on machines that had pulled it before). It is actively
maintained — release v1.56.1 on 2026-08-24 — and needs no account and no network.

**Its limitation, stated plainly.** Its documentation: *"No validation is made on the query params
(signature, expiration ...)"*. Locally and in CI, nothing proves that an expired or tampered signed URL
is refused. Signed URLs also have to be pointed at the emulator's public host rather than
`storage.googleapis.com`; the exact mechanism on the Node client is confirmed during implementation, not
assumed here.

**So one integration test runs against a real bucket**, and only when credentials are present — the
arrangement the repository already uses for the Vertex AI corpus test, which is skipped without them.
It proves the three things the emulator cannot: a conditional write refused with `412`, a signed URL
that fetches the bytes, and the same URL refused after expiry.

## 8. Existing objects

There is no production data. Development holds only seeded records, whose documents the seeder uploads
from the corpus. After the switch the seeder uploads through the new adapter; existing development data
is re-seeded rather than migrated.

## 9. What else changes

- `CLAUDE.md` stack table and security baseline wording (§5 outcome)
- `docs/ARCHITECTURE.md` — containers, deployment and the storage seam
- `docs/superpowers/specs/2026-09-01-…-design.md` §5.8 — the two-endpoint storage rule becomes one
  endpoint in deployment
- `docker-compose.yml` — `minio` service replaced by the emulator; volume renamed
- `.github/workflows/ci.yml` — starts the emulator instead of MinIO
- `tools/seed_review_queue.mjs` — uploads through the GCS client

## 10. Open, and what would change the plan

| Item | Status |
| :--- | :--- |
| **Cost** | Not confirmed — the pricing page could not be read when this was written. Google's always-free storage tier applies to specific US regions; a Thai project would likely store in Singapore, which is likely billed. The corpus is small, but the figure is confirmed before a bucket is created |
| **Region** | Singapore (`asia-southeast1`) is the nearest; to be chosen with the cost check |
| **Retention policy on the bucket** | Google Cloud Storage can hold objects against deletion at the bucket level, which would make immutability stronger still. Worth adopting; its exact semantics are checked against the documentation before it is switched on, because a locked retention policy cannot be undone |
| **Inline or attachment** | §5 — a decision for Zen and the team |
| **Emulator signed-URL host** | §7 — confirmed during implementation |

## 11. Sources

- Google Cloud Storage — request preconditions (`ifGenerationMatch: 0`, `412 Precondition Failed`)
- `googleapis/nodejs-storage` samples — conditional upload with `preconditionOpts`; `generateV4ReadSignedUrl`
- `fsouza/fake-gcs-server` README — signed-URL limitation; GitHub releases for maintenance status
- MinIO `README` — community edition distributed as source only; legacy binaries not updated
