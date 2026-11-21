# TOR Radar — Security Design Principles

Section (5) of the project document · grading criterion 3, "Map security design principles you have
followed in your implementation". Principle names follow Lecture 7 (CISSP ch. 8 and the US-CERT
principles). Code paths refer to `main` of the TOR Radar repository. Threat IDs (T01–T16) refer to the
Threat Model tab of `Momentum-OWASP-ASVS-5.0-Plan.xlsx`.

## Summary

| # | Principle (Lec 7) | Followed | Main evidence |
| :-- | :-- | :-- | :-- |
| 1 | Least Privilege | Yes | Separate intake and admin keys; vendors reach only their own data |
| 2 | Defense in Depth | Yes | Five independent layers on every upload |
| 3 | Fail Securely / Fail-Safe Defaults | Yes | Errors deny access; staff area fails closed |
| 4 | Secure Defaults | Yes | Risky features ship switched off |
| 5 | Separation of Privilege | Yes | Admin area needs two conditions |
| 6 | Separation of Duties | Partly | Ingest, extraction, and admin decisions are separate roles; admins still share one secret |
| 7 | Economy of Mechanism / Keep It Simple | Yes | One helper per security control |
| 8 | Complete Mediation | Yes | No signed URLs; every file request is checked |
| 9 | Open Design | Yes | Public anomaly method; security rests on keys only |
| 10 | Least Common Mechanism | Yes | Separate buckets, separate services, per-user sessions |
| 11 | Zero Trust | Yes | Uploaded files, URLs, and AI output are all verified |
| 12 | Privacy by Design | Yes | PDPA consent, minimisation, export and delete, one redaction point |
| 13 | Never Assume Your Secrets Are Safe | Yes | Hashed passwords and tokens, secrets kept out of git, constant-time compares |
| 14 | Psychological Acceptability | Yes | Thai UI, uniform login error, simple consent |
| 15 | Securing the Weakest Link | Planned | Risk-ranked threat model; the weakest link (shared admin secret) is P1 |

---

## 1. Least Privilege

*A subject gets only the privileges its task needs; the default is no access.*

- **Separate API keys per job.** `INTAKE_API_KEYS` can only submit documents, and `ADMIN_API_KEYS`
  can only call admin routes (`apps/api/src/core/config.ts:95-96`). A leaked intake key cannot
  approve, restrict, or delete anything.
- **New accounts are vendors.** Every new account starts with `role: "vendor"`
  (`accounts.repository.ts:38`). Admin is granted explicitly with `changeRole`.
- **Vendors see only their own data.** `/me` routes take the account from the session, never from
  an ID in the request, so a vendor cannot ask for another vendor's profile, matches, or bookmarks.
- **Only the API touches storage.** The browser never holds a storage credential. Documents are
  streamed through the API (`lib/stream-document.ts`).
- **Only the repository layer touches the database.** Only `*.repository.ts` files import the
  database driver, which keeps database access in one small part of the code.

## 2. Defense in Depth

*Several controls in series, so one failure does not expose the asset.*

An uploaded document passes five independent layers before it is stored:

1. Key authentication with a constant-time compare (`modules/intake/intake.auth.ts`).
2. A rate limit on all intake routes (`express-rate-limit`).
3. Streaming multipart caps on file count, field count, field size, and `MAX_UPLOAD_BYTES`.
4. A magic-byte check (`lib/file-type.ts`), because the declared `Content-Type` is
   attacker-controlled. Only real PDF, JPEG, and PNG files pass.
5. Zod schema validation of every field.

After storage it is served with `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`, and
`Content-Disposition: attachment` by default.

The login flow layers controls the same way:

- argon2id hashing
- per-IP and per-email rate limits (`core/auth-rate-limit.ts`)
- email verification before first login
- a uniform failure message

## 3. Fail Securely / Fail-Safe Defaults

*Deny unless access is explicitly granted; a failure leaves the system as secure as before.*

- **Central error handler** (`core/errors.ts`):
  - A schema failure returns `400` with the issue paths, never the input.
  - Any other error returns a generic `500 Internal server error` with no stack trace.
- **The staff area fails closed.** If the signed-in account's role cannot be read, the answer is
  no (`apps/web/src/shared/lib/staff-session.ts`, `signedInAccountMayActAsStaff`).
- **Configuration fails fast.** The API refuses to start if a required key or secret is missing
  (Zod schema in `config.ts`). It never runs with an empty key.
