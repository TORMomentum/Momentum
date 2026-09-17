import Link from "next/link";
import type { DashboardPayload } from "../../shared/api/stats.api";
import { thaiDigitsToArabic } from "../../shared/lib/format";
import styles from "./dashboard.module.css";

const PERCENT = 100;
const MINIMUM_DOMAIN = 1;

function formatBudget(value: number): string {
  return `฿${value.toLocaleString("en-US")}`;
}

function confidenceLabel(confidence: number | null): string {
  return confidence === null ? "ไม่ระบุ" : `${Math.round(confidence * PERCENT)}%`;
}

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

  const maximum = Math.max(MINIMUM_DOMAIN, ...points.map((point) => point.budget), ...selectedBounds.map((bound) => bound.highBound ?? MINIMUM_DOMAIN));
  const categories = [...new Set(points.map((point) => point.category))];
  const months = [...new Set(points.map((point) => point.month))];
  const axis = category ? months : categories;
  const denominator = Math.max(axis.length - 1, MINIMUM_DOMAIN);

  return (
    <div className={styles.plot} aria-label="กราฟงบประมาณ TOR">
      <span className={styles.axis} style={{ top: 0 }}>{formatBudget(maximum)}</span>
      <span className={styles.axis} style={{ bottom: 0 }}>฿0</span>
      <div className={styles.grid} style={{ top: "50%" }} />
      {category && selectedBounds.map((bound) => {
        if (!bound.eligible || bound.lowBound === null || bound.highBound === null) return null;
        const position = months.indexOf(bound.month) / denominator * PERCENT;
        const low = Math.max(0, bound.lowBound / maximum * PERCENT);
        const high = Math.min(PERCENT, bound.highBound / maximum * PERCENT);
        return <span key={`${bound.category}-${bound.month}`} className={styles.plotBand} style={{ left: `${position}%`, bottom: `${low}%`, height: `${high - low}%` }} aria-label={`ช่วงเปรียบเทียบ ${bound.month}`} />;
      })}
      {points.map((point) => {
        const position = axis.indexOf(category ? point.month : point.category) / denominator * PERCENT;
        const height = point.budget / maximum * PERCENT;
        const flagged = point.verdict.kind === "anomaly";
        const rule = flagged ? `ความผิดปกติทางสถิติ: ${point.verdict.side === "high" ? "สูง" : "ต่ำ"}` : "อยู่ในช่วงเปรียบเทียบ";
        const tooltip = `${rule} · ค่าที่สร้างโดย AI · ความเชื่อมั่น ${confidenceLabel(point.confidence)} · รุ่นโมเดล ${point.modelVersion ?? "ไม่ระบุ"}`;
        return (
          <Link
            key={point.id}
            href={`/tors/${encodeURIComponent(point.id)}`}
            className={`${styles.dot} ${flagged ? styles.dotFlagged : ""}`}
            style={{ left: `${position}%`, bottom: `${height}%` }}
            title={tooltip}
            aria-label={tooltip}
          />
        );
      })}
      {axis.map((value, index) => <span key={value} className={styles.plotCategory} style={{ left: `${index / denominator * PERCENT}%` }}>{thaiDigitsToArabic(value)}</span>)}
    </div>
  );
}
