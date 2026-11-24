# Winner announcements — design

**Card:** TOR-221 · **Date:** 2026-11-24
**Builds on:** [national e-GP source](2026-10-04-national-egp-source-design.md) · [project stages](2026-11-23-project-stages-design.md) · [source health](2026-11-24-source-health-design.md)
**Requirements:** FR-B-2 (winner and winning price, from the winner announcement, linked and marked with its document), FR-A-2, FR-B-5, NFR-F5, NFR-F6, NFR-F7, NFR-S2, NFR-S3, NFR-S7

## 1. Context

TOR-205 reads every e-GP project's stage table, so we know which projects announced a winner (`W0`, or its
amendment `W2`) but not who won. The agency's winner announcement says so. This slice collects it, reads it,
and shows the result on the project's TOR.

## 2. Where the document comes from

| Step | Request | Captcha |
| :--- | :--- | :--- |
| The announcement's template | `GET {NATIONAL_EGP_SERVICE_BASE}/egp-approval-service/apv-common/infoApproveTemplate?projectId=…&templateType=W13` → `data.templateId` (a UUID) | No |
| The announcement itself | `GET {NATIONAL_EGP_SERVICE_BASE}/egp-template-service/dwnt/view-pdf-file?templateId=…` → a PDF with a text layer | No |

These are the public requests e-GP's own project page makes. Both go through `safe-fetch` (SSRF defence, size
and time caps). e-GP's search page is behind Cloudflare Turnstile, and the bidders' price report
(`genReportPrice`) behind a captcha: neither is automated.

## 3. Decisions

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | What is read? | The winner's name, the winning price (baht, VAT included; several lots summed), and the announcement date. **Not** the bidders: their list is behind a captcha (§2). FR-B-2's bidders stay open |
| 2 | Where is it stored? | The PDF is its own record, `documentType: "award"`, a supporting document like the invitation (immutable original, intake dedupe, its own extraction job). Its reading is `award` on that record and is copied to every TOR of the project |
| 3 | Is an award record public? | Not as a record: `SUPPORTING_DOCUMENT_TYPES` (`invitation`, `award`) is excluded wherever records are listed, counted, matched, staged or put into statistics. Its original is served through the TOR that links it, as the invitation's is |
| 4 | How is it read? | One Gemini call (`Ai.extractAward`) with its own schema of three fields. The prompt forbids officials' and signatories' names; the schema has no place for them |
| 5 | Confidence | The weaker of the winner's and the price's confidence, against the same `T_low` / `T_high` as a TOR. Below `T_high` the award is `unverified` and marked "ยังไม่ยืนยัน" (not yet confirmed) on the page. A price outside `BUDGET_MIN_THB`–`BUDGET_MAX_THB` is not kept: its value is null, its raw text kept |
| 6 | A natural person who won (FR-B-5, NFR-S2) | `winnerKindOf` classes the name: a company, partnership, cooperative, joint venture, foundation, association or shop is `juristic`; a person's title, or a name the rule cannot place, is `individual`. The public serializer (`redactAward`, in `lib/redact.ts` beside `redactTor`) replaces an individual's name and raw text with "บุคคลธรรมดา". When in doubt the name stays out |
| 7 | Stage link | The project's `W0` / `W2` stages carry `recordId` = the award record, set when the award is linked and again whenever stages are re-read (`awardOf`), so the timeline opens the announcement |
| 8 | Who collects? | A hand-run tool, `tools/collect_egp_awards.mts`, recorded as manual source `national-egp-awards` on `/admin/sources`. The stages worker holds no storage or queue, and every reading is a billed model call |
| 9 | Wording (NFR-F5, NFR-F7) | "ผลการประกวดราคา — สกัดโดย AI" (bid result, AI-extracted). The winner as the announcement wrote it; the price with the document's own text beside it. Nothing judges the price or the winner |

## 4. Data

`tors.award` on an award record and on each TOR of its project:

