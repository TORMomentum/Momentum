# Extraction spike output (TOR-20)

`<model>/tor-NN.json` — what `tools/extract_spike.mjs` pulled from each corpus PDF.
One Gemini call per PDF (native PDF input, no separate Document AI OCR pass).
Each field comes back as `{ value, confidence (0..1), evidence }`; `agency_bma_valid`
is computed by the script against `tools/bma-agencies.json`, not by the model.

Regenerate: `npm run spike:extract` (reads `GEMINI_MODEL` / `VERTEX_LOCATION` from `.env`).

## Run 1 — gemini-3.5-flash @ global, 2026-09-02

10/10 docs extracted. ~69k input + ~10k output tokens total (~US$0.05 for the set,
≈ US$0.005/doc — comfortably inside the PROJECT.md §9 AI budget).

### What worked

| field | result |
|---|---|
| `budget_thb` | **10/10 exact**, incl. all 4 docs where the budget is genuinely absent → `null` (never grabbed the หลักประกันการเสนอราคา figure, incl. tor-06's 2,965,700 with confidence 1.0) |
| `agency` | 10/10 correct entity (minor "… กรุงเทพมหานคร" suffix variance) |
| `agency_bma_valid` | 10/10 (all true — script check) |
| `status` | 10/10 incl. `cancelled` for the ยกเลิก notice (tor-02) |
| `category` | 10/10 to the coarse label |

### Real problems found

1. **Hallucinated date — tor-02.** `submission_deadline` came back `2016-03-09`
   (confidence 0.9) when the doc is a *cancellation* with no bid date. Two faults:
   inventing a value, and a BE→CE slip (๒๕๖๙ read as 2016, not 2026). This is
   exactly what the FR-B3 T_low tier + sanity checks must catch — and confidence
   0.9 means the model won't self-flag it. **Add a rule: `cancelled` ⇒
   `submission_deadline` must be null.**
2. **Thai digits not normalized.** tor-03/05/07/08/09 titles kept ๓ / ๑๙ / ๕/๑
   instead of Arabic. The prompt asks for conversion; the model is inconsistent.
   Cheap post-process, or a firmer instruction.
3. **`procurement_method` not canonical.** Always returns
   `"ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)"` vs the `e-bidding` label — a
   normalization gap (FR-B4), not an extraction error.
4. **JSON-mode flakiness.** ~1 call in 10 prepends chatter ("ได้เล…") despite
   `responseMimeType: application/json`. Script retries up to 3× and slices the
   `{…}`; worth reporting upstream / trying a stricter schema.

### Caveats

- The `rough field match` % the script prints (~78%) is **misleading** —
  most "misses" are #2/#3 above (formatting, not wrong data). Real field
  accuracy on this run is ~95%+. Proper scoring with normalization is TOR-22.
- 9/10 corpus docs have a clean text layer, so this run barely exercised OCR.
  The scanned `_extra/` docs must be run before the TOR-22 thresholds are trusted
  (see `../README.md` limitations).
- No `submission_deadline` is populated in any label (all draft-stage docs), so
  that field's precision is untested except for the tor-02 hallucination.
