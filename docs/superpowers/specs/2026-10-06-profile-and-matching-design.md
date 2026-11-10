# The vendor profile, and how a TOR is matched to it — design

_Sprint 4. Shapes Jira TOR-28/29 (profile), TOR-37/38 (match engine and its score breakdown) and
TOR-33 (the notification that states the reason). Realises **FR-C-1**, **FR-C-2**, **FR-C-3**,
**FR-D-2**._

## 1. The requirement that decides the architecture

**FR-C-2: the email states the reason for the match.** `NFR-F6`: every AI-produced value carries its
confidence, its model, and a link to its source; no unexplained score is shown.

A similarity score is not a reason. "ตรงกับงานนี้ 83%" tells a contractor nothing, cannot be argued
with, and cannot be corrected when it is wrong. So:

> **Rules decide and explain. Similarity may only widen the candidate set, never justify a match.**

Everything below follows from that sentence.

## 2. What a profile holds

Five categories. Three already exist in some form; two are missing, and one of the missing ones
matters more than the feature that prompted this design.

| Category | Status | Role in matching |
| :--- | :--- | :--- |
| **Skills** — taxonomy tags | Taxonomy exists (`taxonomy.seed.json`, ~25 tags with Thai labels and alias lists); extraction already maps a TOR's qualifications onto it | The backbone of the score |
| **Budget range** | Exists on the profile screen; now a preference with its own bounds, not the corpus's | **Hard filter** |
| **Service area** — provinces or regions | **Missing** | **Hard filter** |
| **Certifications and class** — ชั้นผู้รับจ้าง, วิศวกร/สถาปนิก licences, มอก., ISO, SME registration | Tags exist in the taxonomy; the profile does not record which the vendor holds | **Hard filter**, and a stated reason |
| **Past projects** — name, scope, budget, role, year, agency | **Missing**. The starred list stood in for it and was removed on 2026-10-06 | Scoring signal, and the evidence line in the email |

### 2.1 Why service area is the one to add first

Scope went national on 2026-09-02. Without a service area the system will email a Bangkok cleaning
contractor a contract in Chiang Mai — work they cannot take. A match a vendor cannot act on is worse
than no match: it teaches them to ignore the email, and the email is the product.

### 2.2 Why certifications are a filter and not a score

> **Superseded by §8.2 (revision 3).** The corpus showed certification wording is rarely a clean
> "must hold X"; they are scored with a stated reason instead. The ว642 registration is the one
> requirement treated close to a gate, as a score penalty (§8.3).

Many TORs *require* a class or a licence. A vendor without it cannot bid at all, however well the
rest fits. Scoring it would rank an impossible match above a possible one.

### 2.3 Why past projects earn their place

They do three jobs at once, which is why they are worth the form they cost:

1. They restore "I have done work like this", which the star carried and which `FR-D-2` requires.
2. They let the system **derive** skills and a realistic budget range, instead of asking a vendor to
   self-assess — people tick every tag when asked, and nobody overstates a project they actually did.
3. They give the email something concrete: *คล้ายกับงาน "ปรับปรุงถนนซอย 12" ที่คุณเคยทำ (฿2.4M, 2567)*.

### 2.4 Where a vendor's tags come from

Both, and the difference is visible:

- **Chosen** — the vendor ticks them. Honest about intent, weak evidence.
- **Derived** — mapped from a past project's scope by the same `mapQualifications` the TOR side uses.
  Stronger evidence, and it costs the vendor nothing.

A derived tag is marked as derived and names the project it came from, so a vendor can see why the
system thinks they do roadworks, and remove it if it is wrong.

## 3. How a TOR is matched

### 3.1 Stage one — can this vendor bid at all?

Filters, not scores. Each one, failing, ends the evaluation:

| Filter | Fails when |
| :--- | :--- |
| State | The TOR is not open (closed, awarded, cancelled, or its invitation is not out) |
| Budget | The TOR's budget sits outside the vendor's stated range |
| Area | The TOR's agency is outside every province the vendor serves |
| Certification | The TOR requires a tag in the certification group that the vendor does not hold |
| Eligibility | The budget or category field is not verified — `FR-C-1`: unverified fields feed neither matching nor the anomaly rule |

### 3.2 Stage two — score, and every point carries a sentence

