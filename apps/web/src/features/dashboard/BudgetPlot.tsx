import Link from "next/link";
import type { DashboardPayload } from "../../shared/api/stats.api";
import { formatBaht, formatBudgetShort, thaiDigitsToArabic } from "../../shared/lib/format";
import styles from "./dashboard.module.css";

const PERCENT = 100;
const MINIMUM_DOMAIN = 1;
/** How far a dot may sit from its column's centre, as a share of the column width. */
const SPREAD = 0.28;

function confidenceLabel(confidence: number | null): string {
  return confidence === null ? "ไม่ระบุ" : `${Math.round(confidence * PERCENT)}%`;
}

/** Columns past which category names are angled rather than wrapped under their column. */
const CROWDED_COLUMNS = 6;

/** A round axis ceiling — 1, 2 or 5 × 10ⁿ — at or above the largest value. */
function niceCeiling(value: number): number {
  if (value <= MINIMUM_DOMAIN) return MINIMUM_DOMAIN;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((multiple) => multiple * magnitude >= value) ?? 10;
  return step * magnitude;
}

/**
 * A stable offset in [-1, 1] for a dot, so budgets in one column spread out
 * instead of stacking on a line, and do not reshuffle on every render.
 */
function jitter(id: string): number {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ((Math.abs(hash) % 1000) / 1000 - 0.5) * 2;
}

/**
 * Budgets by category, one dot per TOR, laid out as the "Dashboard" screen of
 * mockups/TOR Radar App.dc.html: a centred column per category (or per month
 * once a category is chosen), a rounded budget axis, and the flagged budget
 * named beside its dot. Every verdict comes from the API; the plot only draws.
 */
export function BudgetPlot({
  points,
  bounds,
  category,
  peerMinN,
}: Pick<DashboardPayload, "points" | "bounds"> & { category?: string; peerMinN: number }) {
  if (points.length === 0) {
    return <p className={styles.panelState}>ยังไม่มี TOR ในหมวดหมู่นี้</p>;
  }

  const selectedBounds = category ? bounds.filter((bound) => bound.category === category) : [];
  const insufficient = category && selectedBounds.length > 0 && selectedBounds.every((bound) => !bound.eligible);
  if (insufficient) {
    const largestGroup = Math.max(...selectedBounds.map((bound) => bound.n));
    return <p className={styles.panelState}>มี TOR ที่เปรียบเทียบได้ไม่เพียงพอ ({largestGroup}/{peerMinN})</p>;
  }

  const maximum = niceCeiling(
    Math.max(
      MINIMUM_DOMAIN,
      ...points.map((point) => point.budget),
      ...selectedBounds.map((bound) => bound.highBound ?? MINIMUM_DOMAIN),
    ),
  );
  const categories = [...new Set(points.map((point) => point.category))];
  const months = [...new Set(points.map((point) => point.month))].sort();
  const axis = category ? months : categories;
  const columnWidth = PERCENT / axis.length;
  // Past a handful of columns a Thai category name no longer fits under its own column, wraps into
  // its neighbours and down into the note below. Then each name goes on one angled line instead.
  const crowded = axis.length > CROWDED_COLUMNS;
  const centreOf = (value: string) => columnWidth * (axis.indexOf(value) + 0.5);
  const heightOf = (budget: number) => Math.min(PERCENT, (budget / maximum) * PERCENT);

  const firstFlag = points.find((point) => point.verdict.kind === "anomaly");

  return (
    <div className={`${styles.plot} ${crowded ? styles.plotCrowded : ""}`} aria-label="กราฟงบประมาณ TOR">
      <span className={styles.axis} style={{ top: -6 }}>{formatBudgetShort(maximum)}</span>
      <span className={styles.axis} style={{ top: "calc(50% - 6px)" }}>{formatBudgetShort(maximum / 2)}</span>
      <span className={styles.axis} style={{ bottom: -6 }}>฿0</span>
      <div className={styles.grid} style={{ top: "50%" }} />
      <div className={styles.grid} style={{ top: "25%" }} />

      {category && selectedBounds.map((bound) => {
        if (!bound.eligible || bound.lowBound === null || bound.highBound === null) return null;
        const low = Math.max(0, heightOf(bound.lowBound));
        const high = heightOf(bound.highBound);
        return (
          <span
            key={`${bound.category}-${bound.month}`}
            className={styles.plotBand}
            style={{ left: `${centreOf(bound.month)}%`, bottom: `${low}%`, height: `${high - low}%` }}
            aria-label={`ช่วงเปรียบเทียบ ${bound.month}`}
          />
        );
      })}

      {points.map((point, index) => {
        const column = category ? point.month : point.category;
        const flagged = point.verdict.kind === "anomaly";
        const rule = flagged ? `ความผิดปกติทางสถิติ: ${point.verdict.side === "high" ? "สูง" : "ต่ำ"}` : "อยู่ในช่วงเปรียบเทียบ";
        const tooltip = `${formatBaht(point.budget)} · ${rule} · ค่าที่สร้างโดย AI · ความเชื่อมั่น ${confidenceLabel(point.confidence)} · รุ่นโมเดล ${point.modelVersion ?? "ไม่ระบุ"}`;
        return (
          <Link
            key={point.id}
            href={`/tors/${encodeURIComponent(point.id)}`}
            className={`${styles.dot} ${flagged ? styles.dotFlagged : ""}`}
            style={{
              left: `${centreOf(column) + jitter(point.id) * columnWidth * SPREAD}%`,
              bottom: `${heightOf(point.budget)}%`,
              animationDelay: `${index * 35}ms`,
            }}
            title={tooltip}
            aria-label={tooltip}
          />
        );
      })}

      {firstFlag && (
        <div
          className={styles.plotFlag}
          style={{
            left: `${centreOf(category ? firstFlag.month : firstFlag.category)}%`,
            bottom: `calc(${Math.min(heightOf(firstFlag.budget), 92)}% + 12px)`,
          }}
        >
          [ ความผิดปกติทางสถิติ ] {formatBudgetShort(firstFlag.budget)}
        </div>
      )}

      {axis.map((value) => (
        <span
          key={value}
          className={`${styles.plotCategory} ${crowded ? styles.plotCategoryAngled : ""}`}
          style={crowded ? { left: `${centreOf(value)}%` } : { left: `${centreOf(value)}%`, maxWidth: `${columnWidth}%` }}
          title={thaiDigitsToArabic(value)}
        >
          {thaiDigitsToArabic(value)}
        </span>
      ))}
    </div>
  );
}
