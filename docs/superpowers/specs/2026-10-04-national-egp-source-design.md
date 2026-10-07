# National e-GP source: a second way to collect TORs

**Date:** 2026-10-04
**Adds to:** `sources/bma-egp/` (kept unchanged) · [e-GP project linking](2026-09-16-egp-project-linking-design.md)
**Corrects:** [DATA-SOURCES.md](../../DATA-SOURCES.md) "Not usable: national e-GP"
**Evidence:** endpoints called live on 2026-10-04 against e-GP projects 69099218130 and 68039469567

---

## 1. What real data showed

| Finding | Evidence |
|---|---|
| Four national e-GP endpoints answer without login, cookies or special headers | `infoProcureDocAnnounZip`, `infoDocPriceestZipHis`, `downloadFileTest`, and the RSS feed, called with plain `curl` |
| The e-GP web *site* is behind Keycloak and Turnstile; these back-end endpoints are not | DATA-SOURCES.md was right about the site and wrong about the source as a whole |
| A project's bid package is one ZIP of 9 to 22 files, 7 to 10 MB | 69099218130: `TOR(1).pdf`, `Attach_TOR_2..6.pdf`, `annoudoc_*.pdf`, `doc_*.pdf`, bonds, contract, `action_plan.xlsx` |
| `annoudoc_*.pdf` in the final bid package is the ประกาศเชิญชวน and states the submission date and time | "เสนอราคา… ในวันที่ ๒๔ กันยายน ๒๕๖๙ ระหว่างเวลา ๐๙.๐๐ น. ถึง ๑๒.๐๐ น." |
| The draft (B0) package carries a *draft* announcement under the same name | RSS B0 link for 69099218130 → 9-file package; its `annoudoc` is not the final invitation |
| The TOR file is byte-identical in the draft and final packages | Same size, so content-hash dedupe merges them |
| Most files are digital PDFs | 18 of 21 PDFs in 69099218130 have a text layer; 3 `Attach_TOR_*` files are scans |
| The RSS feed is empty at weekends | Sunday 2026-10-04: `<countbyday>0</countbyday>` |
| `process3.gprocurement.go.th` redirects to `process.gprocurement.go.th` | 302 on the feed URL |
| ZIP entries use data descriptors | General-purpose flag `0x0808`: sizes are zero in local headers and present only in the central directory |

## 2. Decisions

| # | Decision | Answer |
|---|---|---|
| 1 | Replace the BMA source? | **No.** National e-GP is added beside it. `downloadFileTest` is unofficial and may close; BMA stays as the fallback |
| 2 | How a project is found | The RSS feed (`D0` invitations by default, `B0` drafts optionally), or a list of e-GP project numbers given to the importer |
| 3 | Which package | The final bid package from `infoProcureDocAnnounZip`. If none exists yet, the package linked from a B0 RSS item |
| 4 | The ZIP as an original | **Stored whole**, by content hash, under `packages/YYYY/MM/<hash>.zip` with `putIfAbsent`. Nothing in the package is lost, including files no record uses yet |
| 5 | Which files become records | The **primary TOR** (`TOR*.pdf`, else the lowest `Attach_TOR_n.pdf`) as `documentType: "tor"`, and the final package's `annoudoc_*.pdf` as `documentType: "invitation"`. Both go through `IntakeService.submit`, so type checks, dedupe, immutable storage and extraction all apply |
| 6 | The draft announcement | **Not** submitted as an invitation: its dates are not the final ones |
| 7 | Project identity | `sourceProject: { system: "national-egp", projectId: <11-digit e-GP number>, projectNumber: same }`. Linking already keys on `projectId`; BMA ids are UUIDs, so the two systems cannot collide |
| 8 | Source values | From the RSS item: title, project number (`referenceNo`), procurement method, publish date (`announcedAt`). The feed does not state agency or budget, so extraction reads those |
| 9 | Source link | `sourceUrl` is the package's `downloadFileTest` URL — the exact bytes the record came from |
| 10 | Unpacking | An in-repo ZIP reader (no dependency) with caps: entry count, per-entry size, total size, deflate output limited to the declared size, CRC checked. Stored and deflate only; ZIP64 and encrypted entries are refused |
| 11 | Fetching | Through `safeFetchDocument`, so the scheme, address, redirect, size and timeout rules of spec §5.6 apply to every request |

## 2a. Amendment 2026-10-06: the announcement list is the default way in

The feed application (`EPROCRssFeedWeb`) stopped answering on 2026-10-05 — from this network and,
tested, from an unrelated overseas one — while the rest of the site stayed up. e-GP's public
announcement list (`procsearch.sch`, FPRO9965) is served by the site's main application and lists the
newest announcements of one type nationally, with project number, agency, title, date and budget.
Its default list and paging need no captcha; only its custom search does, and that is not used.

| # | Decision | Answer |
|---|---|---|
| 12 | How projects are found | **The draft-TOR list (type 1) by default**, so a TOR is collected as soon as it is published. `--from invitation` reads the invitation list (type 2); `--from feed` keeps the RSS path |
| 13 | What a draft-list row imports | **The TOR only.** That package's announcement is the draft; the invitation, and so the deadline, arrives from the invitation list later and links onto the same TOR record, which the identical TOR file dedupes onto |
| 14 | Source values from the list | Title, project number, **agency and budget** (the feed stated neither), and the row's date as that document's `announcedAt` |
| 15 | Which file is the TOR | A name starting with TOR first — including e-GP's own TOR form, `tor_<project>_<uuid>.pdf` (digital text) — then a name containing TOR as a word, then the lowest `Attach_TOR_n` (often drawings or annexes), then the one agency-uploaded PDF that is not a standard e-GP file. Two such PDFs are not guessed between |

Paging past the newest 50 rows is not implemented yet.

## 3. Out of scope, and still open

- **Price documents** (`pB0`, `pB1` from `infoDocPriceestZipHis`). They add line-item reference prices and the allocated budget, but need a new supporting `documentType` and redaction of the committee and price-source names. They stay in the archived package until then.
- **The other `Attach_TOR_n` files.** Kept in the archived package, not yet records.
- **A direct project page link.** e-GP's project page (`announcement/procurement/:param`) takes a param the site AES-encrypts with a passphrase in its own client code; reproducing that would break whenever they change it. The detail page instead links e-GP's public search with `?keywordSearch=<project number>`, which the search runs once the visitor passes the site's bot check.
- **The scheduled collector** (F12, FR-A-4). The importer is a one-off, like `tools/import_egp_tors.mts`.
- **RSS item shape on a live weekday.** The parser reads the project number from the description or link; confirm against a real weekday feed.