| Signal | Weight | The sentence it produces |
| :--- | :--- | :--- |
| Tag overlap | highest | "ตรงกับทักษะ: งานก่อสร้างทาง, วิศวกรโยธา" |
| Tag rarity | multiplier | A tag held by few vendors and asked by few TORs says more than one everybody has |
| Budget fit | medium | "งบ ฿2.4M อยู่ในช่วงที่คุณรับ (฿1M–฿5M)" |
| Past-project similarity | medium | "คล้ายกับงานที่คุณเคยทำ: …" |
| Days remaining | low | "เหลือเวลายื่น 18 วัน" |

The score is the sum; the threshold is configured (`FR-C-1`). **The email is built from the
sentences, not from the number** — if a signal produced no sentence, it may not contribute a point.

### 3.3 Stage three — similarity, later, and only for recall

A TOR whose qualification text contains none of the taxonomy's aliases maps to no tags, so stage two
can never reach it. That is the gap embeddings close, and the only one they should.

Deferred deliberately until stage two has been measured:

- Thai needs a multilingual model, and the corpus is small enough that a bad model is hard to notice.
- It needs per-TOR and per-vendor vectors, and a vector index.
- There is no baseline yet to beat, and "we added embeddings and matching felt better" is the kind of
  claim this project has already decided not to make — the confidence benchmark settled the anomaly
  question with measurement, and this should be settled the same way.

When it arrives: similarity **surfaces a candidate**, then a rule must still fire to explain it. A
candidate no rule can explain is not emailed.

## 4. Data model

| Collection | Key | Fields |
| :--- | :--- | :--- |
| `vendor_profiles` | unique `accountId` | `displayName`, `tags: [{ id, source: "chosen" \| "derived", fromProjectId? }]`, `budget: { min, max }`, `areas: [provinceCode]`, `certifications: [tagId]`, `notify: { email, frequency }`, `updatedAt` |
| `vendor_projects` | `_id`, indexed `accountId` | `name`, `scope`, `budget`, `role`, `year`, `agency?`, `derivedTags: [tagId]`, `createdAt` |
| `matches` | unique `{ accountId, torId }` | `score`, `reasons: [{ code, text, weight }]`, `scoredAt`, `thresholdVersion`, `notifiedAt?` |

`accountId` on every one of them, because the accounts spec §3.1 makes that the definition of
vendor-owned: a collection without it cannot be exported or deleted, and `FR-D-3` requires both.

`reasons` is stored, not recomputed at send time. A vendor who asks "why did I get this?" three
months later must get the answer the system actually used, not the answer today's weights would give.

**Which pairs are stored** stays PLAN.md's open Q3 — every scored pair grows as vendors × TORs. This
design stores only pairs at or above the threshold, and records the threshold version alongside, so
"why was I not matched?" is answerable by rescoring that TOR against that profile rather than by
keeping a hundred million rows nobody reads.

## 5. Testing

| Level | What |
| :--- | :--- |
| Unit | Each filter in §3.1 refuses for its own reason; a vendor missing a required certification is never matched however well the tags fit |
| Unit | Scoring: tag overlap, rarity weighting, budget centrality, days remaining; every point has a sentence, and a signal with no sentence contributes nothing |
| Unit | Tag derivation from a project scope uses the same mapping as the TOR side, and marks the tag derived with its project |
| Integration | A profile change rescoring only what it should; a TOR whose budget is unverified matching nobody |
| Live | A seeded vendor and a seeded TOR produce a match whose stored reasons read as Thai sentences a contractor would recognise |

## 6. Open

| Question | Needs |
| :--- | :--- |
| Province list — the canonical source, and whether an agency's province can be derived from its name (`tools/bma-agencies.json` covers Bangkok only) | A decision before the area filter is built |
| Does a vendor pick provinces, regions, or "anywhere"? | The profile form, with a vendor to ask |
| Tag rarity needs a corpus large enough to measure rarity against | The corpus collection that is blocked on Vertex credentials |
| Embeddings (§3.3) | A measured baseline from stage two first |

---

## 7. Revision 2 — 2026-10-07

Revision 1 described what a profile holds. It did not say what a vendor is asked
for *at registration*, and it treated the extracted category as something that
could be matched against directly. Both are settled here, after a cross-model
review that overturned one of the proposals outright.

### 7.1 Registration asks for three things, and all three are taps

`หมวดหมู่งาน` (from the taxonomy), `พื้นที่ให้บริการ`, `ช่วงงบประมาณ`. Nothing
else, and no free text.

