"use client";

import { useId, useState } from "react";
import styles from "./budget-range.module.css";
import { formatBudgetShort } from "../../data/tor-samples";
import { thaiDigitsToArabic } from "../lib/format";

/**
 * Two-handle budget slider, ported from the Search screen of
 * mockups/TOR Radar App.dc.html (its `minBudget`/`maxBudget` pair, the gooey
 * handles included).
 *
 * Shared by the vendor profile (FR-D-2), the search filters and the admin
 * vendor screen. The two amounts can be TYPED as well as dragged: landing a
 * handle on an exact figure like ฿5,000,000 by dragging is fiddly, and a typed
 * value is what a vendor actually has in mind.
 *
 * Search's match filter reuses it with `unit="percent"` and the match tone, so
 * there is one range control in the product, not two that drift apart.
 */
export function BudgetRange({
  min,
  max,
  floor,
  ceiling,
  step,
  onChange,
  minLabel = "งบประมาณขั้นต่ำ",
  maxLabel = "งบประมาณสูงสุด",
  unit = "baht",
  tone = "blue",
  stacked = false,
}: {
  min: number;
  max: number;
  floor: number;
  ceiling: number;
  step: number;
  onChange: (next: { min: number; max: number }) => void;
  minLabel?: string;
  maxLabel?: string;
  unit?: Unit;
  /** `match` uses the colour of the match-score badges the filter acts on. */
  tone?: "blue" | "match";
  /** One labelled amount per row, for a column too narrow for a long figure beside another. */
  stacked?: boolean;
}) {
  // The SVG filter is referenced by id, so two sliders on one page must not
  // share one.
  const gooId = useId().replace(/[:]/g, "");
  const [hoverMin, setHoverMin] = useState(false);
  const [hoverMax, setHoverMax] = useState(false);

  const span = ceiling - floor;
  const minPct = ((min - floor) / span) * 100;
  const maxPct = 100 - ((max - floor) / span) * 100;

  // The handle swells and opens a hole while it is being dragged, which is
  // what makes the two handles read as one liquid control in the mockup.
  const minBall = hoverMin ? 28 : 15;
  const maxBall = hoverMax ? 28 : 15;
  const minHole = hoverMin ? 13 : 0;
  const maxHole = hoverMax ? 13 : 0;

  const clamp = (value: number) => Math.min(Math.max(value, floor), ceiling);

  return (
    <div className={`${styles.root} ${tone === "match" ? styles.toneMatch : ""}`}>
      {stacked ? (
        // A narrow column: one amount per row, labelled as the date range
        // filter beside it is, so a long figure always has the full width.
        <div className={styles.amountsStacked}>
          <span className={styles.amountLabel}>ตั้งแต่</span>
          <AmountBox
            value={min}
            unit={unit}
            label={minLabel}
            // A minimum typed above the maximum carries the maximum up with it,
            // rather than refusing the entry or quietly swapping the two.
            onCommit={(next) => {
              const value = clamp(next);
              onChange({ min: value, max: Math.max(max, value) });
            }}
          />
          <span className={styles.amountLabel}>ถึง</span>
          <AmountBox
            value={max}
            unit={unit}
            label={maxLabel}
            onCommit={(next) => {
              const value = clamp(next);
              onChange({ min: Math.min(min, value), max: value });
            }}
          />
        </div>
      ) : (
        <div className={styles.amounts}>
          <AmountBox
            value={min}
            unit={unit}
            label={minLabel}
            // A minimum typed above the maximum carries the maximum up with it,
            // rather than refusing the entry or quietly swapping the two.
            onCommit={(next) => {
              const value = clamp(next);
              onChange({ min: value, max: Math.max(max, value) });
            }}
          />
          <span className={styles.amountDash} aria-hidden="true">
            —
          </span>
          <AmountBox
            value={max}
            unit={unit}
            label={maxLabel}
            onCommit={(next) => {
              const value = clamp(next);
              onChange({ min: Math.min(min, value), max: value });
            }}
          />
        </div>
      )}
      <div className={styles.sliderWrap}>
        <svg width="0" height="0" style={{ position: "absolute" }}>
          <defs>
            <filter id={gooId}>
              <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b" />
              <feColorMatrix
                in="b"
                mode="matrix"
                values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
                result="g"
              />
              <feComposite in="SourceGraphic" in2="g" operator="atop" />
            </filter>
          </defs>
        </svg>
        <div className={styles.sliderTrackBg} />
        <div className={styles.sliderGoo} style={{ filter: `url(#${gooId})` }}>
          <div className={styles.sliderFill} style={{ left: `${minPct}%`, right: `${maxPct}%` }} />
          <div
            className={styles.sliderBall}
            style={{ left: `${minPct}%`, width: minBall, height: minBall }}
          />
          <div
            className={`${styles.sliderBall} ${styles.sliderBallMax}`}
            style={{ right: `${maxPct}%`, width: maxBall, height: maxBall }}
          />
        </div>
        <div
          className={styles.sliderHole}
          style={{ left: `${minPct}%`, width: minHole, height: minHole }}
        />
        <div
          className={`${styles.sliderHole} ${styles.sliderHoleMax}`}
          style={{ right: `${maxPct}%`, width: maxHole, height: maxHole }}
        />
        <input
          type="range"
          className={styles.rangeInput}
          min={floor}
          max={ceiling}
          step={step}
          value={min}
          onChange={(e) => onChange({ min: Math.min(Number(e.target.value), max), max })}
          onMouseEnter={() => setHoverMin(true)}
          onMouseLeave={() => setHoverMin(false)}
          onTouchStart={() => setHoverMin(true)}
          onTouchEnd={() => setHoverMin(false)}
          aria-label={minLabel}
        />
        <input
          type="range"
          className={styles.rangeInput}
          min={floor}
          max={ceiling}
          step={step}
          value={max}
          onChange={(e) => onChange({ min, max: Math.max(Number(e.target.value), min) })}
          onMouseEnter={() => setHoverMax(true)}
          onMouseLeave={() => setHoverMax(false)}
          onTouchStart={() => setHoverMax(true)}
          onTouchEnd={() => setHoverMax(false)}
          aria-label={maxLabel}
        />
      </div>
      <div className={styles.sliderLabels}>
        <span>{UNITS[unit].short(floor)}</span>
        <span>{UNITS[unit].short(ceiling)}</span>
      </div>
    </div>
  );
}

