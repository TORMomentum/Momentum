"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "../features/dashboard/dashboard.module.css";
import { FilterDrop } from "../features/dashboard/FilterDrop";

/**
 * Public transparency dashboard (FR-E-1, FR-E-2). Figures are placeholders
 * until the pipeline fills them; the coverage line says so, which FR-E-6
 * requires the interface to do rather than imply completeness. Ported from
 * the "Dashboard" screen of mockups/TOR Radar App.dc.html — budget is in
 * millions of baht, matching the mockup's `agAll` sample rows; the stat
 * strip below reads from whichever agency (if any) is filtered.
 */
const AGENCIES = [
  { name: "กรมทางหลวง", tors: 86, budget: 412 },
  { name: "กรมชลประทาน", tors: 61, budget: 298 },
  { name: "สพฐ. กระทรวงศึกษาธิการ", tors: 54, budget: 176 },
  { name: "เทศบาลนครเชียงใหม่", tors: 38, budget: 94 },
  { name: "เมืองพัทยา", tors: 29, budget: 71 },
  { name: "กรมควบคุมมลพิษ", tors: 27, budget: 63 },
];

/** Unfiltered dashboard totals (not the sum of AGENCIES above — the sample
 * corpus includes agencies beyond the top 6 shown in the bar chart, matching
 * the mockup's fixed `statTor`/`statBudget`/`statAgency`/`statAnomaly`). */
const TOTAL_STATS = { torCount: "487", budget: "฿1.28B", agencyCount: "128", anomalyCount: "12" };

/** Anomaly count shown when a single agency is filtered — matches the
 * mockup's rule that only the pollution-control department has two. */
const FILTERED_ANOMALY_AGENCY = "กรมควบคุมมลพิษ";

/** Category counts are the mockup's totals; like the stat strip they cover
 * more of the corpus than the six agencies charted above. */
const CATEGORIES = [
  { name: "ก่อสร้าง", tors: 164 },
  { name: "ชลประทาน", tors: 98 },
  { name: "ไอที/ซอฟต์แวร์", tors: 132 },
  { name: "จ้างเหมาบริการ", tors: 93 },
];

const PERIODS = [
  { value: "12", label: "12 เดือนล่าสุด" },
  { value: "6", label: "6 เดือนล่าสุด" },
  { value: "3", label: "3 เดือนล่าสุด" },
];

/** The unfiltered value of every dimension that has one. */
const ALL = "all";

const CATEGORY_COLUMNS = [7, 32, 57, 82];
const SPREAD = [
  0.18, 0.31, 0.24, 0.12, 0.27, 0.2, 0.15, 0.34, 0.22, 0.29, 0.11, 0.25, 0.19, 0.3, 0.16, 0.26,
];

/** The two flagged points on the scatter plot — both link to the one
 * anomaly TOR in the sample corpus (/tors/demo-anomaly), matching the
 * mockup's `dots.push(...)` calls (both route to `detailIdx: 3`). */
const FLAGGED_POINTS = [
  { id: "flag-a", left: "14%", bottom: "68%", size: 12, tip: "฿7.1M · สูงกว่ากลุ่มเทียบ 2.4×IQR — คลิกเพื่อดู" },
  { id: "flag-b", left: "58%", bottom: "80%", size: 13, tip: "฿9.4M · สูงกว่ากลุ่มเทียบ 3.1×IQR — คลิกเพื่อดู" },
];

interface PlotPoint {
  id: string;
  left: string;
  bottom: string;
  size: number;
  flagged: boolean;
  /** The column's category; null on a flagged point, which opens its record. */
  category: string | null;
  tip: string;
}

const AXIS_CATEGORIES = [
  { left: "5%", name: "ก่อสร้าง" },
  { left: "30%", name: "ชลประทาน" },
  { left: "55%", name: "ไอที/ซอฟต์แวร์" },
  { left: "80%", name: "จ้างเหมาบริการ" },
];

export type DashboardDataState = "ready" | "empty" | "offline";

