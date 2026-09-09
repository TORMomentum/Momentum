"use client";

import { useId, useState } from "react";
import styles from "./budget-range.module.css";
import { formatBudgetShort } from "../../data/tor-samples";

/**
 * Two-handle budget slider, ported from the Search screen of
 * mockups/TOR Radar App.dc.html (its `minBudget`/`maxBudget` pair, the gooey
 * handles included).
 *
 * The vendor profile states its budget interest with it (FR-D-2). The Search
 * screen still carries its own copy of this markup and reads the same
 * stylesheet; folding that copy in here is a separate change.
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
}: {
  min: number;
  max: number;
  floor: number;
  ceiling: number;
  step: number;
  onChange: (next: { min: number; max: number }) => void;
  minLabel?: string;
  maxLabel?: string;
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

  return (
    <>
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
        <span>{formatBudgetShort(floor)}</span>
        <span className={styles.sliderLabelActive}>
          {formatBudgetShort(min)} — {formatBudgetShort(max)}
        </span>
        <span>{formatBudgetShort(ceiling)}</span>
      </div>
    </>
  );
}
