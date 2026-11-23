# Access control matrix

Evidence for threat T08 and ASVS V8.1.1: who may call what, what enforces it, and what keeps a vendor
to its own data. Built by reading the routers, not from memory. Last read against the code on 2026-11-20.

[`apps/api/src/core/access-control.test.ts`](../../apps/api/src/core/access-control.test.ts) **reads the
table in section 3 and compares it with the routers the app mounts**: a route added without a row, or a
row left behind, fails the test. It then proves the rules below against the real database: no session gives
401 on every vendor route; a vendor session gives 401 on every admin and intake route; and vendor B, with a
real session, never receives vendor A's profile, bookmarks, vault file, behaviour events, account export or
matches, by listing or by id.

## 1. Who can call

| Caller | Credential | Where it is checked |
| :---- | :---- | :---- |
| `public` | none | not checked. Reads of published, unrestricted records only |
| `vendor` | session id in `x-session-id`, set by the Next server from its `httpOnly` cookie | `sessionContext` resolves it to the live account on every request ([session-context.ts:22](../../apps/api/src/core/session-context.ts)); a disabled or deleted account resolves to nothing ([sessions.ts:30](../../apps/api/src/modules/accounts/sessions.ts)). Each route then refuses a missing `req.auth` |
| `admin-key` | `x-api-key` equal to one of `ADMIN_API_KEYS` | `requireKey`, constant-time compare ([intake.auth.ts:35](../../apps/api/src/modules/intake/intake.auth.ts)). The key is held by the Next server and never reaches the browser |
| `intake-key` | `x-api-key` equal to one of `INTAKE_API_KEYS` | the same `requireKey`, with the intake key list |

There is **no admin session in the API**. A signed-in account's role does not open an admin route: only the
key does. `requireRole` ([require-role.ts](../../apps/api/src/core/require-role.ts)) exists and is unit-tested
but no route uses it (finding F2).

State-changing vendor routes also pass `requireSameOrigin` ([require-same-origin.ts](../../apps/api/src/core/require-same-origin.ts)),
and the sign-in family adds `authRateLimit`; both run before the session check, so a request with a wrong
origin is answered 403 before it is asked who it is.

## 2. How a vendor is kept to its own data

No `/me` route takes an account id from the request. The account id is always
`req.auth.account._id`, from the session, and every repository call carries it in the filter:

| Data | Scoped by | Id in the URL | Another vendor's id answers |
| :---- | :---- | :---- | :---- |
| Profile | `vendorProfiles.findOne({ accountId })` (profile.repository.ts) | none | n/a |
| Bookmarks | `{ accountId, torId }` (bookmarks.repository.ts) | a **TOR** id (public record), not an owner id | the vendor's own row only: a `DELETE` of a TOR the caller did not save changes nothing |
| Vault files | `{ _id, accountId, status: "ready" }` ([vault.repository.ts:61](../../apps/api/src/modules/vault/vault.repository.ts)); storage key `vault/<accountId>/<uuid>` | vault item id | **404**, identical to an id that does not exist |
| Behaviour events | `accountId` from the session; consent is the account's own | TOR id in the body | recorded for the caller only |
| Matches, scores, path | the caller's own profile | none | n/a |
| Draft | the caller's profile and vault; the TOR is public | TOR id | the draft is built from the caller's data only |
| Export, delete, consent | `req.auth.account._id` | none | n/a |

## 3. API routes

Paths are as mounted by [app.ts](../../apps/api/src/app.ts) under `/api/v1`. The account, profile, bookmark,
behaviour, matching, path, vault and draft routers are mounted twice, also under `/auth` (the prefix the Next
handler forwards to); the same router object serves both, so one row covers both paths. This table is read by the
test: keep the first three columns exactly `METHOD`, `` `path` ``, caller.

