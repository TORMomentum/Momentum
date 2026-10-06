# Vendor accounts, sessions and PDPA rights — design

_Revision 2 (2026-10-06). Sprint 4. Jira TOR-94 (auth and roles), TOR-95 (auth flows),
TOR-96 (RBAC middleware), TOR-97 (PDPA export and delete). Realises **FR-D-1**, **FR-D-3**,
**NFR-S1**, **NFR-S2**._

_Revision 1 was reviewed against the code by a different-company model and failed on sixteen points,
three of them serious enough to stop the build: it allowed account takeover through Google sign-in,
it described a session topology that cannot physically work, and it left sign-in open to CSRF. The
corrections sit at the section that was wrong; §9 lists them._

## 1. What this is for

Nothing on the site knows who is asking, which is why the three things the 2026-10-06 review wanted
most — a dashboard of work on hand, matched TORs, and search that puts a vendor's own work first —
cannot be built. This slice is that identity and nothing more.

**In scope:** registration, email verification, sign-in by password and by Google, sessions, roles,
PDPA consent, export and deletion.
**Out of scope:** the vendor dashboard, matching, notification.

## 2. Decisions

### 2.1 Public sign-up only — no government identity, no national identifiers

Email and password, or Google. **No ThaiD.** No เลขประจำตัวประชาชน and no tax identifier is
collected, displayed or stored: the service cannot leak an identifier it never held (`NFR-S2`).

Two fields beyond the address are kept, each with a stated purpose, because a field without one is a
field that should not exist:

| Field | Why it is held | Lifetime |
| :--- | :--- | :--- |
| `displayName` | Shown in the account menu and on the profile; the vendor sets it, Google supplies it on first sign-in | Account lifetime; in the export; removed on deletion |
| `google.sub` | Google's stable subject, so a renamed or re-cased address still reaches the same account | Same |

No user-agent or device fingerprint is stored. Revision 1 proposed a `userAgentHash`; it served no
purpose in the flow and is the kind of quiet fingerprinting `NFR-S2` exists to prevent.

### 2.2 The browser's cookie belongs to the Next app; the session lives in the API

Revision 1 said the API sets the session cookie while Next calls the API server-to-server. That
cannot work: a `Set-Cookie` on a server-to-server fetch is received by the server that made the call,
never by the browser, and a cookie on the app's origin is not readable by a separate API origin.

The topology, stated once:

1. The browser posts to a **Next route handler** on the app's own origin — the rule every other
   privileged surface already follows.
2. Next calls the API, which creates a **session row** and returns its opaque id.
3. **Next** sets the browser cookie: `httpOnly`, `Secure` outside development, `SameSite=Lax`,
   host-only, `Path=/`, expiring with the session.
4. On every later request Next reads the cookie and passes the session id to the API in a header.
   The API resolves it to an account and a role on each call; nothing about the caller is believed
   from the cookie itself.

The cookie carries the session id and nothing else — no role, no account id, no claims.

### 2.3 Sessions are rows, so they can be withdrawn

`FR-D-3` lets a vendor demand deletion, and a self-contained token stays valid until it expires, so
"delete my account" would leave live credentials in the world. A row can be removed, and with it
every signed-in device.

**Every session is revoked when** the password changes, the role changes, the account is deleted, or
a reset completes. A promotion must not turn a stolen vendor session into an admin session.

### 2.4 Argon2id, with a dummy verification for unknown accounts

`NFR-S1` permits bcrypt or argon2; argon2id resists GPU attack in a way bcrypt's small memory
footprint does not. Parameters live in `core/config.ts` (`NFR-S7`).

`@node-rs/argon2` is the binding: it ships prebuilt binaries, and this project has already lost an
afternoon to a native module Windows Application Control refused to load.

An unknown address is verified against a **fixed dummy hash**, so the failing path does the same work
as the succeeding one. Revision 1 said "the same response time", which nobody can implement or test.

### 2.5 A password account is unusable until its address is verified

This closes the takeover revision 1 allowed: register with a victim's address and a password of your
choosing, wait for them to sign in with Google, and the automatic link hands you their account.

- Registration creates the account **unverified**; it cannot sign in and owns nothing.
- A single-use, hashed, expiring token sent by email verifies it.
- Google sign-in links to an existing account **only** when that account is already verified and
  Google asserts `email_verified` for the same address. Otherwise it creates its own account.

