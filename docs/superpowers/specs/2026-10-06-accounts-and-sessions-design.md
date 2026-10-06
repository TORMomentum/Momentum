# Vendor accounts, sessions and PDPA rights — design

_Sprint 4. Covers Jira TOR-94 (auth and roles) with TOR-95 (auth flows), TOR-96 (RBAC middleware)
and TOR-97 (PDPA export and delete). Realises **FR-D-1**, **FR-D-3**, **NFR-S1**, **NFR-S2**._

## 1. What this is for

Nothing on the site knows who is asking. That is why the three things the 2026-10-06 review wanted
most — a dashboard of what is on hand, matched TORs, and search that puts a vendor's own work first —
cannot be built. This slice is the identity those depend on, and nothing more.

**In scope:** registration, sign-in by password and by Google, sessions, roles on every route, PDPA
consent, export and deletion.
**Out of scope:** the vendor dashboard, matching, and notification — they consume this, and each has
its own card.

## 2. Decisions

### 2.1 Public sign-up only — no government identity, no national identifiers

Decided 2026-10-06 (PLAN.md): email and password, or Google. **No ThaiD.** No
เลขประจำตัวประชาชน and no tax identifier is collected, displayed or stored, which is PDPA
minimisation (`NFR-S2`): the service cannot leak an identifier it never held. A vendor is identified
by an email address and nothing else that could identify a person off this site.

### 2.2 Server-side sessions, not tokens the server cannot withdraw

A session is a record in `sessions`, named by an opaque random id held in a signed, `httpOnly`,
`SameSite=Lax`, `Secure` cookie. Not a JWT.

The deciding requirement is `FR-D-3`: a vendor may demand deletion. A self-contained token stays
valid until it expires, so "delete my account" would leave live credentials in the world for the
remainder of their lifetime. A session row can be removed, and with it every device that was signed
in. The same property closes a stolen laptop and a changed password.

The staff cookie (`staff-session.ts`) keeps its separate shared-secret mechanism: it guards the
review queue, is not an account, and is replaced wholesale when admin accounts land.

### 2.3 Argon2id for passwords

`NFR-S1` permits bcrypt or argon2. Argon2id is chosen: it is the current recommendation, and it
resists GPU attack in a way bcrypt's small memory use does not. Parameters live in `core/config.ts`
like every other tunable, so they can be raised as hardware improves without a code change.

`@node-rs/argon2` is the binding, because it ships prebuilt binaries — the pure-native `argon2`
package needs a compiler, and this project's Windows machines have already lost an afternoon to a
native module Application Control refused to load.

### 2.4 Google sign-in links by verified email, and only by verified email

Authorisation Code with PKCE, `state` and `nonce` checked on return. An account is matched to an
existing one when Google asserts `email_verified` for the same address; an unverified Google email
never adopts an existing account, because that is account takeover by registration.

Google's tokens are used to read the profile once and then discarded. The platform stores the
address, the display name and the subject identifier — nothing that would let it act as the vendor
elsewhere.

### 2.5 Sign-in tells an attacker nothing it does not already know

One message for an unknown address and for a wrong password, a constant-time compare, and the same
response time for both paths. Rate limited per address and per source address, through the existing
limiter. Registration behaves the same way: an address already registered receives an email saying
so rather than an error on screen, so the form cannot be used to enumerate who has an account.

### 2.6 Roles are checked on the server, every time

`vendor`, `admin`. The role is read from the session record on each request, never from the cookie
and never from the client, so a role cannot be edited into existence. One middleware, `requireRole`,
wraps every route that is not public; the public routes stay public by listing, not by omission.

The intake API keys stay as they are: machine callers are not accounts.

## 3. Data model

| Collection | Key | Fields |
| :--- | :--- | :--- |
| `accounts` | unique `email` (lowercased, trimmed) | `displayName`, `passwordHash?`, `google?: { sub }`, `role`, `consent: { version, at }`, `createdAt`, `updatedAt`, `deletedAt?` |
| `sessions` | `_id` = random 256-bit id | `accountId`, `createdAt`, `expiresAt`, `lastSeenAt`, `userAgentHash` |

`passwordHash` is absent for a Google-only account, and `google` is absent for a password-only one;
an account may hold both once linked. A TTL index on `sessions.expiresAt` lets MongoDB expire
sessions without a sweeper.

Deletion (`FR-D-3`) empties the identifying fields, sets `deletedAt`, and removes every session.
The row remains so a re-registration of the same address is a new account rather than a resurrection
of the old one's history.

## 4. The flows

| Route | Does |
| :--- | :--- |
| `POST /api/v1/auth/register` | Validates, records consent with its version, hashes, creates the account and a session |
| `POST /api/v1/auth/login` | Verifies, creates a session, sets the cookie |
| `POST /api/v1/auth/logout` | Deletes the session row, clears the cookie |
| `GET /api/v1/auth/google/start` | Redirects with PKCE, `state` and `nonce` in a short-lived cookie |
| `GET /api/v1/auth/google/callback` | Verifies all three, links or creates, creates a session |
| `GET /api/v1/auth/me` | The signed-in account, or 401 |
| `GET /api/v1/account/export` | Everything held about the caller, as JSON (`FR-D-3`) |
| `DELETE /api/v1/account` | Deletes as §3 describes, after re-authentication |

The web app never calls these from the browser: the Next server does, as every other privileged
surface does, and the session cookie is set on the app's own origin.

## 5. Testing

| Level | What |
| :--- | :--- |
| Unit | Password hashing and verification; the consent record; the session id's entropy and expiry arithmetic |
| Integration | Register, sign in, sign out; a wrong password and an unknown address are indistinguishable in body and status; a deleted account's sessions are gone; an expired session is rejected; a role is read from the record and not from the cookie |
| Integration | Google: a mismatched `state`, a replayed `nonce` and an unverified email are each refused; a verified email links to the existing account |
| Live | Register in a browser, sign in, see the account menu, delete the account, confirm the session no longer opens any signed-in page |

## 6. Open

| Question | Needs |
| :--- | :--- |
| Who sends the "this address is already registered" email, before notification exists? | The SMTP work in TOR-33/34 |
| Does an admin account replace the staff shared secret in this slice or the next? | A decision once vendor accounts work |
| Consent version — what text, and where is it kept so a change can be shown to be a change? | The PDPA notice copy (`NFR-S2`) |
