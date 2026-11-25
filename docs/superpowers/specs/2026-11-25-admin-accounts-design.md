# Admin sign-in with individual accounts — design

**Cards:** TOR-199 (TOR-299, TOR-300, TOR-301) · **Date:** 2026-11-25 · **Status:** approved 2026-11-25
**Builds on:** [accounts and sessions](2026-10-06-accounts-and-sessions-design.md) (its open question "when do admins move
off `ADMIN_API_KEYS` and the staff cookie onto accounts? — its own design, after this") · access-control matrix
findings F2 and F3 ([docs/security/access-control-matrix.md](../../security/access-control-matrix.md))
**Requirements:** NFR-S1 (access level enforced on admin and API routes), FR-G-1, FR-G-2, ASVS V8 (authorization), V16.3 (security logging)

## 1. Context

Two shared credentials open the admin side today, and neither names a person:

| Gate | Credential | Held by |
| :--- | :--- | :--- |
| Web `/admin/*` pages, admin Server Actions, admin document proxies | `tor_staff` cookie, signed with `STAFF_ACCESS_SECRET` after typing that one password at `/admin/login` | every admin |
| API `/admin/*`, `POST /intake/upload`, `POST /intake/url` | `x-api-key` from `ADMIN_API_KEYS` | the Next server, attached to every admin call |

So every admin action is recorded with the literal actor `admin` (finding F2), a leaked key or password is full
admin, and an account with role `admin` opens nothing by itself (F3). Accounts already carry `role: "vendor" | "admin"`,
read from the account row on every request (`req.auth`), and `requireRole` exists but no route uses it.

## 2. Decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | What opens the admin API? | **An account session whose account has role `admin`.** The Next server forwards the signed-in account's session id as `x-session-id`, as it already does for vendor routes; a new `requireAdmin` (in `core/`) answers 401 without a session and 403 for any other role. It replaces `requireKey(adminKeys, "admin")` on every admin router and on `POST /intake/upload` and `/intake/url` (TOR-299) |
| 2 | Does `ADMIN_API_KEYS` stay as a second way in? | **No.** No tool or script calls an admin route (only `demo-seed.mjs`, which uses the intake key). Keeping the key would keep "a leaked key is full admin". It leaves config, Compose, Cloud Run, CI and `.env.example`. `INTAKE_API_KEYS` for `POST /intake` is unchanged |
| 3 | What does the audit record as the actor? | **The account id** (`req.auth.account._id`), in `admin_audit`, `tor_events.actor`, `statusHistory.actor`, corrections, and the `admin.action` security log line, whose `authMethod` becomes `session` (TOR-300). An id, not an email: the security log must not carry personal data (NFR-S2), and the id resolves to a person through the accounts collection |
| 4 | What opens the web staff area? | **The same thing:** `requireStaff()` / `isStaff()` ask the API `GET /me` with the session cookie and accept role `admin`. The `tor_staff` cookie, its HMAC and `STAFF_ACCESS_SECRET` are deleted (TOR-301). Failing closed is kept: if the role cannot be read, the answer is no |
| 5 | Where does an admin sign in? | **The normal sign-in page** (`/login`, password or Google). `StaffLoginForm` is removed. ~~An `/admin/*` page without an admin session redirects to `/login?next=/admin`~~ — superseded, see §5 |
| 6 | How does the first admin exist? | A tool, `tools/grant_admin.mts --email <address>`, sets role `admin` through the accounts repository's `changeRole`, which already revokes the account's sessions so a promoted session is never reused (accounts spec, "a promotion must not turn a stolen vendor session into an admin session"). Later admins are promoted from the vendor screen, which already has a role control. The first admins agreed by the team: Peerapas, Sran and Sudha; granted on Atlas when this deploys, since the grant signs them out |
| 7 | Session rules for admins | Unchanged from accounts: 7-day absolute, 30-minute idle, single active session by default. No separate admin lifetime in this change |
| 8 | The staff/site mode switch | Kept; it shows for an admin account instead of for the staff cookie |

## 3. What is not done here

- A separate, shorter admin session lifetime or step-up authentication (MFA).
- Showing the admin's name in the admin log page: the id is recorded; resolving it for display is a later change.
- Deleting the `ADMIN_API_KEYS` / `STAFF_ACCESS_SECRET` secrets from Secret Manager: the deploy stops reading them; removing them is an operator step listed in TODO.md.

## 4. Docs this changes

API.md (auth column of every admin route and the two intake routes), ARCHITECTURE.md, the access-control matrix
(F2, F3 resolved; the `/admin/login` row), security-design-principles §staff pass, the security project
document rows that cite `STAFF_ACCESS_SECRET`, the demo script, `.env.example`, TESTING.md, TODO.md.

## 5. Revision 2026-11-25 — `/admin/login` stays as a notice page

Decision 5 as first written redirected to `/login?next=/admin`. `/login` has no `next` parameter, and adding one
means an open-redirect check (ASVS V3.7.2), so the build keeps the existing redirect target instead:
`/admin/*` without an admin session still redirects to `/admin/login`, which is now a page with no form. An admin
account landing there is sent on to `/admin`; a signed-in vendor is told the account (by email) is not an admin
account; anyone else is told to sign in with their admin account, with a link to `/login`.
