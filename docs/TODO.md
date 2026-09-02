# TOR Radar — working checklist

Hierarchical by law (global CLAUDE.md § Hierarchical todo discipline): one box per deliverable,
a box is expanded into sub-boxes **when it is entered**, nesting goes as deep as the work turns out
to be, and a parent is never ticked while a child is open. Step-level detail for slice 1 lives in
[the plan](superpowers/plans/2026-09-01-slice1-foundation-intake.md).

_last updated: 2026-09-02_

---

## 1. Requirements and design — DONE

- [x] **SRS v2.0 into the repo**
  - [x] import, repair the Google Docs encoding damage, commit as `docs/SRS.md`
  - [x] map the old identifiers to the new ones for anything still citing `FR-A1` / `NFR-2`
- [x] **Scope correction to national**
  - [x] withdraw the Bangkok-only validation rule
  - [x] propagate through SRS, PROJECT.md, CLAUDE.md
- [x] **Slice-1 design spec**
  - [x] structure — package by feature, ports and adapters, FSD-lite on the web
  - [x] data model — collections, the nine-field record, indexes
  - [x] interaction seams — the intake path, ordering rules, failure paths
  - [x] security §5.6 — SSRF, magic bytes, download headers, query construction
  - [x] containers §5.7 — workspace-aware images, worker service, health gates
  - [x] storage and config discipline §5.8 — two endpoints, no persisted signed URLs, volumes
- [x] **Cross-model check (different company, before building on it)**
  - [x] run Codex against the design
  - [x] SSRF: reject on any resolved address, not just the first
  - [x] admin routes authenticated from the first commit, not by network placement
  - [x] `announcedAt` and `sourceUrl` added, with their indexes
  - [x] reconciler closes the insert-then-enqueue gap
- [x] **Agent-facing docs** — PROJECT.md, CLAUDE.md, AGENTS.md realigned to v2.0
- [x] **Implementation plan** — 16 tasks, TDD steps, live verification

## 2. Slice 1 — foundation and intake — IN PROGRESS (5/16)

_Each box below expands into its own sub-list when it is entered. The plan file holds the steps._

- [x] **Task 1 — workspace plumbing and shared types** — delegated to `mechanic`, verified, `79f45c2`
  - [x] add `packages/shared/package.json` with the build and prepare scripts
  - [x] add `packages/shared/tsconfig.json` (pulled forward from Task 14, so the manifest was not
        written twice)
  - [x] write `src/tor.ts` — `TorRecord`, `ExtractedField`, `SourceRef`, `PipelineState`
  - [x] write `src/intake.ts` — the URL request schema
  - [x] write `src/index.ts` — the barrel
  - [x] register `packages/*` in the root workspaces array
  - [x] verify `@tor-radar/shared` resolves — `npm ls` shows the symlink
  - [x] verify `prepare` produced `dist/`, and that `dist/` is gitignored
  - [x] verify the package actually imports at runtime (`node -e "import(...)"` → `urlIntakeSchema`)
  - [x] commit
- [x] **Task 2 — `core/config.ts`, every threshold validated, fails fast** — delegated to
      `implementer`, verified, `324ade9`
  - [x] zod + vitest added to the api workspace
  - [x] failing test first, confirmed failing for the right reason
  - [x] schema with 24 keys, `Config`, `loadConfig`, `OPEN_VALUES` (O1–O4 names only, no invented
        values)
  - [x] 5/5 tests pass at the root, which is what CI runs
  - [x] parent follow-ups from the agent's findings:
    - [x] `ignoreRestSiblings` at the root eslint config, so the rest-omit pattern stops breaking CI
    - [x] removed the local `eslint-disable` the agent had to add inside the test
    - [x] `z.string().url()` → `z.url()`, since zod resolved to 4.5.4 where the old form is deprecated
- [x] **Task 3 — content hashing** — delegated to `mechanic`, verified, `36aea85`
  - [x] failing test first, confirmed failing for the right reason
  - [x] `sha256(Buffer)` over `node:crypto`, three cases pass
  - [x] 8/8 tests at the root, lint and tsc clean
  - [x] parent check: the test's `abc` vector matches a real sha256 digest