**This depends on outbound email, which does not exist yet** (TOR-33/34). Until it does, Google
sign-in is the only path that completes, and password registration is built but gated. The
dependency is stated here rather than discovered mid-build.

### 2.6 Google is validated claim by claim

Authorisation Code with PKCE. The transaction — `state`, `nonce`, PKCE verifier, redirect URI — is a
short-lived server-side row consumed atomically on return, not a cookie that can be replayed.

The ID token is accepted only when issuer, audience, `azp`, expiry and `nonce` all match, and the
redirect URI equals the single registered value. Google's tokens are read once for the profile and
discarded; the platform never holds anything that would let it act as the vendor elsewhere.

### 2.7 Every state-changing route checks the origin

`SameSite=Lax` does not stop a cross-site form POST from establishing a session — an attacker can
sign a victim into the attacker's account and then read whatever the victim types into it. Register,
sign in, sign out, password change, deletion and every `/me/*` write check `Origin`/`Referer`
against the app's own origin and reject when it is foreign or absent.

### 2.8 Auth has its own rate limits

The existing limiter is mounted on `/intake` only. Auth gets its own, keyed on **both** the source
address and the normalised email, covering register, verify, sign in, reset, Google start and
callback, export and deletion. Limits live in `core/config.ts`. Exceeding one answers 429 and nothing
else.

### 2.9 Failure says one thing

An unknown address, a wrong password and an unverified account return one status and one body. An
address that is already registered receives an email saying so; the form says what it says to every
other registration. Registration without consent fails.

### 2.10 Roles are read from the record, and the staff gate is untouched

`vendor`, `admin`. The role is read from the account row on every request. One `requireRole`
middleware guards every non-public API route; public routes are listed, never assumed.

**Unchanged by this slice:** the Next staff cookie (`staff-session.ts`) guarding the review screens,
and the `ADMIN_API_KEYS` the app proxies to `/admin/*`. Revision 1 implied `requireRole` replaced
both; it does not. Moving admins onto accounts is its own design, after this works.

## 3. Data model

| Collection | Key | Fields |
| :--- | :--- | :--- |
| `accounts` | unique `email` **where `deletedAt` is absent** (partial) | `displayName`, `passwordHash?`, `emailVerifiedAt?`, `google?: { sub }`, `role`, `consent`, `createdAt`, `updatedAt`, `deletedAt?` |
| `sessions` | `_id` random 256-bit | `accountId`, `createdAt`, `expiresAt`, `lastSeenAt` · TTL on `expiresAt` |
| `auth_tokens` | `tokenHash` | `accountId`, `purpose: "verify" \| "reset"`, `expiresAt`, `consumedAt?` · TTL |
| `oauth_transactions` | `_id` | `stateHash`, `nonce`, `codeVerifier`, `redirectUri`, `expiresAt`, `consumedAt?` · TTL |
| `reauth_grants` | `_id` | `accountId`, `sessionId`, `expiresAt`, `consumedAt?` · TTL |

The partial unique index is why deletion works twice: a plain unique index permits only one missing
value, so a second deleted account would collide with the first.

`consent` records what was agreed to, not merely that something was:
`{ noticeVersion, noticeHash, agreedAt, action: "checkbox" }`. A version alone cannot show what the
text said once the text changes.

### 3.1 What an account owns

Export and deletion are only as good as this list, and `FR-D-3` covers everything the account holds,
not only its login:

| Collection | On export | On deletion |
| :--- | :--- | :--- |
| `accounts` | all fields | identifying fields removed, `deletedAt` set |
| `sessions` | count only | removed |
| vendor profile (TOR-29) | all fields | removed |
| bookmarks (TOR-52) | all rows | removed |
| matches and sent notifications (TOR-33/37) | all rows | removed, except a minimal record that an email was sent, which is an audit obligation rather than personal data |
| `tor_events`, `corrections` | staff actions, not vendor data — excluded | retained: they describe a document's history, and an admin's correction is not the vendor's personal data |

Every vendor-owned collection carries `accountId` for exactly this reason. A collection added later
without one cannot be exported or deleted, so the field is part of what "vendor-owned" means.

## 4. Routes

The contract `docs/API.md` already reserves is kept — revision 1 invented `/account/*`:

