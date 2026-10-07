"use client";

import { MATCH_THRESHOLD } from "@tor-radar/shared";
import { useState } from "react";
import { thaiDigitsToArabic } from "../../shared/lib/format";
import styles from "./match-threshold.module.css";

/**
 * "Match at least N%" for a signed-in vendor: one slider plus a typed box,
 * the same shape as the budget filter beside it, so the panel stays one line
 * tall instead of a list of fixed options. `value` is the whole percentage;
 * `MATCH_THRESHOLD.off` means no filter.
 */
export function MatchThreshold({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(Math.max(n, MATCH_THRESHOLD.off), MATCH_THRESHOLD.max);

  // Committed on Enter or leaving the box, as the budget amounts are: a
  // keystroke-by-keystroke commit would search for 7% on the way to 70%.
  function commit() {
    if (draft === null) return;
    const digits = thaiDigitsToArabic(draft).replace(/[^0-9]/g, "");
    setDraft(null);
    if (digits) {
      const next = clamp(Number(digits));
      if (next !== value) onChange(next);
    }
  }

  const off = value === MATCH_THRESHOLD.off;

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        <span className={styles.lead}>อย่างน้อย</span>
        <label className={styles.box}>
          <input
            type="text"
            inputMode="numeric"
            className={styles.input}
            aria-label="คะแนนความตรงขั้นต่ำ (%)"
            value={draft ?? String(value)}
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
          <span className={styles.unit} aria-hidden="true">
            %
          </span>
        </label>
        {off && <span className={styles.hint}>แสดงทั้งหมด</span>}
      </div>
      <input
        type="range"
        className={styles.range}
        min={MATCH_THRESHOLD.off}
        max={MATCH_THRESHOLD.max}
        step={MATCH_THRESHOLD.step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label="คะแนนความตรงขั้นต่ำ"
      />
      <div className={styles.labels}>
        <span>ทั้งหมด</span>
        <span>{MATCH_THRESHOLD.max}%</span>
      </div>
    </div>
  );
}
