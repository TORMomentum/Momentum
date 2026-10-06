"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BudgetPlot } from "../features/dashboard/BudgetPlot";
import { FilterDrop } from "../features/dashboard/FilterDrop";
import styles from "../features/dashboard/dashboard.module.css";
import type { DashboardPayload } from "../shared/api/stats.api";
import { thaiDigitsToArabic } from "../shared/lib/format";
import { serialiseDashboardFilters, type DashboardFilters } from "../shared/lib/dashboard-filters";

const ALL = "all";

function formatBudget(value: number): string {
  return `฿${value.toLocaleString("en-US")}`;
}

function formatDate(value: string | null): string {
  if (!value) return "ยังไม่มีข้อมูล";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(new Date(value));
}

export function DashboardView({
  dashboard,
  filters,
  error = false,
}: {
  dashboard?: DashboardPayload;
  filters: DashboardFilters;
  error?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [openDrop, setOpenDrop] = useState<string | null>(null);

  function updateFilters(change: Partial<DashboardFilters>) {
    const next = { ...filters, ...change };
    for (const key of Object.keys(next) as Array<keyof DashboardFilters>) if (next[key] === undefined) delete next[key];
    const query = serialiseDashboardFilters(next).toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  if (!dashboard) {
    return (
      <main className={styles.page}>
        <div className={styles.pageHead}>
          <h1 className={styles.pageTitle}>ภาพรวมการจัดซื้อจัดจ้างภาครัฐ</h1>
          <div className={styles.coverage}>ครอบคลุมเฉพาะเอกสาร TOR ที่ระบบรวบรวมได้</div>
        </div>
        <section className={styles.dataState} aria-live="polite">
          <div className={styles.dataStateContent}>
            <h2 className={styles.dataStateTitle}>{error ? "ยังเปิดข้อมูลภาพรวมไม่ได้" : "ยังไม่มีข้อมูลสำหรับภาพรวม"}</h2>
            <p className={styles.dataStateBody}>{error ? "ไม่สามารถเชื่อมต่อบริการข้อมูลได้ โปรดลองใหม่อีกครั้ง" : "ระบบยังไม่มี TOR ที่รวบรวมแล้ว"}</p>
            {error && <button type="button" className={styles.retry} onClick={() => router.refresh()}>ลองใหม่</button>}
          </div>
        </section>
      </main>
    );
  }

  const empty = dashboard.totals.torCount === 0;
  const agencies = dashboard.byAgency;
  // The widest bar is the scale, so one agency's share is readable against the
  // others rather than against an arbitrary ceiling.
  const widestBudget = agencies.reduce((widest, row) => Math.max(widest, row.budgetSum), 0);
  const categories = [...new Set(dashboard.points.map((point) => point.category))];

  return (
    <main className={styles.page}>
      <div className={styles.pageHead}>
        <h1 className={styles.pageTitle}>ภาพรวมการจัดซื้อจัดจ้างภาครัฐ</h1>
        <div className={styles.coverage}>
          อัปเดตการรับข้อมูลล่าสุด {formatDate(dashboard.meta.lastIntakeAt)}
          <br />
          ครอบคลุมเฉพาะเอกสาร TOR ที่ระบบรวบรวมได้
        </div>
      </div>

      {dashboard.meta.stale && <p className={styles.stale} role="status">กำลังคำนวณข้อมูลสถิติใหม่ ตัวเลขอาจยังไม่เป็นปัจจุบัน</p>}

      <div className={styles.filters}>
        <FilterDrop
          label="หน่วยงาน"
          value={filters.agency ?? ALL}
          open={openDrop === "agency"}
          onToggle={() => setOpenDrop(openDrop === "agency" ? null : "agency")}
          onPick={(agency) => { updateFilters({ agency: agency === ALL ? undefined : agency }); setOpenDrop(null); }}
          options={[{ value: ALL, label: "ทั้งหมด" }, ...agencies.map((agency) => ({ value: agency.agency, label: thaiDigitsToArabic(agency.agency), meta: String(agency.torCount) }))]}
        />
        <FilterDrop
          label="หมวดหมู่"
          value={filters.category ?? ALL}
          open={openDrop === "category"}
          onToggle={() => setOpenDrop(openDrop === "category" ? null : "category")}
          onPick={(category) => { updateFilters({ category: category === ALL ? undefined : category }); setOpenDrop(null); }}
          options={[{ value: ALL, label: "ทั้งหมด" }, ...categories.map((category) => ({ value: category, label: thaiDigitsToArabic(category) }))]}
        />
      </div>

      {empty ? (
        <section className={styles.dataState} aria-live="polite"><div className={styles.dataStateContent}><h2 className={styles.dataStateTitle}>ยังไม่มี TOR สำหรับตัวกรองนี้</h2><p className={styles.dataStateBody}>ลองล้างตัวกรองเพื่อดูเอกสารที่ระบบรวบรวมได้</p></div></section>
      ) : <>
        <div className={styles.stats}>
          <div className={styles.stat}><div className={styles.statKey}>TOR ทั้งหมด</div><div className={styles.statValue}>{dashboard.totals.torCount.toLocaleString("th-TH")}</div><div className={styles.statNote}>ฉบับ</div></div>
          <div className={styles.stat}><div className={styles.statKey}>งบประมาณรวม</div><div className={styles.statValue}>{formatBudget(dashboard.totals.budgetSum)}</div><div className={styles.statNote}>ตามราคากลางที่ประกาศ</div></div>
          <div className={styles.stat}><div className={styles.statKey}>หน่วยงาน</div><div className={styles.statValue}>{dashboard.totals.agencyCount.toLocaleString("th-TH")}</div><div className={styles.statNote}>หน่วยงานรัฐทั่วประเทศ</div></div>
          {dashboard.flagged.count !== null && <div className={`${styles.stat} ${styles.statFlagged}`}><div className={styles.statKey}>ความผิดปกติทางสถิติ</div><div className={styles.statValue}>{dashboard.flagged.count.toLocaleString("th-TH")}</div><div className={styles.statNote}>ดูวิธีคำนวณได้ที่ <Link href="/methodology">ระเบียบวิธี</Link></div></div>}
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
                dropping the other rows would leave a one-bar chart.

                Clicking writes the same `agency` filter the dropdown writes, so
                the two controls cannot disagree and the choice survives a
                reload or a shared link. */}
            {agencies.map((row, index) => {
              const picked = filters.agency === row.agency;
              return (
                <button
                  type="button"
                  key={row.agency}
                  className={`${styles.bar} ${filters.agency && !picked ? styles.barDim : ""}`}
                  onClick={() => updateFilters({ agency: picked ? undefined : row.agency })}
                  aria-pressed={picked}
                >
                  <span className={styles.barLabel}>
                    <span className={styles.barName}>{thaiDigitsToArabic(row.agency)}</span>
                    <span className={styles.barStat}>
                      {row.torCount.toLocaleString("th-TH")} · {formatBudget(row.budgetSum)}
                    </span>
                  </span>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.barFill}
                      style={{
                        width: `${widestBudget === 0 ? 0 : (row.budgetSum / widestBudget) * 100}%`,
                        animationDelay: `${index * 70}ms`,
                      }}
                    />
                  </span>
                </button>
              );
            })}
          </div>

            <div className={styles.panelHead}><h2 className={styles.panelTitle}>แนวโน้มรายเดือน</h2><span className={styles.panelHint}>TOR และงบประมาณ</span></div>
            <div className={styles.trend}>{dashboard.trend.map((row) => <div key={row.month} className={styles.trendRow}><span>{row.month}</span><span>{row.torCount.toLocaleString("th-TH")} TOR</span><strong>{formatBudget(row.budgetSum)}</strong></div>)}</div>
          </section>
          <section className={styles.splitRight}>
            <div className={styles.panelHead}><h2 className={styles.panelTitle}>งบประมาณตามหมวดหมู่</h2><span className={styles.panelHint}>1 จุด = 1 TOR</span></div>
            <BudgetPlot points={dashboard.points} bounds={dashboard.bounds} category={filters.category} peerMinN={dashboard.rule.peerMinN} />
            <p className={styles.method}>ความผิดปกติทางสถิติใช้กลุ่มเปรียบเทียบตามหมวดหมู่และช่วงเวลา ไม่ใช่ข้อกล่าวหา <Link href="/methodology">ดูระเบียบวิธี</Link></p>
          </section>
        </div>
      </>}
    </main>
  );
}