Each additional field costs one to two percent of completions, and going from
eight fields to four roughly doubles them (Baymard). A profile nobody finishes
matches nothing, so the registration form is held to what matching cannot work
without.

Certifications and past projects stay out of registration and are prompted from
the dashboard — but deferral is a policy, not an omission. A credential is asked
for at the moment it would have changed an alert ("เพิ่มใบอนุญาตนี้
เพื่อไม่ให้ได้รับแจ้งเตือนที่ไม่ตรง"), and a past project only after the vendor
has seen the platform be useful. Neither is ever required to receive alerts.

**This contradicts `FR-D-2`, which lists certifications, past projects and
portfolio material as profile contents, and `FR-C-1`, which scores
qualifications.** The SRS is amended to say when each is collected; the
requirement that they are held and scored is unchanged.

### 7.1.1 The profile screen has two states, and they are not the same screen

Revision 2 said what is asked and when, and left a gap: it never said that the
screen changes once the answers exist. Built from §7.1 alone, the profile is a
setup form that stays a setup form — a vendor who has already answered is shown
the same sixty-five choices every time they open it, with no way to see what
they said without reading the highlighting.

**Setting up.** A profile with no work categories chosen has never been filled
in. It leads with the pickers, because there is exactly one thing to do.

**Afterwards.** A profile that has been answered leads with the answers: what
work, which areas, what budget, each stated plainly with its own way in to
change it. The pickers are still there, one section at a time, behind the
section they belong to.

This is what progressive profiling means in practice. The first visit asks the
minimum that makes matching work; every visit after it is a place to see and
correct what was said, and to be offered the next thing worth adding.

**What is offered next is listed, not nagged.** Certifications and past projects
are named as things that would sharpen matching, with the effect each has stated
honestly — and nothing is marked incomplete for their absence, because §7.1 says
neither is ever required to receive alerts. The contextual prompt ("เพิ่ม
ใบอนุญาตนี้ เพื่อไม่ให้ได้รับแจ้งเตือนที่ไม่ตรง") needs matching to know the
moment, so it arrives with matching rather than being faked as a standing banner.

### 7.2 A company-size band is NOT collected

Proposed on the strength of TenderKG's "staffing range", and rejected on review.
That finding comes from a mature dataset with behavioural labels; here it would
be a self-reported band with nothing to validate it against, and company size is
a poor proxy for whether a firm will bid — a large firm may want small work, and
firms bid jointly. It is not collected until there is a demonstrated use for it.

### 7.3 Budget and area are preferences, not gates

Stage one filters only on what is *factually* disqualifying: the deadline has
passed, the record is taken down, or a stated mandatory qualification is one the
vendor has explicitly said they do not hold. Budget band and service area move
to stage two as scored signals.

Hard-filtering on them produces silent false negatives — a vendor who would have
bid never learns the TOR existed — and on a corpus this size a conjunction of
verified category, verified budget, area and deadline can return nothing at all.

### 7.4 Service area is where the work is, never where the agency is

An agency's address is not the location of the work it is procuring. Matching on
the issuing agency's province would be quietly wrong in a way no test would
catch. Work location is derived from the document and carries its own confidence;
where it is unknown, the record is scored without the area signal rather than
excluded by it.

### 7.5 The extracted category is evidence, not a classification

`ประกวดราคาอิเล็กทรอนิกส์` appears in the live corpus as a category. It is a
procurement method — a field-type error, not a bad category. One record in six
proves a free-text category cannot be the input to a taxonomy match.

The extracted string is preserved exactly, with its confidence and source, and a
*separate* classification object is produced beside it, carrying:

| Field | Holds |
| :--- | :--- |
| `scheme` | `unspsc`, the local crosswalk, or none |
| `nodes` | candidate taxonomy nodes with scores |
| `evidence` | the spans that produced them, from title, scope and stated qualifications — never the category field alone |
| `outcome` | `classified`, `ambiguous`, `unknown`, or `invalid-field-type` |
| `mapperVersion` | so a reclassification is reproducible and historical matches can be explained |

Deterministic exclusions run first: a procurement method, an announcement type or
a document label is recognised as such and never becomes a category.

### 7.6 UNSPSC is an authority to cross-walk to, not the interface

Thai e-GP classifies by UNSPSC (Segment, Family, Class, Commodity). The records
here come from published announcements rather than e-GP's API, so a code is
usually absent. The vendor-facing taxonomy is therefore our own, shallow and
readable, with a crosswalk to UNSPSC used when a code is actually present. The
hierarchy is what matters: a vendor who picks a coarse node still matches a TOR
resolving beneath it, scoring lower the further apart they sit.

### 7.7 Feedback is collected from the first release

On save or dismiss, one optional question: relevant, not relevant, or cannot bid
because — . Published procurement discloses only awarded suppliers, so
vendor–TOR interactions are "extremely sparse and limited to positive outcomes"
(TenderKG); this is the only place the missing signal can come from, and it is
worth more than any further profile field.

### 7.8 No notification email ships before a labelled benchmark exists

A manually labelled vendor–TOR matrix, scored for precision, recall and the rate
of "unknown because a field was missing". At this corpus size human judgement is
cheap and is the only defensible evidence. Weights are not tuned by intuition.

Until then the email says a TOR **may be relevant to the requirements stated**,
never that it matches the vendor — which `NFR-F5` would require regardless.

### 7.9 Known scaling limits, recorded now

Scoring every TOR against every profile does not survive a large corpus:
candidates are retrieved from an index on tags and location, and only candidates
are scored. A broad parent tag plus a broad region will flood a vendor, so
per-vendor caps and deduplication belong in the first release, not after the
first complaint.

### 7.10 Sources

- TenderKG, arXiv 2608.14066 — company and tender features, and the sparsity finding
- Bidders Recommender for Public Procurement Auctions (Spain) — under five bidders per lot
- Thai e-GP / กรมบัญชีกลาง — UNSPSC as the national classification
- Baymard Institute — form length against completion

## 8. Revision 3 — Sprint 4 build, 2026-11-03

What was built for the profile's optional section, and where it departs from revisions 1 and 2.

### 8.1 Past projects are typed, and lift TORs like them

A vendor lists past work as title, Buddhist-era year and contract value, up to
`PROFILE_PAST_PROJECTS_MAX`. Reading a past-work certificate with AI is the next step; the upload
zone is shown as "เร็วๆ นี้" rather than as a control that does nothing.

The experience signal (`MATCH_EXPERIENCE_WEIGHT`) compares the TOR's classified taxonomy leaves
with the leaves each project title classifies to: 1 when any project shares a leaf (and the reason
names that project), 0 otherwise. It joins the weighted mean **only when at least one project
classifies** — an empty list costs nothing, so a vendor who skips the section is not ranked below
their own score without it.

### 8.2 Certifications are a score with a reason, never a hidden TOR

Read-only count over the live corpus (223 TORs with extracted qualifications, 2026-10-08):
ISO 9001 in 23, ISO 14001 in 11, มอก. in 12, SME in 2, the engineer and architect licences in one
each. Two findings overturn §2.2:

1. The wording is often "ISO 9001 **และ/หรือ** ISO 14001" — either one satisfies it.
2. มอก. usually qualifies the *product* to be supplied, not the bidder.

A filter built on regex detection of such text would silently hide TORs a vendor could bid on —
the false negative §7.3 exists to prevent. So the qualification signal
(`MATCH_QUALIFICATION_WEIGHT`) joins the score only when the TOR names a listed certification
(or the vendor's own อื่นๆ words) **and** the vendor has saved the section:

| Situation | Effect | Reason shown |
| :--- | :--- | :--- |
| Vendor holds every certification named | signal 1 | คุณมี ISO 9001 ที่ TOR นี้ระบุ |
| Text says หรือ, vendor holds any one | signal 1 | as above |
| Vendor holds some of several | held ÷ named | TOR นี้ระบุ ISO 14001 ซึ่งคุณยังไม่ได้ระบุ |
| TOR names none, or section never saved | signal absent | — |

"Not stated" (`certifications` absent) and "holds nothing" (saved, empty) are different states;
only the second may lower a score. Detection patterns live in `matching/certifications.ts`, with
the corpus counts that justified each.

### 8.3 The กรมบัญชีกลาง registration (ว642)

A construction TOR at or above `CGD_REGISTRATION_MIN_BUDGET_THB` (default ฿5M) requires a
registration in its branch. The branch is inferred from the classification and title
(`cgdBranchOf`, nine branches seeded in `packages/seeds/src/registrations.ts`). A vendor who has
saved the section without that branch has the TOR's score multiplied by
`MATCH_REGISTRATION_MISSING_FACTOR` (default 0.5), and the reason leads the list. It is still a
score, not a gate, because branch inference from a title can be wrong.

The registration class (ชั้น 1–5) is **not asked**: matching does not use it, and a question that
changes nothing is friction. The stored shape keeps an optional `grade` so it can be added without
a migration.

### 8.4 The §7.8 benchmark exists

`match_labels` holds one staff judgement per vendor–TOR pair (`relevant`, `not-relevant`,
`unsure`) with the score and the matched/not-matched decision frozen at labelling time. The
worksheet shows the vendor's top `LABEL_MATCHED_SHOWN` matches and a sample of
`LABEL_UNMATCHED_SHOWN` it would not send, so recall can be measured and not only precision.
`GET /admin/match-quality` reports precision, recall and the unsure rate.

Match emails stay off (`NOTIFY_DISPATCH_ENABLED=false`) until those figures are read against real
labels. A staff "send now" (`POST /admin/accounts/:id/match-email`, at most
`NOTIFY_MANUAL_MAX_TORS` TORs) exists for a demo and for a vendor who asks; it refuses a vendor
whose preset is off and writes an audit entry.

### 8.5 Score assembly, as built

```
score = weighted mean of the signals present
        (category, budget, and — when they apply — experience, qualification)
      × registration factor (1, or MATCH_REGISTRATION_MISSING_FACTOR)
```

Every weight is a `core/config.ts` key; none is tuned until §8.4's figures exist. The displayed
percentage and the search filter both use `matchPercent` from `@tor-radar/shared`, so a badge and
a filter can never disagree by a rounding step.

---

## 9. Revision 4 — personnel, 2026-11-09 (TOR-212, TOR-213)

TORs mostly ask for people ("a controlled engineer on the team"), not for the company's ISO, so the profile
also records who the company can field.

- **`personnel`** on the vendor profile: `[{ id, role, certifications, other }]`. `certifications` are only the
  licences a person holds — `PERSONAL_CERTIFICATION_IDS` in `packages/seeds` (engineer, architect); the API
  refuses ISO, มอก. and SME, which are the company's. **No name is stored** — matching needs the role and the
  certificates, and a name would be personal data about a third party for no gain. Capped by
  `PROFILE_PERSONNEL_MAX`. Saved with the extras (§8.1), so the main form cannot overwrite it. In the extras
  request `personnel` and `certifications` are each optional, and a section left out keeps what is stored — so
  editing only the staff cannot turn the company's certificates from *not stated* into *holds nothing*, which
  would start lowering scores. The profile screen sends the company's certificates only once the vendor has
  stated them there or already had.
- **PDPA.** It lives inside the profile document, so the data export and account deletion cover it without a
  second code path (`UT-F5-5`).
- **The qualification signal (§8.2) counts it.** A licence to practise the TOR names counts as held when the company
  lists it or any member of staff holds it, and one only the staff hold is named so ("… (บุคลากร)"). A
  company certificate (ISO, มอก., SME) is satisfied by the company's own entry alone: an employee holding one
  does not make the company certified, even if older data lists one against a person.
  Stating personnel alone counts as stating something, but never lowers the score for a company certificate the
  vendor said nothing about: a missing mark needs a stated answer, as before.
- **Not yet:** the TOR side still reads the qualification text only. Reading the structured
  `requiredDocuments` (extraction design §13, `holder: personnel`) is the next step once those fields are on.

## 10. Revision 5 — personalised score, 2026-11-09 (TOR-215, TOR-216)

A recommendation can lean on what the vendor does, on top of the profile they state. Behind
`MATCH_BEHAVIOUR_ENABLED` (default **off**).

- **Separate consent.** `behaviourConsent` on the account, given at sign-up (optional box) or on the account
  page, withdrawn on its own. It is not the registration consent and is never a condition of registering.
  The sign-up form shows the box only while `MATCH_BEHAVIOUR_ENABLED` is on (the web build reads it as
  `NEXT_PUBLIC_BEHAVIOUR_ENABLED`, set from the same variable) and sends `behaviourConsent` only when it is ticked.
  Nothing is recorded or read without it, nor when the account's own consent is withdrawn.
- **Events.** `view`, `save`, `dismiss`, `prepare`, in `behaviour_events` — **one document per (account, TOR, kind)**:
  doing the same thing again refreshes its time, so repeats cannot crowd other events out of what scoring reads
  or pile up points. `save` is
  recorded by the server when a TOR is bookmarked; `view` by a small client beacon on the TOR page, rendered
  only when consent is on; `dismiss` and `prepare` have a route but no screen yet.
- **Data minimisation.** With the switch off, **nothing is recorded**, even for a vendor who consented: data
  nobody uses is not kept. Withdrawing consent deletes the recorded events; export includes them; account
  deletion removes them. Withdrawal flags the account first and deletes second, and a write re-reads consent after
  it lands and removes its own event if consent has gone, so no interleaving leaves a withdrawn vendor's event
  behind. If that re-read itself fails, the event is removed anyway (nothing kept on a doubt) and the error
  surfaces. Should that cleanup fail too, the row is an orphan: nothing reads it (every read checks consent), the
  worker's reconcile sweep (`purgeUnconsented`) deletes it, and consent given afresh starts with no history, so it
  cannot come back. Giving consent again while it is live keeps what was recorded. Withdrawing what was never
  given is a no-op. MongoDB has no transaction here (the local database is a single node), so this is
  ordering plus a sweep, not atomicity.
- **The adjustment.** Each (TOR, kind of event) counts once (it is stored once), weighted by `BEHAVIOUR_WEIGHT_*` (a dismissal is
  negative), summed per taxonomy leaf of the TOR it was done to, over `BEHAVIOUR_WINDOW_DAYS`. A candidate's
  points are the sum over its own leaves; it moves the score by `points × BEHAVIOUR_POINT_VALUE`, clamped to
  ±`BEHAVIOUR_MAX_ADJUST`, applied last. It never rescues a TOR whose base score is zero.
- **Reasons (NFR-F6).** "ปรับคะแนนขึ้น/ลง เพราะคุณเคยสนใจ/ปิดงานประเภทนี้ (จากการใช้งานของคุณเอง)".
- **Where it applies.** The vendor's own feed, the score badge and the match filter in search, so a badge and a
  filter cannot disagree. Emails and the match-quality benchmark keep the base score: a benchmark of the
  stated profile must not move with behaviour, and an email must not rest on activity the vendor cannot see.
- **Not tuned.** The weights, the point value and the cap are placeholders until the §8.4 benchmark can measure
  their effect.

---

## 11. Revision 6 — document vault, 2026-11-10 (TOR-218)

A vendor keeps their own files once and reuses them for every TOR: a CV, certificates, past work.

- **What is kept.** `vault_documents`: `kind` (`cv`, `certificate`, `past_work`), `certificationId` for a
  certificate (the vendor's own statement, from the certification list — nothing reads it off the file), the
  filename as given (directory part dropped, 200 characters), the type, size and `sha256`, and the storage `key`.
  The file's bytes are in a **bucket of their own** (`GCS_VAULT_BUCKET`), under `vault/<accountId>/<uuid>`: no
  filename goes to object metadata. Two uploads of the same bytes are two files.
- **Not the originals.** The originals bucket is immutable and its identity cannot delete (`FR-A-2`, `NFR-S3`).
  A vendor must be able to delete their file and an account deletion must remove them all, so the vault is a
  separate bucket and a separate port (`VaultStorage`, which adds `delete`); the identity that can delete reaches
  only that bucket. The bucket is created like the originals bucket — the emulator does not create it.
- **Intake rules, applied.** The bytes decide the type (PDF, JPG, PNG), whatever the sender called the file;
  `VAULT_MAX_FILE_BYTES` caps one file and `VAULT_MAX_FILES` the count (the count check runs before the upload
  is read; concurrent uploads can overshoot it by one, because it bounds storage and is not a quota); served as an
  attachment with `nosniff` and `no-store`, never inline.
- **Private.** Every read, download and delete is scoped to the signed-in account; another account's file
  answers `404`, as a missing one does.
- **PDPA (`FR-D-3`).** The export lists what is kept (not the files, not the key). Deleting the account deletes
  the files first and the records after: if storage is down the account stays and the vendor can try again;
  records deleted first would leave files nothing points to. A delete of one file works the same way.
- **Not yet.** Matching a TOR's `requiredDocuments` to what is kept is the readiness checklist (TOR-219); drafting
  from the vault is TOR-220. Neither reads the files. A file that is not a PDF or an image is refused; there is no
  virus scan.
