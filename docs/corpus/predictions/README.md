# Extraction spike output (TOR-20)

`<model>/tor-NN.json` — what `tools/extract_spike.mjs` pulled from each corpus PDF.
One Gemini call per PDF (native PDF input, no separate Document AI OCR pass).
Each field is `{ value, confidence (0..1), evidence }`; `agency_bma_valid` is
computed by the script against `tools/bma-agencies.json`, not by the model.
`_extra/` = the same on the image-only scans.

Regenerate: `npm run spike:extract` (+ `-- --dir _extra` for the scans), then
`npm run score:extract` for `../BENCHMARK.md`.

## gemini-3.5-flash @ global — 15 docs, ~US$0.07 total (≈ US$0.005/doc)

Comfortably inside the PROJECT.md §9 AI budget.

### Digital corpus (n=10)

- `agency`, `budget_thb`, `category`, `status`, `procurement_method`,
  `announcement_date`: **100%** (after normalisation — see `../BENCHMARK.md`).
  `budget_thb` includes 5 docs where the amount is genuinely absent → all
  correctly `null`; the model never picks up the หลักประกันการเสนอราคา figure.
- `title`: 9/10 (one doc where the model returned the literal shorter header).
- `submission_deadline`: 9/10 — the miss is `tor-02`, a *cancellation* notice
  where the model invented a date at confidence ~0.9.

### Scanned spot-checks (n=5)

- `title`, `agency`, `category`, `status`: strong — including `_extra/tor-16`
  whose PDF text layer is corrupt (the model read the image, ignored the garbage).
- `budget_thb`: the weak spot. `_extra/tor-16`'s ราคากลาง (true 17,295,845.84)
  comes back as `17,295,895.84` — one digit off, at confidence 1.0. `_extra/tor-06`
  returned a figure where the spot-check label has none.
- `submission_deadline`: every scan produced a high-confidence date; every
  spot-check gold (pages 1–3) is `null`. Some of these may be real values on a
  later page — the field is gated to the review queue either way.

## What this means

1. **Thai OCR is not the blocker.** Character recognition on scanned Thai is
   solid across agencies and layouts.
2. **Numbers and dates are the risk** — non-deterministic digit slips on large
   `budget_thb` values, unstable พ.ศ.→ค.ศ. conversion, and over-eager date
   extraction, all at high confidence.
3. **Model confidence does not tell right from wrong** (`../BENCHMARK.md`) — mean
   ~0.96 whether the answer is correct or not.

→ FR-B3 gates deterministic-rules-first: `budget_thb` and date fields from an
OCR'd document never reach the "clean" tier regardless of confidence.