| Method | Path | Caller | Enforced by | Vendor scoping |
| :---- | :---- | :---- | :---- | :---- |
| GET | `/health` | public | none (mounted outside `/api/v1`) | none, no data |
| GET | `/sources/bma-egp/tors` | public | none (finding F1) | none, upstream BMA eGP data |
| GET | `/sources/bma-egp/tors/:projectId/documents` | public | none (finding F1) | none, upstream BMA eGP data |
| POST | `/api/v1/register` | public | `requireSameOrigin`, `authRateLimit` ([accounts.routes.ts:51](../../apps/api/src/modules/accounts/accounts.routes.ts)) | creates an account |
| POST | `/api/v1/verify` | public | single-use emailed token ([accounts.routes.ts:85](../../apps/api/src/modules/accounts/accounts.routes.ts)) | the token names the account |
| GET | `/auth/google/start` | public | OAuth enabled, rate limited | starts browser-bound Google sign-in |
| POST | `/auth/google/callback` | public | same origin, OAuth state and browser binding | verifies identity |
| POST | `/auth/google/complete` | public | same origin, consent, signup ticket and mailbox proof when required | completes signup |
| POST | `/api/v1/login` | public | same-origin, rate limit, password check ([accounts.routes.ts:92](../../apps/api/src/modules/accounts/accounts.routes.ts)) | issues a session for that account |
| POST | `/api/v1/logout` | public | same-origin, rate limit ([accounts.routes.ts:101](../../apps/api/src/modules/accounts/accounts.routes.ts)) | revokes only the session id presented (F4) |
| POST | `/api/v1/password/forgot` | public | same-origin, rate limit ([accounts.routes.ts:107](../../apps/api/src/modules/accounts/accounts.routes.ts)) | sends to the account's own address |
| POST | `/api/v1/password/reset` | public | single-use emailed token ([accounts.routes.ts:117](../../apps/api/src/modules/accounts/accounts.routes.ts)) | the token names the account |
| POST | `/api/v1/password/change` | vendor | `req.auth` ([accounts.routes.ts:127](../../apps/api/src/modules/accounts/accounts.routes.ts)) plus current password | session account |
| GET | `/api/v1/me` | vendor | `req.auth` ([accounts.routes.ts:139](../../apps/api/src/modules/accounts/accounts.routes.ts)) | session account |
| POST | `/api/v1/me/consent/behaviour` | vendor | `req.auth` ([accounts.routes.ts:146](../../apps/api/src/modules/accounts/accounts.routes.ts)) | session account |
| POST | `/api/v1/me/consent/behaviour/withdraw` | vendor | `req.auth` ([accounts.routes.ts:152](../../apps/api/src/modules/accounts/accounts.routes.ts)) | session account |
| POST | `/api/v1/me/consent/withdraw` | vendor | `req.auth` ([accounts.routes.ts:158](../../apps/api/src/modules/accounts/accounts.routes.ts)) | session account |
| GET | `/api/v1/me/export` | vendor | `req.auth` ([accounts.routes.ts:164](../../apps/api/src/modules/accounts/accounts.routes.ts)) | `exportOwnedData(session account)` |
| DELETE | `/api/v1/me` | vendor | `req.auth` plus current password ([accounts.routes.ts:174](../../apps/api/src/modules/accounts/accounts.routes.ts)) | session account only: its vault, tokens, profile, bookmarks, events |
| GET | `/api/v1/me/profile` | vendor | `req.auth` ([profile.routes.ts:147](../../apps/api/src/modules/profile/profile.routes.ts)) | `accountId` filter |
| PUT | `/api/v1/me/profile` | vendor | `req.auth` ([profile.routes.ts:152](../../apps/api/src/modules/profile/profile.routes.ts)), same-origin | `accountId` filter |
| PUT | `/api/v1/me/profile/extras` | vendor | `req.auth` ([profile.routes.ts:165](../../apps/api/src/modules/profile/profile.routes.ts)), same-origin | `accountId` filter |
| GET | `/api/v1/me/bookmarks` | vendor | `req.auth` ([bookmarks.routes.ts:19](../../apps/api/src/modules/bookmarks/bookmarks.routes.ts)) | `accountId` filter; omits a TOR a takedown made unavailable |
| GET | `/api/v1/me/bookmarks/ids` | vendor | `req.auth` ([bookmarks.routes.ts:32](../../apps/api/src/modules/bookmarks/bookmarks.routes.ts)) | `accountId` filter |
| PUT | `/api/v1/me/bookmarks/:torId` | vendor | `req.auth` ([bookmarks.routes.ts:39](../../apps/api/src/modules/bookmarks/bookmarks.routes.ts)), same-origin | `accountId` filter |
| DELETE | `/api/v1/me/bookmarks/:torId` | vendor | `req.auth` ([bookmarks.routes.ts:50](../../apps/api/src/modules/bookmarks/bookmarks.routes.ts)), same-origin | `accountId` filter |
| POST | `/api/v1/me/events` | vendor | `req.auth` ([behaviour.routes.ts:24](../../apps/api/src/modules/behaviour/behaviour.routes.ts)), same-origin, consent | `accountId` from session |
| GET | `/api/v1/me/matches` | vendor | `req.auth` ([matching.routes.ts:51](../../apps/api/src/modules/matching/matching.routes.ts)) | the caller's own profile |
| GET | `/api/v1/me/matches/scores` | vendor | `req.auth` ([matching.routes.ts:85](../../apps/api/src/modules/matching/matching.routes.ts)) | the caller's own profile |
| GET | `/api/v1/me/path` | vendor | `req.auth` ([path.routes.ts:19](../../apps/api/src/modules/path/path.routes.ts)) | the caller's own profile |
| GET | `/api/v1/me/vault` | vendor | `owner()` ([vault.routes.ts:110](../../apps/api/src/modules/vault/vault.routes.ts)) | `accountId` filter |
| POST | `/api/v1/me/vault` | vendor | `owner()`, same-origin | key `vault/<accountId>/<uuid>`; slot cap per account |
| GET | `/api/v1/me/vault/:id/file` | vendor | `owner()` | `{ _id, accountId }`; 404 for another account's id |
| DELETE | `/api/v1/me/vault/:id` | vendor | `owner()`, same-origin | `{ _id, accountId }`; 404 for another account's id |
| POST | `/api/v1/me/tors/:id/draft` | vendor | `req.auth` ([drafts.routes.ts:20](../../apps/api/src/modules/drafts/drafts.routes.ts)), same-origin, per-account rate limit | the caller's own profile and vault |
| GET | `/api/v1/tors` | public | none; `minMatch`/`maxMatch` additionally need `req.auth` ([tors.routes.ts:44](../../apps/api/src/modules/tors/tors.routes.ts)) | the filter scores the caller's own profile |
| GET | `/api/v1/tors/facets` | public | none | none |
| GET | `/api/v1/export/tors.csv` | public | own rate limit (`EXPORT_RATE_LIMIT_PER_MIN`); `minMatch`/`maxMatch` need `req.auth` ([export.routes.ts:32](../../apps/api/src/modules/export/export.routes.ts)) | the list serializer, so nothing `GET /tors` does not show; restricted records excluded; the match filter scores the caller's own profile |
| HEAD | `/api/v1/tors/:id/document` | public | none; restricted records answer 404 ([tors.service.ts:199](../../apps/api/src/modules/tors/tors.service.ts)) | none |
| GET | `/api/v1/tors/:id/document` | public | as above | none |
| GET | `/api/v1/tors/:id` | public | none | none |
| GET | `/api/v1/stats/dashboard` | public | none | none, aggregate |
| POST | `/api/v1/intake/upload` | admin-key | `requireKey` ([intake.routes.ts:105](../../apps/api/src/modules/intake/intake.routes.ts)), IP rate limit | none |
| POST | `/api/v1/intake/url` | admin-key | `requireKey` ([intake.routes.ts:115](../../apps/api/src/modules/intake/intake.routes.ts)), SSRF helper | none |
| POST | `/api/v1/intake` | intake-key | `requireKey` with the intake keys ([intake.routes.ts:128](../../apps/api/src/modules/intake/intake.routes.ts)) | none |
| GET | `/api/v1/admin/queue` | admin-key | `router.use(requireKey)` ([admin.routes.ts:87](../../apps/api/src/modules/admin/admin.routes.ts)) | all records |
| GET | `/api/v1/admin/overview` | admin-key | as above | all records |
| GET | `/api/v1/admin/events` | admin-key | as above | all records |
| GET | `/api/v1/admin/tors` | admin-key | as above | all records |
| GET | `/api/v1/admin/tors/ids` | admin-key | as above | all records |
| GET | `/api/v1/admin/tors/:id` | admin-key | as above | all records |
| HEAD | `/api/v1/admin/tors/:id/document` | admin-key | as above | includes restricted records |
| GET | `/api/v1/admin/tors/:id/document` | admin-key | as above | includes restricted records |
| GET | `/api/v1/admin/tors/:id/pages/:page` | admin-key | as above | includes restricted records |
| PATCH | `/api/v1/admin/tors/:id/fields` | admin-key | as above | all records |
| PATCH | `/api/v1/admin/tors/:id/fields/:field/verification` | admin-key | as above | all records |
| POST | `/api/v1/admin/tors/:id/approve` | admin-key | as above | all records |
| POST | `/api/v1/admin/tors/bulk` | admin-key | as above | all records |
| POST | `/api/v1/admin/tors/:id/reextract` | admin-key | as above | all records |
| POST | `/api/v1/admin/tors/:id/reject` | admin-key | as above | all records |
| POST | `/api/v1/admin/tors/:id/restore` | admin-key | as above | all records |
| GET | `/api/v1/admin/reports/other-terms` | admin-key | `router.use(requireKey)` ([admin-accounts.routes.ts:30](../../apps/api/src/modules/admin/admin-accounts.routes.ts)) | all accounts |
| GET | `/api/v1/admin/accounts` | admin-key | as above | all accounts |
| GET | `/api/v1/admin/accounts/:id` | admin-key | as above | any account, by design |
| PUT | `/api/v1/admin/accounts/:id/profile` | admin-key | as above | any account, by design |
| POST | `/api/v1/admin/accounts/:id/role` | admin-key | as above | any account, by design |
| POST | `/api/v1/admin/accounts/:id/disable` | admin-key | as above | any account, by design |
| POST | `/api/v1/admin/accounts/:id/enable` | admin-key | as above | any account, by design |
| POST | `/api/v1/admin/accounts/:id/verification-email` | admin-key | as above | any account, by design |
| POST | `/api/v1/admin/accounts/:id/match-email` | admin-key | as above | any account, by design |
| POST | `/api/v1/admin/accounts/:id/password-reset` | admin-key | as above | any account, by design |
| GET | `/api/v1/admin/match-quality` | admin-key | `router.use(requireKey)` ([match-quality.routes.ts:13](../../apps/api/src/modules/match-quality/match-quality.routes.ts)) | all accounts |
| GET | `/api/v1/admin/sources` | admin-key | `router.use(requireKey)` ([sources.routes.ts:11](../../apps/api/src/modules/sources/sources.routes.ts)) | all sources (TOR-87) |
| GET | `/api/v1/admin/accounts/:id/labels` | admin-key | as above | any account, by design |
| PUT | `/api/v1/admin/accounts/:id/labels/:torId` | admin-key | as above | any account, by design |

