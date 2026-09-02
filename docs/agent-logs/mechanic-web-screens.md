# Mechanic log — port Search / TOR Detail / Vendor Profile screens

- [x] read the mockup sections and DashboardView.tsx to learn the pattern
- [x] Search screen
  - [x] SearchView.tsx with the filter sidebar and result list
  - [x] styles added as tokenised CSS Module classes
  - [x] route at app/(app)/search/page.tsx
- [x] TOR Detail screen
  - [x] TorDetailView.tsx
  - [x] styles
  - [x] route at app/(app)/tors/[id]/page.tsx
- [x] Vendor Profile screen
  - [x] VendorProfileView.tsx
  - [x] styles
  - [x] route at app/(app)/profile/page.tsx
- [x] gates
  - [x] npm run lint at the root — clean (after removing an eslint-disable
        comment for a rule not configured in this repo, see below)
  - [x] npm run build -w @tor-radar/web — succeeds, routes /search, /profile,
        /tors/[id] all present alongside the existing / and /dashboard
- [ ] commit

### gate notes

`npm run lint` initially failed on SearchView.tsx: `react-hooks/exhaustive-deps`
is not a configured rule in this repo's eslint config, so a
`// eslint-disable-next-line react-hooks/exhaustive-deps` comment I'd added
around a `useMemo` errored as "Definition for rule ... was not found". Fixed
by dropping the `useMemo` entirely (the sample corpus is 5 rows; a plain
`.filter()` on every render is fine) instead of memoizing.

## Discoveries / decisions made along the way

- app.module.css was already 244 lines; adding three screens' worth of rules
  would have pushed it well past ~400, so a new module
  (`apps/web/src/features/app-shell/screens.module.css`) holds the new
  screens' styles, per the instructions' explicit fallback.
- Added three tokens to tokens.css that the mockup used as bare hex with no
  existing token: `--match` (#2b6e5a, match badge / avatar green),
  `--star` (#e8930c, star/favourite marker), `--panel` (#f4f7fb, secondary
  panel surface). Also added the `pop` keyframe used by the star/bookmark
  toggle animation (mirrors the mockup's own `@keyframes pop`).
- AppHeader.tsx (already committed, out of scope) has no login/logout
  affordance — it always renders the signed-in nav, "MATCH ALERTS ON", and
  avatar. So this app shell has no logged-out state to model. All three
  screens are ported as their mockup's `loggedIn: true` branch only; the
  mockup's logged-out variants (public banner on Search, hidden star/bookmark
  icons, "register to see your match" on TOR Detail, and the whole Profile
  nav item) are not reproduced, since nothing in this app can produce that
  state. Noted in the final report as an interpretation, not a redesign.
- Created `apps/web/src/data/tor-samples.ts` holding the mockup's 5-TOR
  sample dataset verbatim (id, budget, scope, quals, checks, etc.), shared by
  Search and TOR Detail so a search result's detail page shows matching data.
  DashboardView already links its flagged scatter point to
  `/tors/demo-anomaly`; that slug is wired to the mockup's anomaly TOR
  (TOR-2569-0808-017, ฿9.4M · 3.1×IQR — the same figure already in the
  dashboard's tooltip), not invented independently.
- Vendor Profile's "starred" and "bookmarked" lists mirror live star/bookmark
  clicks made on the Search screen in the mockup's single-page state machine.
  This app has Search and Profile as separate routes with no shared client
  store (nothing in the established pattern wires cross-route state), so
  those two lists are seeded with representative sample TORs instead of live
  state carried over from /search. Noted in the final report.