```json
{
  "recordId": "6b04a0cdf2028dbc7afbd83b",
  "winner": { "raw": "ห้างหุ้นส่วนจำกัด เส็งพาณิชย์เหล็กไทย", "value": "ห้างหุ้นส่วนจำกัด เส็งพาณิชย์เหล็กไทย", "confidence": 1 },
  "winnerKind": "juristic",
  "price": { "raw": "๔,๒๓๙,๙๙๔.๒๑ บาท", "value": 4239994.21, "confidence": 1 },
  "announcedOn": "2026-11-23",
  "unverified": false,
  "provenance": { "ocrModel": "gemini-3.5-flash", "extractModel": "gemini-3.5-flash", "modelVersion": "gemini-3.5-flash", "extractedAt": "…", "thresholdsVersion": "…" }
}
```

## 5. Flow

1. `collect_egp_awards.mts` finds national-e-GP TORs whose `stageHistory` has `W0`/`W2` and whose project has
   no award record; for each, it fetches the template id and the PDF and submits it through `IntakeService`
   (`route: "url"`, the PDF's permanent URL as `sourceUrl`, `documentType: "award"`, the project, and the `W0`
   day as `announcedAt`).
2. The extraction worker sees `documentType: "award"` and runs `runAward`: read, grade, `writeAward`, then
   `linkAward` (the project's TORs get `award`; their `W0`/`W2` stages get `recordId`). It logs
   `award_extracted` with the call's billed units (`usageInput`, `usageOutput`).
3. `GET /tors/{id}` returns `award` through `redactAward`; the web's `AwardPanel` shows it, and the award is an
   original the viewer opens (`?doc=award`).

## 6. Configuration

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `NATIONAL_EGP_AWARD_TEMPLATE_PATH` | `/egp-approval-service/apv-common/infoApproveTemplate` | Names a project's announcement template |
| `NATIONAL_EGP_AWARD_TEMPLATE_TYPE` | `W13` | e-GP's template type for the winner announcement |
| `NATIONAL_EGP_AWARD_PDF_PATH` | `/egp-template-service/dwnt/view-pdf-file` | Returns the announcement as a PDF |
| `NATIONAL_EGP_MAX_AWARD_BYTES` | 10485760 | Largest announcement accepted |

## 7. Verification

- Unit and database tests: `winner-kind.test.ts`, `redact.test.ts`, `vertex.ai.test.ts` (`parseAward`),
  `extraction.award.test.ts`, `extraction.award.db.test.ts`, `stages.service.test.ts`, `client.test.ts`,
  `source-health.db.test.ts`, `AwardPanel.test.tsx`.
- Live (2026-11-24): five announcements on Atlas, all read at high confidence, each price just under its
  TOR's budget; about 1,400 input and 240 output units a document. The TOR page shows the block, the `W0` stage
  opens the PDF, and the document route serves it with `nosniff` and `no-store`.
- Full run on Atlas (2026-11-24): 254 of 254 awarded projects collected, none refused by e-GP; 254 published,
  253 at high confidence and 1 medium; 250 winners juristic, 4 classed individual and not named; every TOR of
  those projects carries its award; no price above its TOR's budget (median 0.958 of it, lowest 0.309).
  In total about 395,000 input and 62,000 output units. Two replies were first cut mid-JSON at a 2,048 output
  cap; at 8,192, the cap a TOR reading has, both read.
- The four classed individual include a university and a school: the rule keeps an unplaceable name out, and
  widening it is a later change, never a guess at publication time.

## 8. Revision 2026-11-24 — public bodies and the bidders

- `winnerKindOf` also names a public body or school by how its name begins (มหาวิทยาลัย, โรงเรียน, วิทยาลัย,
  สถาบัน, กระทรวง, สำนักงาน, เทศบาล, องค์การ, องค์กร, โรงพยาบาล, การไฟฟ้า, การประปา, and their English forms). Only at
  the start, so a surname cannot match. "ศูนย์…" stays out: a copy shop can be one person's business.
- `tools/recompute_winner_kind.mts` re-classes every stored award with the current rule and copies a changed one
  onto its TORs; no model call. Dry run by default, `--apply` to write. On Atlas it changed 2 of 254 (a
  university and a school), both now named; the other 2 stay unnamed.
- The bidders are recorded in the SRS as open issue O5 (FR-B-2 extended to say why), not as work in progress.
