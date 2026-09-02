# TOR Radar — working checklist

Live status across sessions. The detailed, step-by-step version lives in
[the slice-1 plan](superpowers/plans/2026-09-01-slice1-foundation-intake.md); this file is the
one-screen view.

_last updated: 2026-09-02_

## Done

- [x] SRS v2.0 imported, encoding repaired, committed as `docs/SRS.md`
- [x] Scope corrected to national across SRS, PROJECT.md, CLAUDE.md
- [x] Slice-1 design spec: structure, data model, seams, security, containers, storage discipline
- [x] Codex cross-check run; four defects found and folded in
- [x] PROJECT.md, CLAUDE.md, AGENTS.md realigned to SRS v2.0 identifiers
- [x] Implementation plan written: 16 tasks, TDD steps, live verification

## Slice 1 — foundation and intake

- [ ] Task 1 — workspace plumbing and `packages/shared`
- [ ] Task 2 — `core/config.ts`, every threshold validated
- [ ] Task 3 — content hashing
- [ ] Task 4 — magic-byte verification
- [ ] Task 5 — SSRF-resistant fetch and typed errors
- [ ] Task 6 — storage port and MinIO adapter
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

## Open questions carried from the SRS

- [ ] O1 — `T_low` / `T_high`, from the accuracy measurement (NFR-F3)
- [ ] O2 — `MIN_BID_WINDOW_DAYS`; until then checklist C2 reports "not evaluated"
- [ ] O3 — `MIN_SCOPE_CHARS`, `MIN_SCOPE_SECTIONS`
- [ ] O4 — IQR or ZSCORE as the active anomaly method

## Environment

- [x] Removed `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` from global settings; backup at
      `~/.claude/settings.json.bak-2026-09-02`
- [ ] Restart and confirm the todo panel returns
- [ ] Run one session with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 claude` to find out whether teams
      and the todo panel can coexist; if they can, restore the flag in settings permanently
- [ ] Decide whether `pixel-agents` stays — it rewrote `settings.json`, installed a hook on every
      event, and changed the model from `claude-fable-5[1m]` to `opus`