export function DashboardView({
  dataState = "ready",
}: {
  /** Supplied by the server data route once sample figures are replaced. */
  dataState?: DashboardDataState;
} = {}) {
  const [agency, setAgency] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [period, setPeriod] = useState(PERIODS[0].value);
  // One panel open at a time, as in the mockup's single `openDrop`.
  const [openDrop, setOpenDrop] = useState<string | null>(null);

  // A bar is as long as that agency's share of the largest budget, so the
  // chart stays truthful when the figures behind it change.
  const widestBudget = Math.max(...AGENCIES.map((row) => row.budget));

  const selectedAgency = agency === ALL ? null : AGENCIES.find((row) => row.name === agency);
  const statTor = selectedAgency ? String(selectedAgency.tors) : TOTAL_STATS.torCount;
  const statBudget = selectedAgency ? `฿${selectedAgency.budget}M` : TOTAL_STATS.budget;
  const statAgencyCount = selectedAgency ? "1" : TOTAL_STATS.agencyCount;
  const statAnomaly = selectedAgency
    ? selectedAgency.name === FILTERED_ANOMALY_AGENCY
      ? "2"
      : "1"
    : TOTAL_STATS.anomalyCount;

  const points = useMemo(
    () =>
      SPREAD.map<PlotPoint>((height, index) => ({
        id: `p${index}`,
        left: `${CATEGORY_COLUMNS[index % CATEGORY_COLUMNS.length] + ((index * 2.3) % 9)}%`,
        bottom: `${height * 100}%`,
        size: 9,
        flagged: false,
        // A dot's column IS its category, so an unflagged point can honestly
        // lead to that category's listing. Per-document routing arrives when
        // the plot is drawn from real records rather than sample scatter.
        category: CATEGORIES[index % CATEGORIES.length].name,
        tip: `฿${(1 + height * 12).toFixed(1)}M · ในช่วงปกติของกลุ่มเทียบ · คลิกเพื่อดูหมวดนี้`,
      })).concat(
        FLAGGED_POINTS.map((flag) => ({
          id: flag.id,
          left: flag.left,
          bottom: flag.bottom,
          size: flag.size,
          flagged: true,
          category: null,
          tip: flag.tip,
        })),
      ),
    [],
  );

  function toggleDrop(key: string) {
    setOpenDrop((open) => (open === key ? null : key));
  }

  if (dataState !== "ready") {
    const offline = dataState === "offline";

    return (
      <main className={styles.page}>
        <div className={styles.pageHead}>
          <h1 className={styles.pageTitle}>ภาพรวมการจัดซื้อจัดจ้างภาครัฐ</h1>
          <div className={styles.coverage}>ครอบคลุมเฉพาะเอกสารที่ระบบรวบรวมได้</div>
        </div>
        <section className={styles.dataState} aria-live="polite">
          <div className={styles.dataStateContent}>
            <h2 className={styles.dataStateTitle}>
              {offline ? "ยังเปิดข้อมูลภาพรวมไม่ได้" : "ยังไม่มีข้อมูลสำหรับภาพรวม"}
            </h2>
            <p className={styles.dataStateBody}>
              {offline
                ? "ขณะนี้ยังเชื่อมต่อกับบริการข้อมูลไม่ได้ จึงยังไม่ทราบว่ามี TOR ในชุดข้อมูลที่รวบรวมไว้เท่าใด ลองใหม่อีกครั้งในภายหลัง"
                : "ระบบยังไม่ได้รวบรวม TOR เข้ามา เมื่อมีเอกสารชุดแรก ตัวเลขและแผนภูมิจะปรากฏที่นี่ โดยครอบคลุมเฉพาะเอกสารที่ระบบรวบรวมได้"}
            </p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>ภาพรวมการจัดซื้อจัดจ้างภาครัฐ</h1>
        <div className={styles.coverage}>
          อัปเดตข้อมูลล่าสุด 12 ส.ค. 2569 · 09:42
          <br />
          ครอบคลุมเฉพาะเอกสารที่นำเข้าระบบ · ตัวเลขเป็นข้อมูลตัวอย่าง
        </div>
      </div>

      <div className={styles.filters}>
        <FilterDrop
          label="หน่วยงาน"
          value={agency}
          open={openDrop === "agency"}
          onToggle={() => toggleDrop("agency")}
          onPick={(value) => {
            setAgency(value);
            setOpenDrop(null);
          }}
          options={[
            { value: ALL, label: "ทั้งหมด", meta: TOTAL_STATS.torCount },
            ...AGENCIES.map((row) => ({
              value: row.name,
              label: row.name,
              meta: String(row.tors),
            })),
          ]}
        />

        <FilterDrop
          label="หมวดหมู่"
          value={category}
          open={openDrop === "category"}
          onToggle={() => toggleDrop("category")}
          onPick={(value) => {
            setCategory(value);
            setOpenDrop(null);
          }}
          options={[
            { value: ALL, label: "ทั้งหมด" },
            ...CATEGORIES.map((item) => ({
              value: item.name,
              label: item.name,
              meta: String(item.tors),
            })),
          ]}
        />

        <FilterDrop
          label="ช่วงเวลา"
          value={period}
          open={openDrop === "period"}
          onToggle={() => toggleDrop("period")}
          onPick={(value) => {
            setPeriod(value);
            setOpenDrop(null);
          }}
          options={PERIODS.map((item) => ({ value: item.value, label: item.label }))}
          highlightWhenSet={false}
        />
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statKey}>TOR ทั้งหมด</div>
          <div className={styles.statValue}>{statTor}</div>
          <div className={styles.statNote}>ฉบับ</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statKey}>งบประมาณรวม</div>
          <div className={styles.statValue}>{statBudget}</div>
          <div className={styles.statNote}>ตามราคากลางที่ประกาศ</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statKey}>หน่วยงาน</div>
          <div className={styles.statValue}>{statAgencyCount}</div>
          <div className={styles.statNote}>หน่วยงานรัฐทั่วประเทศ</div>
        </div>
        <div className={`${styles.stat} ${styles.statFlagged}`}>
          <div className={styles.statKey}>ความผิดปกติทางสถิติ</div>
          <div className={styles.statValue}>{statAnomaly}</div>
          <div className={styles.statNote}>เกณฑ์ 1.5×IQR — ไม่ใช่ข้อกล่าวหา</div>
        </div>
      </div>

      <div className={styles.split}>
        <section className={styles.splitLeft}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>TOR ตามหน่วยงาน</h2>
            <span className={styles.panelHint}>คลิกแท่งเพื่อกรอง</span>
          </div>

          <div className={styles.bars}>
            {/* Every agency stays on screen when one is picked; the rest fade.
                That is what makes the selected bar readable AS a comparison —
                dropping the other rows would leave a one-bar chart. */}
            {AGENCIES.map((row, index) => {
              const dimmed = agency !== ALL && agency !== row.name;
              return (
                <button
                  type="button"
                  key={row.name}
                  className={`${styles.bar} ${dimmed ? styles.barDim : ""}`}
                  onClick={() => setAgency(agency === row.name ? ALL : row.name)}
                  aria-pressed={agency === row.name}
                >
                  <span className={styles.barLabel}>
                    <span className={styles.barName}>{row.name}</span>
                    <span className={styles.barStat}>
                      {row.tors} · ฿{row.budget}M
                    </span>
                  </span>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.barFill}
                      style={{
                        width: `${(row.budget / widestBudget) * 100}%`,
                        animationDelay: `${index * 70}ms`,
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>

          <Link href="/search" className={styles.moreLink}>
            ดู TOR ทั้งหมดในหน้าค้นหา →
          </Link>
        </section>

        <section className={styles.splitRight}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>งบประมาณตามหมวดหมู่</h2>
            <span className={styles.panelHint}>1 จุด = 1 TOR · คลิกจุดเพื่อดูรายละเอียด</span>
          </div>

          <div className={styles.plot}>
            <span className={styles.axis} style={{ top: -4 }}>฿10M</span>
            <span className={styles.axis} style={{ top: 124 }}>฿5M</span>
            <span className={styles.axis} style={{ bottom: -4 }}>฿0</span>
            <div className={styles.grid} style={{ top: 130 }} />
            <div className={styles.grid} style={{ top: 65 }} />

            {points.map((point, index) => (
              <Link
                key={point.id}
                href={point.flagged ? "/tors/demo-anomaly" : "/search"}
                className={`${styles.dot} ${point.flagged ? styles.dotFlagged : ""}`}
                style={{
                  left: point.left,
                  bottom: point.bottom,
                  width: point.size,
                  height: point.size,
                  animationDelay: `${index * 35}ms`,
                }}
                title={point.tip}
                aria-label={point.tip}
              />
            ))}

            <div className={styles.plotFlag} style={{ left: "62%", bottom: "87%" }}>
              [ ความผิดปกติทางสถิติ ] ฿9.4M · 3.1×IQR
            </div>

            {AXIS_CATEGORIES.map((item) => (
              <div key={item.name} className={styles.plotCategory} style={{ left: item.left }}>
                {item.name}
              </div>
            ))}
          </div>

          <p className={styles.method}>
            &quot;ความผิดปกติทางสถิติ&quot; = นอกช่วง 1.5×IQR ของกลุ่มเทียบ (หมวด × ช่วงเวลา) —
            ไม่ใช่ข้อกล่าวหา · กลุ่ม n &lt; 8 ไม่ถูกตั้งธง
          </p>
        </section>
      </div>
    </main>
  );
}
