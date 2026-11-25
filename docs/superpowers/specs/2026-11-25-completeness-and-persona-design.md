# Profile completeness, and the page order for the primary persona — design

**Cards:** TOR-214 (TOR-257, TOR-258) · TOR-225 (TOR-285, TOR-286, TOR-287) · **Date:** 2026-11-25 · **Status:** approved 2026-11-25
**Builds on:** [profile and matching](2026-10-06-profile-and-matching-design.md) §7.1 (registration asks three things;
everything else is optional) · PROJECT.md §4 personas
**Requirements:** FR-D-2 (profile contents), FR-C-1 (matching), FR-E-4 (TOR detail), FR-E-6, NFR-F7 (Thai UI)

## 1. Context

From the 2026-10-15 review: (a) a vendor cannot see how much of their profile matching can use, and (b) the detail
page and dashboard were not ordered for any one reader. The team asked for both to be built without a further
meeting, so the decisions below are made here and recorded.

## 2. TOR-214 — completeness

The profile spec §7.1 holds that optional information is "listed rather than nagged": certifications, past work and
personnel are never required to receive alerts. A LinkedIn-style bar that reads "60% — incomplete" would contradict
that. So the bar measures something narrower and true.

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | What does the percentage measure? | **How much of what matching reads the vendor has told it**, titled "ข้อมูลที่ระบบใช้จับคู่ได้". Not "profile completeness" |
| 2 | Which items? | Six, each one the scorer reads: หมวดหมู่งาน (at least one category), พื้นที่ให้บริการ (any answer, "ทั่วประเทศ" included), ช่วงงบประมาณ (always answered: no budget is a complete answer, profile-summary `describeBudget`), ผลงานที่ผ่านมา (at least one), ใบอนุญาต/การขึ้นทะเบียน (stated, even as "none"), บุคลากร (at least one) |
| 3 | Weighting | Equal; the figure is answered ÷ 6, rounded down. No item is worth more than another to a reader |
| 4 | What does a missing item say? | What it does for matching, never that something is wrong ("เพิ่มผลงานที่ผ่านมา — ช่วยให้ TOR ที่คล้ายงานเดิมขึ้นก่อน"), with a link to its section. No warning colour |
| 5 | At 100% | The bar says so in one line and lists nothing |
| 6 | Where | The profile page, above "ข้อมูลที่ใช้จับคู่ TOR". Not during first-time setup (there is exactly one thing to do there) |
| 7 | Computed where | In the web, from the profile the page already reads (`features/profile/profile-completeness.ts`); no API change |

## 3. TOR-225 — primary persona

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | Who is the primary user? | **The person deciding whether to bid** — the owner or manager of a small vendor, and for a freelancer (PROJECT.md P1 "Nok") the same person who later prepares the documents. Matching and email alerts exist to serve that go/no-go decision; preparing documents only follows a yes |
| 2 | Detail page order | Decision facts first: deadline and days left, then budget, category, budget year, reference number. Then the scope summary, the bidder qualifications, and the bidding method (BiddingPanel). Then the context: agency, stage history, award. Document preparation last: readiness, draft, and the specification-quality checklist |
| 3 | Dashboard order | Matched TORs first (unchanged), then the headline figures and state filter, then **winners by category** — who has been winning in each category is a bid/no-bid input — then the agency, trend and budget charts — *superseded by §4: winners by category now sits after the charts* |
| 4 | Unchanged | Every field, label and value; the coverage note and last-updated time (FR-E-6); the stale banner |
| 5 | The secondary persona | Bid staff still find every panel; nothing is removed, only moved |

## 4. Revision 2026-11-25 — winners by category moves below the charts

Row 3 of §3 put winners by category between the state filter and the charts. On the page it read out of place:
it answers for the whole collected corpus and ignores the filter, yet sat between the filter and the figures the
filter drives. It now sits after the agency, trend and budget charts. Nothing else in the order changes; with an
empty filter result it still shows below the empty-state message.