| Route | Does |
| :--- | :--- |
| `POST /auth/register` | Validates, records consent, hashes, creates an unverified account, sends the verification email |
| `POST /auth/verify` | Consumes the token, marks verified |
| `POST /auth/login` | Verifies against the hash or the dummy, creates a session |
| `POST /auth/logout` | Deletes the session row |
| `POST /auth/password/forgot` · `/auth/password/reset` | Single-use hashed expiring token; revokes every session |
| `POST /auth/password/change` | Requires the current password; revokes every other session |
| `GET /auth/google/start` · `/auth/google/callback` | §2.6 |
| `GET /api/v1/me` | The signed-in account |
| `GET /api/v1/me/export` | §3.1, as JSON (`FR-D-3`) |
| `DELETE /api/v1/me` | §3.1, after a re-authentication grant |

**Re-authentication before deletion** is a short-lived grant bound to the account and the session,
issued by re-entering the password or by a fresh Google sign-in (`prompt=login`), consumed atomically
by the delete. A long-lived stolen session cannot by itself destroy an account.

## 5. Configuration (`NFR-S7`)

`SESSION_SECRET` (required, no default) · `SESSION_LIFETIME_MS` · `ARGON2_MEMORY_KIB` ·
`ARGON2_ITERATIONS` · `ARGON2_PARALLELISM` · `AUTH_RATE_LIMIT_PER_IP` ·
`AUTH_RATE_LIMIT_PER_EMAIL` · `VERIFY_TOKEN_TTL_MS` · `RESET_TOKEN_TTL_MS` · `REAUTH_GRANT_TTL_MS` ·
`OAUTH_TRANSACTION_TTL_MS` · `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` · `GOOGLE_REDIRECT_URI` ·
`CONSENT_NOTICE_VERSION`.

## 6. Testing

Every control above is a test, because a security control nobody tested is a claim:

| Area | Cases |
| :--- | :--- |
| Enumeration | Unknown address, wrong password and unverified account return the identical status and body; the unknown path performs a dummy verification |
| CSRF | Register, sign in, sign out, password change and delete are refused with a foreign or absent `Origin` |
| Takeover | Google does NOT link to an unverified account; it does link to a verified one; an unverified Google address never links |
| OAuth | Mismatched `state`, replayed transaction, wrong `aud`/`azp`/issuer, expired token, and a redirect URI that is not the registered one are each refused |
| Sessions | Expired session rejected; cookie attributes exactly as §2.2; password change, role change and deletion revoke every session |
| Deletion | Re-authentication required; a second account with the same address can register afterwards; the first account's profile and bookmarks are gone |
| Consent | Registration without consent fails; the stored record names the notice version and hash; the export contains it |
| Rate limits | Each auth route answers 429 past its limit, keyed by address and by email |
| Live | Register, verify, sign in, sign out, delete — in a browser, against the composed stack |

## 7. Sequencing

1. Schema, config, session mechanism, `requireRole` — nothing user-visible.
2. Google sign-in end to end — the path that can complete today.
3. Password registration, verification and reset — **gated on outbound email** (TOR-33/34).
4. PDPA export and deletion.

## 8. Open

| Question | Needs |
| :--- | :--- |
| Outbound email does not exist, and verification and reset both need it | TOR-33/34, which this now blocks on |
| When do admins move off `ADMIN_API_KEYS` and the staff cookie onto accounts? | Its own design, after this |
| The consent notice text, and where it is versioned so a change is demonstrable | The PDPA notice copy (`NFR-S2`) |

## 9. What revision 1 got wrong

1. Google linked to any account with a matching address, so pre-registering a victim's address took it over.
2. The session topology could not work: an API `Set-Cookie` never reaches the browser through a server-to-server call.
3. Sign-in was open to CSRF; `SameSite=Lax` does not prevent it.
4. No session signing key or lifetime in configuration, against `NFR-S7`.
5. "The same response time" was unimplementable; a dummy hash verification is the rule.
6. Rate limits were assumed from a limiter mounted only on `/intake`.
7. No password reset or change existed, though revocation on password change was claimed.
8. A plain unique email index permits one deleted account, not two.
9. Export and deletion covered the login only, not the profile, bookmarks or matches `FR-D-3` means.
10. `userAgentHash` was fingerprinting with no stated purpose.
11. Consent as `{version, at}` could not show what was agreed to.
12. A role change left existing sessions standing.
13. Re-authentication before deletion was asserted, never designed.
14. Route names contradicted the `/me/*` contract already in `docs/API.md`.
15. The staff cookie and admin API key were described as replaced; they are not.
16. The tests named none of the security cases above.