## 4. Web layer (Next.js)

The Next server is not an enforcement point for vendor data: it forwards the cookie's session id to the API
and the API decides. It does enforce the two things the API cannot see.

| Surface | Who | Check |
| :---- | :---- | :---- |
| `/api/auth/[...path]` ([route.ts](../../apps/web/app/api/auth/[...path]/route.ts)) | public and vendor | same-origin check on every write, then forwards under `/auth` with the session cookie. Sets the session cookie on login and clears the staff cookie |
| `/api/vault`, `/api/vault/[id]` | vendor | no cookie gives 401 before the API is called; same-origin on writes; the API answers 404 for another account's file and only 404/401 are passed on |
| `/api/tors/[id]/draft` | vendor | same-origin; no cookie gives 401; the TOR is the only thing taken from the request |
| `/api/export/tors.csv` ([route.ts](../../apps/web/app/api/export/tors.csv/route.ts)) | public and vendor | relays the API's CSV through the document proxy unbuffered, forwarding the session cookie as `x-session-id` only so the match filter works; the API's `attachment`, `no-store` and `nosniff` headers pass through |
| `/tors/[id]/document` | public | proxies the public API route |
| `/admin/tors/[id]/document`, `/admin/tors/[id]/pages/[page]` | staff | `isStaff()` first, then the server-held admin key is attached; otherwise 404 ([staff-session.ts:132](../../apps/web/src/shared/lib/staff-session.ts)) |
| every `/admin/*` page (overview, log, review, sources, terms, tors, tors/[id], upload, vendors, vendors/[id], vendors/[id]/labels) | staff | `isStaff()` else redirect to `/admin/login` |
| every Server Action in `admin.actions.ts` and `admin-accounts.actions.ts` | staff | `requireStaff()` first |
| `/admin/login` | public | accepts `STAFF_ACCESS_SECRET` (constant-time), sets a signed 8-hour cookie |
| `/profile`, `/account`, `/notifications`, `/profile/path` | vendor | render a sign-in prompt without a session; data comes only from the API, which answers 401 |
| `/`, `/search`, `/tors/[id]`, `/dashboard`, `/methodology`, `/login`, `/verify`, `/forgot-password`, `/reset-password` | public | none |

