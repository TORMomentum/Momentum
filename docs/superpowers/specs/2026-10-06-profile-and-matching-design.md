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