- **Storage writes fail rather than overwrite.** `putIfAbsent` uses `ifGenerationMatch: 0`
  (`adapters/gcs.storage.ts:69`). A second write to the same key is rejected, and the original is
  never replaced.
- **Login failures look the same.** An unknown email, a wrong password, an unverified account, and
  a disabled account all return one message (`accounts.routes.ts:96`). A dummy hash is checked even
  for an unknown email (`password.ts:15-19`), so response time does not reveal which emails have
  accounts.

## 4. Secure Defaults

*Never assume defaults are safe; ship with the safe setting on.*

- **Email dispatch is off by default** (`NOTIFY_DISPATCH_ENABLED: flag(false)`, `config.ts:297`).
  No email leaves the system until an operator turns it on.
- **Downloads are attachments by default.** Original documents download as attachments, and
  inline display is allowed only for the in-app viewer.
- **Optional AI features start off.** Behaviour-based matching and embeddings default to off.
- **Production keeps secrets in Google Secret Manager.** `.env.example` holds names only, never
  values.

## 5. Separation of Privilege

*Grant a privilege only when two or more conditions are met.*

The admin area needs **both**:

1. a valid staff pass, which is the `tor_staff` cookie: HMAC-SHA256 signed with
   `STAFF_ACCESS_SECRET`, `httpOnly`, and expiring after 8 hours; **and**
2. if an account is signed in, that account must have `role === "admin"`
   (`staff-session.ts:24-32`).

A vendor who obtains the staff pass still gets no admin rights while signed in as a vendor.

## 6. Separation of Duties

*No single party controls a whole critical function.*

- **Writing a record and judging it are separate steps.** The intake service only stores and
  queues a document. The extraction worker only extracts fields. Changing what the public sees
  (review queue, takedown) is an admin decision, and it is recorded in an audit trail.
- **A takedown cannot destroy evidence.** It only restricts access. The stored original stays
  unchanged, so not even an admin can remove a published document.
- **Gap (T02, priority P1):** admins share one staff secret, so actions record "admin" rather than
  a person. **Planned fix:** individual admin accounts with TOTP.

## 7. Economy of Mechanism / Keep It Simple

*Security mechanisms should be as small and simple as possible.*

- **One SSRF helper.** Every server-side fetch of a user-supplied URL goes through
  `lib/safe-fetch.ts`, which does four things:
  - allows only the `http`/`https` schemes;
  - checks every resolved DNS address against private and loopback ranges;
  - re-checks after each redirect;
  - caps response size and time.
- **One redaction serializer** (`lib/redact.ts`). Personal data is removed in one place, so no
  page or export can forget it.
- **One configuration file** (`core/config.ts`). Every threshold, key name, and limit is
  validated there.
- **One header helper** (`lib/content-disposition.ts`). Download headers are built in one place.
- **No extra infrastructure.** MongoDB doubles as the job queue, so there is no separate queue
  service to secure.

## 8. Complete Mediation

*Every access to every object is checked, every time.*

- **No signed URLs.** A signed URL would grant access without a check for its whole lifetime.
  Instead, every document request goes through an API route that checks access and whether the TOR
  is restricted, then streams the bytes (`lib/stream-document.ts`).
- **Restricted TORs return 404**, even to someone who knows the ID.
- **Sessions are checked against the database on every request** (server-side session store), so
  a revoked session stops working immediately rather than at expiry.
- **Admin server actions call `requireStaff()` at the start of each action**
  (`features/admin/admin-accounts.actions.ts`), not only when the page loads.
- **Cross-site requests are blocked.** State-changing account requests are checked against
  `APP_ORIGIN` (`core/require-same-origin.ts`).

## 9. Open Design

*Security must not depend on the design being secret.*

- **The anomaly rule is published.** The public `/methodology` page explains it: same category,
  rolling 12 months, IQR fences, no flag with fewer than 8 peers. Anyone can check how a TOR was
  flagged.
- **Every AI value is explained.** Each value shows its confidence, the model and version that
  produced it, and a link to the source document.
- **Security depends only on secrets, not on hidden code.** The secrets are keys, the HMAC
  secret, and the argon2 hash, all using standard algorithms (argon2id, HMAC-SHA256, SHA-256). The
  code can be read by anyone without weakening them.

## 10. Least Common Mechanism

