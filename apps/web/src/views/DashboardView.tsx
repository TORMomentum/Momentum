"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "../features/app-shell/app.module.css";

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
 * mockup's `agSel.name === 'กรมควบคุมมลพิษ' ? '2' : '1'`. */
const FILTERED_ANOMALY_AGENCY = "กรมควบคุมมลพิษ";

const CATEGORIES = ["ก่อสร้าง", "ชลประทาน", "ไอที/ซอฟต์แวร์", "จ้างเหมาบริการ"];
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

export function DashboardView() {
  const [agency, setAgency] = useState("all");
  const [category, setCategory] = useState("all");

  const shown = useMemo(
    () => (agency === "all" ? AGENCIES : AGENCIES.filter((row) => row.name === agency)),
    [agency],
  );

  const widest = Math.max(...AGENCIES.map((row) => row.tors));

  const selectedAgency = agency === "all" ? null : AGENCIES.find((row) => row.name === agency);
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
        category: CATEGORIES[index % CATEGORIES.length],
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

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>ภาพรวมการจัดซื้อจัดจ้างภาครัฐ</h1>
        <div className={styles.coverage}>
          DATA LAST UPDATED 12 AUG 2026 · 09:42
          <br />
          ครอบคลุมเฉพาะเอกสารที่นำเข้าระบบ · ตัวเลขเป็นข้อมูลตัวอย่าง
        </div>
      </div>

      <div className={styles.filters}>
        <select
          className={styles.filter}
          value={agency}
          onChange={(event) => setAgency(event.target.value)}
          aria-label="กรองตามหน่วยงาน"
        >
          <option value="all">หน่วยงาน: ทั้งหมด</option>
          {AGENCIES.map((row) => (
            <option key={row.name} value={row.name}>
              {row.name}
            </option>
          ))}
        </select>

        <select
          className={styles.filter}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="กรองตามหมวดหมู่"
        >
          <option value="all">หมวดหมู่: ทั้งหมด</option>
          {CATEGORIES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>

        <select className={styles.filter} aria-label="ช่วงเวลา" defaultValue="12">
          <option value="12">ช่วงเวลา: 12 เดือน</option>
          <option value="6">6 เดือน</option>
          <option value="3">3 เดือน</option>
        </select>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statKey}>[ TOR ทั้งหมด ]</div>
          <div className={styles.statValue}>{statTor}</div>
          <div className={styles.statNote}>ฉบับ</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statKey}>[ งบประมาณรวม ]</div>
          <div className={styles.statValue}>{statBudget}</div>
          <div className={styles.statNote}>ตามราคากลางที่ประกาศ</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statKey}>[ หน่วยงาน ]</div>
          <div className={styles.statValue}>{statAgencyCount}</div>
          <div className={styles.statNote}>หน่วยงานรัฐทั่วประเทศ</div>
        </div>
        <div className={`${styles.stat} ${styles.statFlagged}`}>
          <div className={styles.statKey}>[ ความผิดปกติทางสถิติ ]</div>
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
            {shown.map((row, index) => (
              <button
                type="button"
                key={row.name}
                className={styles.bar}
                onClick={() => setAgency(agency === row.name ? "all" : row.name)}
              >
                <span className={styles.barLabel}>
                  <span className={styles.barName}>{row.name}</span>
                  <span className={styles.barStat}>
                    {row.tors} ฉบับ · ฿{row.budget}M
                  </span>
                </span>
                <span className={styles.barTrack}>
                  <span
                    className={styles.barFill}
                    style={{
                      width: `${(row.tors / widest) * 100}%`,
                      animationDelay: `${index * 70}ms`,
                    }}
                  />
                </span>
              </button>
            ))}
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
              [ ANOMALY ] ฿9.4M · 3.1×IQR
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