**Staff pass.** `STAFF_ACCESS_SECRET` gives a signed cookie, not tied to an account. If an account session is
also present, that account must have role `admin`, or the pass is refused; if the role cannot be read the
answer is no ([staff-session.ts:25](../../apps/web/src/shared/lib/staff-session.ts)). Signing in as an account
drops the staff cookie. There is no Next `middleware.ts` or `proxy.ts`: each page and handler checks for itself.

## 5. Findings

Left alone on purpose; each is larger than a small fix.

| # | Finding | Why it matters | Suggested follow-up |
| :---- | :---- | :---- | :---- |
| F1 | `/sources/bma-egp/*` is public, unauthenticated, not rate-limited, and mounted outside `/api/v1` ([app.ts](../../apps/api/src/app.ts), [routes/sources.ts](../../apps/api/src/routes/sources.ts)). Each call fans out to the upstream BMA eGP service | exposes no vendor data, but lets any caller spend the upstream's goodwill and our egress. It is a developer exploration route that ships in the production app | gate behind `admin-key`, or mount it only in development |
| F2 | The admin API authenticates with a shared key, not a person. Every admin action is attributed to the literal actor `admin`, and `requireRole` is used by no route | no per-admin accountability; a leaked key is full admin. A known stopgap (TOR-199) | replace `requireKey` with an admin-role session check and stamp the account id as actor |
| F3 | The web staff gate and the API admin gate use different credentials (`STAFF_ACCESS_SECRET` and `ADMIN_API_KEYS`) | acceptable while the Next server is the only holder of the key, but an admin-role account session alone opens nothing | resolved by F2 |
| F4 | `POST /logout` revokes whatever session id is presented, valid or not, with no check that it is the caller's | the id is an unguessable secret, so this already needs the secret; noted for completeness | none needed |