/** Thai or Arabic digits, with or without separators, as people type money. */
export function parseBaht(text: string): number | null {
  const digits = thaiDigitsToArabic(text).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isSafeInteger(value) ? value : null;
}

const BAHT = new Intl.NumberFormat("th-TH");

type Unit = "baht" | "percent";

/** How each unit reads: the symbol and on which side, and the end labels. */
const UNITS: Record<Unit, { symbol: string; after: boolean; short: (value: number) => string }> = {
  baht: { symbol: "฿", after: false, short: formatBudgetShort },
  percent: { symbol: "%", after: true, short: (value) => `${value}%` },
};

/**
 * One typed amount. Kept as a draft while being typed and committed on Enter
 * or on leaving the box — committing every keystroke would drag the slider
 * through ฿5, ฿50, ฿500… on the way to ฿5,000,000 and fight the person typing.
 * An unreadable entry snaps back to the current value rather than to zero.
 */
function AmountBox({
  value,
  unit,
  label,
  onCommit,
}: {
  value: number;
  unit: Unit;
  label: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const parsed = parseBaht(draft);
    setDraft(null);
    if (parsed !== null && parsed !== value) onCommit(parsed);
  }

  return (
    <label className={styles.amountBox}>
      {!UNITS[unit].after && (
        <span className={styles.amountCurrency} aria-hidden="true">
          {UNITS[unit].symbol}
        </span>
      )}
      <input
        type="text"
        inputMode="numeric"
        className={styles.amountInput}
        aria-label={label}
        value={draft ?? BAHT.format(value)}
        onFocus={(event) => {
          setDraft(String(value));
          event.target.select();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") setDraft(null);
        }}
      />
      {UNITS[unit].after && (
        <span className={styles.amountCurrency} aria-hidden="true">
          {UNITS[unit].symbol}
        </span>
      )}
    </label>
  );
}