*Avoid shared mechanisms between users; every shared path is a potential leak.*

- **Two storage buckets.** Vendor-uploaded private files go in a separate vault bucket
  (`GCS_VAULT_BUCKET`, `adapters/gcs.vault.storage.ts`), away from the public originals bucket.
  The two have different rules: vault files can be deleted on request, originals never.
- **The API and the extraction worker are separate services.** A crash or compromise while
  parsing a malicious document does not share a process with the HTTP server.
- **Each login gets its own session.** The session ID is random, 256 bits
  (`sessions.ts:19`, `randomBytes(32)`), and nothing is shared between users.

## 11. Zero Trust

*Nothing is trusted because of where it comes from; every input is verified.*

- **Uploaded files** are checked by magic bytes, not by their declared type.
- **URLs submitted to intake** are resolved and checked even though the caller holds a valid key.
- **Query strings** are parsed by Zod into primitives only, so an operator object such as
  `{"$gt": ""}` never reaches a MongoDB query (NoSQL injection).
- **AI output is not trusted either.**
  - Gemini must return a fixed response schema.
  - Low-confidence values are marked "unverified extraction" and left out of statistics and
    matching.
  - Low-confidence records enter a human review queue.
- **TOR text is treated as untrusted on display.** React escapes it, and there is no
  `dangerouslySetInnerHTML`. Email templates use `escapeHtml`.

## 12. Privacy by Design

*Privacy is built in from the design phase.*

- **Consent at registration**, with PDPA-aligned wording. We do not claim certification.
- **Export and deletion on request**, from the account page.
- **Minimisation.**
  - Contact details in TOR documents pass through `lib/redact.ts` before they are displayed.
  - The mail adapter logs `recipient: "[redacted]"` (`adapters/log.mailer.ts:15`).
  - Logs carry record IDs and storage keys, never extracted field values or document contents.
- **No third-party trackers** on any page.

## 13. Never Assume Your Secrets Are Safe

*Design as if secrets may leak; limit the damage when one does.*

- **Passwords are hashed with argon2id.** Plaintext is never stored.
- **Reset and verification tokens are stored hashed** (`tokenHash`, `account-tokens.repository.ts`)
  and expire. A database leak does not reveal usable tokens.
- **Secret comparisons are constant-time** (`timingSafeEqual`): the intake/admin keys and the staff
  secret. Secrets are hashed first, so their length is not leaked either.
- **Secrets stay out of git.**
  - Local secrets live in `.env` and `secrets/`, both gitignored.
  - Production secrets live in Google Secret Manager.
  - `.env.example` is committed with names only.
- **Keys are lists**, so a key can be rotated without downtime.

## 14. Psychological Acceptability

*Security should not make the system harder to use than necessary, and should not leak information.*

- The whole interface is in Thai, the users' language, so security messages are understood.
- **Login errors say only "email or password is incorrect, or the email is not yet verified"**
  (`LoginView.tsx:33`). This matches Lec 7's own example: the message does not say which part was
  wrong.
- Consent is one clear step at registration, and export and deletion are one click on the account
  page.
- Vendors are not asked for a second factor (yet). The extra burden is reserved for admins, who
  hold the highest privilege (planned, T02).

## 15. Securing the Weakest Link

*An attacker targets the weakest point, so find it and fix it first.*

- **Threats are ranked by risk.** The threat model scores each threat as likelihood × impact and
  sorts by the result. Work is ordered by that ranking: P1 before P2 before P3.
- **The current weakest link is admin access through a shared secret** (T02, risk 15, the
  highest). It is the first item on the to-do list.

---

## Known gaps (honest status)

| Gap | Principle affected | Threat | Priority |
| :-- | :-- | :-- | :-- |
| Admins share one secret; no per-person admin accounts or TOTP | Separation of Duties, Weakest Link | T02 | P1 |
| No dependency audit in CI | Defense in Depth | T12 | P1 |
| No site-wide security headers (CSP, HSTS, frame-ancestors) | Defense in Depth, Secure Defaults | T05, T10 | P2 |
| Logins and 401/403 responses are not logged | Complete Mediation (accountability) | T15 | P2 |
| Containers run as root | Least Privilege | T03 | P2 |
| URL intake has no government-host allowlist | Least Privilege | T04 | P2 |
| One unescaped regex in `matching.repository.ts` | Zero Trust (input) | T07 | P3 |
