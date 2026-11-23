# Project-stage notifications — design

**Cards:** TOR-207 (story), TOR-238 (stage note in the match email), TOR-239 (stage-change email), TOR-240 (tests) · **Date:** 2026-11-24
**Builds on:** [project stages](2026-11-23-project-stages-design.md) · [outbound email](2026-10-07-outbound-email-design.md)
**Requirements:** FR-C-3, FR-E-5, NFR-F5, NFR-F7, NFR-S2, NFR-S7

TOR-205 reads every e-GP project's stage table and writes one `tor_events` entry (`kind: "stage"`) each
time a record's current stage changes. This slice turns those entries into email, and tells a vendor in the
match email how far the project has gone.

## 1. Decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | Which stages are emailed? | **Invitation, awarded and cancelled only**: the three a vendor acts on (bid now, stop preparing, stop waiting). A move to median price or `other` is not emailed; neither is a move between two codes of the same kind (`W0` → `I0`, both awarded) |
| 2 | To whom? | A vendor who **follows** the TOR: either sent it as a match email (`reason: "match"`, `sentAt` set; in dry-run mode, the dry-run claim) or bookmarked it. The earlier of the two is when they started following; a move before that is not theirs to hear about |
| 3 | Which moves? | A `stage` event with a non-null `from`: the first read of a project (`from: null`) is not a move, so the 991 first reads TOR-205 wrote on Atlas send nothing. A move older than `STAGE_NOTIFY_LOOKBACK_DAYS` (default 14) is never emailed, so the first dispatch after the worker was off, or after a vendor starts following, sends no backlog |
| 4 | Preferences | No new toggle. The existing email preset applies: `off` sends nothing, as for every other email. `daily` does not fold stage emails into the digest: a stage move is one email, like a deadline reminder, because it asks for action now |
| 5 | Once only | Claimed through the same unique index as every notification (`accountId + torId + reason + dryRun`), with `reason: "stage-change"` and the synthetic key `stage:<torId>:<event id>` — the `digest:<period>` pattern. A second dispatch, or a second worker, finds the claim taken |
| 6 | Which records? | Published, unrestricted, not a duplicate — the same rule as every public view. A taken-down TOR is never emailed about |
| 7 | Switch | `NOTIFY_DISPATCH_ENABLED=false` (the default) claims as a dry run and sends nothing, as for match emails |
| 8 | Wording (NFR-F5, NFR-F7) | Headlines are statements of the stage only: "ประกาศเชิญชวนแล้ว", "ประกาศผู้ชนะแล้ว", "ยกเลิกประกาศเชิญชวน". The stage's name is the source's own description where it gave one. Nothing judges the TOR, the agency or the outcome |
| 9 | Personal data (NFR-S2) | The email holds the TOR's public fields and the vendor's display name only — what the match email already holds. Recipient address and body are never logged |

## 2. Stage note in the match email (TOR-238)

A matched TOR whose current stage is before the invitation carries a note above its title, so a vendor knows
whether the window to bid is open:

| Current stage kind | Note |
| :--- | :--- |
| `draft` | ขั้นร่าง TOR · ยังไม่เปิดยื่นข้อเสนอ — มีเวลาเตรียมตัว |
| `median-price` | ประกาศราคากลางแล้ว · รอประกาศเชิญชวน |
| `invitation` | ประกาศเชิญชวนแล้ว · เปิดยื่นข้อเสนอ |
| anything else, or no stage | no note |

Awarded and cancelled TORs are not open (`torStateOf`, TOR-205), so they are never matched and need no note.

## 3. Stage-change email (TOR-239)

One email per move, subject `อัปเดตโครงการที่คุณติดตาม: <headline>`, in the match email's shell: the TOR's
reference, title and agency; why the vendor is hearing about it (sent as a match, or bookmarked); the latest
stage with its day; the bid deadline for an invitation only; a button to the TOR page, where the stage
timeline (TOR-206) shows every stage; a note that stages come from e-GP and the original announcement is what
counts; the settings and unsubscribe links. A plain-text part carries the same lines.

## 4. Dispatch

`NotifyService.dispatchVendor` runs the match dispatch, then — unless the preset is `off` — the stage
dispatch, and sums the two:

1. `followedTors(accountId, dryRun)` — the TORs the vendor follows and since when.
2. `stageMoves(torIds, since)` — their stage events with a non-null `from` inside the lookback, oldest first.
3. For each move after the vendor started following: skip unless the record is public, the new stage's kind
   has a headline, and the stage before it in `stageHistory` was of another kind.
4. Claim `stage:<torId>:<event id>`; in dry-run mode stop there; otherwise render, send, and mark it sent.

## 5. Configuration

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `STAGE_NOTIFY_LOOKBACK_DAYS` | 14 | A stage move older than this is never emailed |

## 6. Verification

- Unit and database tests: `notify.service.test.ts` (`project stages (TOR-207)`), `match-email.template.test.ts`.
- Live (2026-11-24): a real draft-stage TOR copied from Atlas into a throwaway local database, a vendor
  matching it, dispatch to Mailpit — the match email carried the draft note; a simulated `B0` → `D0` move then
  sent one stage email with the deadline; a third dispatch sent nothing.
- Atlas, read only (2026-11-24): 991 stage events, all first reads; 0 moves in the lookback; the 2 eligible
  vendors follow no TOR yet — turning dispatch on today would send no stage email.