- [x] **Task 4 — magic-byte verification** — delegated to `mechanic`, verified, `f4f04fc`
  - [x] failing test first, five cases pass
  - [x] 13/13 tests at the root, lint and tsc clean
  - [x] parent adversarial probe: HTML, SVG-with-script, an html-then-%PDF polyglot, truncated
        magic, zip and empty are all rejected; real PDF/PNG/JPEG accepted
  - [ ] **open question for the Sprint-1 corpus:** a PDF whose `%PDF` header is not at byte 0
        (leading whitespace or junk) is rejected. Strict is right for a security control, but real
        scans sometimes carry leading bytes — check against the 10–20 real TORs before deciding
        whether to scan a bounded prefix instead
- [x] **Task 5 — SSRF-resistant fetch and typed errors** — delegated to `implementer`, verified,
      `26d22d1`
  - [x] every resolved record checked, not just the first (the rebinding bypass the cross-check found)
  - [x] `net.BlockList` instead of string prefixes — catches `::ffff:169.254.169.254`, which the
        plan's version would have passed through. Agent's improvement, kept
  - [x] unparseable addresses fail closed
  - [x] 19 cases: loopback, metadata, private, unique-local, mapped-IPv6, private-record-not-first,
        redirect into private range, scheme change mid-redirect, chain cap, size cap, error status
  - [x] 32/32 tests at the root, lint and tsc clean
  - [x] agent hit a session rate limit before committing; parent verified and committed its work
- [ ] **Task 6 — storage port and MinIO adapter** ← next
- [ ] Task 7 — queue port and MongoDB adapter
- [ ] Task 8 — intake repository
- [ ] Task 9 — intake service
- [ ] Task 10 — three intake routes with access control
- [ ] Task 11 — extraction worker and orphan reconciler
- [ ] Task 12 — TOR read API, signed links, redaction
- [ ] Task 13 — design tokens and the admin upload screen
- [ ] Task 14 — workspace-aware Dockerfiles
- [ ] Task 15 — Compose services, health gates, CI audit
- [ ] Task 16 — live verification and documentation

## 2b. Web — mockup port (outside the slice-1 plan, done on request)

- [x] **Landing page** — ported from `mockups/TOR Radar Landing.dc.html`
  - [x] design tokens extracted; no literal colours in components
  - [x] hero, marquee, counting stats, three steps, anomaly plot, checklist, closing, footer
  - [x] three.js radar backdrop restored, always animating, paused off-screen and when hidden
  - [x] sample-data notice added: the mockup's figures are invented and FR-E-6 forbids implying coverage
- [x] **Dashboard** — `/dashboard`, app shell with the tab bar
  - [x] agency bars filter on click, price plot with tooltips, flagged point links to its detail page
  - [x] bars grow and plot points scale in, staggered; flagged point keeps pulsing
- [x] **Search** — `/search`, delegated to `mechanic`, verified, `4c184fe`
- [x] **TOR Detail** — `/tors/[id]`
- [x] **Vendor Profile** — `/profile`
- [ ] **Carried forward from the port** (decide before these screens meet real data):
  - [ ] no signed-out state exists in the app shell; every screen renders the signed-in branch. Slice 4 builds auth and must add it
  - [ ] starred and bookmarked lists on the profile are seeded samples; they need real cross-route state once accounts exist
  - [ ] `/tors/demo-anomaly` is a hard-coded slug pointing at the sample anomaly TOR; replaced by real ids when ingestion lands

## 3. Open values carried from the SRS — BLOCKED ON DATA

- [ ] O1 — `T_low` / `T_high`, from the accuracy measurement (NFR-F3)
- [ ] O2 — `MIN_BID_WINDOW_DAYS`; checklist C2 reports "not evaluated" until then
- [ ] O3 — `MIN_SCOPE_CHARS`, `MIN_SCOPE_SECTIONS`
- [ ] O4 — IQR or ZSCORE as the active anomaly method

## 4. Environment

- [x] **Tiered trio installed** — `implementer`, `mechanic`, `verifier` in `~/.claude/agents/`
- [x] **Vault skills installed** — crosscheck, backtest-validation, safe-refactoring
- [x] **Delegation and cross-check rules inlined** into the global CLAUDE.md
- [x] **`brain_doctor.py`** — verifies installed state, wired as a SessionStart hook
- [x] **Hierarchical todo law** written into the global rules, the playbook, and QUEUE.md
- [ ] Restart and confirm the todo panel returns
- [ ] Test whether agent teams and the todo panel can coexist
  - [ ] run `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude`, check for both
  - [ ] if both work, restore the flag in `settings.json` permanently
- [ ] Decide whether `pixel-agents` stays — it rewrote `settings.json`, hooked every event, and
      changed the model from `claude-fable-5[1m]` to `opus`
- [ ] Decide whether Fable goes back as the architect model
