"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { BudgetPlot } from "../features/dashboard/BudgetPlot";
import { FilterDrop } from "../features/dashboard/FilterDrop";
import styles from "../features/dashboard/dashboard.module.css";
import type { DashboardPayload, TorState } from "../shared/api/stats.api";
import { formatBudgetShort, formatThaiMonth, thaiDigitsToArabic } from "../shared/lib/format";
import { serialiseDashboardFilters, UNKNOWN, type DashboardFilters } from "../shared/lib/dashboard-filters";

const ALL = "all";

/**
 * The same words the search results use for the same five states, so a reader
 * moving between the two screens is not asked to learn a second vocabulary.
 */
const STATE_LABELS: Record<TorState, string> = {
  open: "เปิดรับข้อเสนอ",
  "awaiting-invitation": "รอประกาศเชิญชวน",
  closed: "ปิดรับแล้ว",
  awarded: "ประกาศผู้ชนะแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

/**
 * Extraction can fail to read an agency, and a record whose month could not be
 * derived has nowhere to sit in time. Both are real and both must be NAMED: an
 * unlabelled row reads as a rendering fault, and silently dropping it would
 * leave the breakdown not adding up to the total above it.
 */
const UNKNOWN_AGENCY = "ไม่ระบุหน่วยงาน";
const UNKNOWN_MONTH = "ไม่ระบุเดือน";

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
  const anyFilter = Object.values(filters).some((value) => value !== undefined);
  // Unknown sorts first by string order, and a row with no name reads as a
  // fault when it leads the chart. It belongs at the end, with the others.
  const agencies = [...dashboard.byAgency].sort((left, right) =>
    left.agency === right.agency ? 0 : !left.agency ? 1 : !right.agency ? -1 : 0);
  // The widest bar is the scale, so one agency's share is readable against the
  // others rather than against an arbitrary ceiling.
  const widestBudget = agencies.reduce((widest, row) => Math.max(widest, row.budgetSum), 0);
  const widestMonth = dashboard.trend.reduce((widest, row) => Math.max(widest, row.budgetSum), 0);
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
          options={[{ value: ALL, label: "ทั้งหมด" }, ...agencies.map((agency) => ({ value: agency.agency, label: agency.agency ? thaiDigitsToArabic(agency.agency) : UNKNOWN_AGENCY, meta: String(agency.torCount) }))]}
        />
        <FilterDrop
          label="หมวดหมู่"
          value={filters.category ?? ALL}
          open={openDrop === "category"}
          onToggle={() => setOpenDrop(openDrop === "category" ? null : "category")}
          onPick={(category) => { updateFilters({ category: category === ALL ? undefined : category }); setOpenDrop(null); }}
          options={[{ value: ALL, label: "ทั้งหมด" }, ...categories.map((category) => ({ value: category, label: thaiDigitsToArabic(category) }))]}
        />
        {/* Four controls can be filtering at once — agency, category, state and
            month — and clicking each one back off is four actions. Shown only
            when something is actually filtered, so it is never a dead control. */}
        {anyFilter && (
          <button type="button" className={styles.clearFilters} onClick={() => router.push(pathname)}>
            ล้างตัวกรอง
          </button>
        )}
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

        {/* One line rather than a third full-width band: this is a filter, and
            it reads as one. The headline counts everything collected, including
            what closed last year; these say what can still be bid on, and
            clicking one narrows the page to it. */}
        <section className={styles.states} aria-label="สถานะของ TOR">
          {dashboard.byState.map((row) => {
            const picked = filters.state === row.state;
            return (
              <button
                type="button"
                key={row.state}
                className={`${styles.stateChip} ${row.state === "open" ? styles.stateChipOpen : ""} ${picked ? styles.stateChipOn : ""}`}
                onClick={() => updateFilters({ state: picked ? undefined : row.state })}
                aria-pressed={picked}
              >
                <span className={styles.stateChipKey}>{STATE_LABELS[row.state]}</span>
                <span className={styles.stateChipValue}>{row.torCount.toLocaleString("th-TH")}</span>
                <span className={styles.stateChipNote}>{formatBudgetShort(row.budgetSum)}</span>
              </button>
            );
          })}
        </section>

        <div className={styles.split}>
          <section className={styles.splitLeft}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>TOR ตามหน่วยงาน</h2>
            {/* The way out sits where the filter was set. The one at the top
                of the page is out of sight once a reader is down here. */}
            {filters.agency
              ? <button type="button" className={styles.panelClear} onClick={() => updateFilters({ agency: undefined })}>ล้างตัวกรองหน่วยงาน</button>
              : <span className={styles.panelHint}>คลิกแท่งเพื่อกรอง</span>}
          </div>
          <div className={styles.bars}>
            {/* Every agency stays on screen when one is picked; the rest fade.
                That is what makes the selected bar readable AS a comparison —
                dropping the other rows would leave a one-bar chart.

                Clicking writes the same `agency` filter the dropdown writes, so
                the two controls cannot disagree and the choice survives a
                reload or a shared link. */}
            {agencies.map((row, index) => {
              // An unreadable agency is still a row a reader may want to see on
              // its own, so it carries the sentinel rather than no value at all.
              const value = row.agency || UNKNOWN;
              const picked = filters.agency === value;
              return (
                <button
                  type="button"
                  key={value}
                  className={`${styles.bar} ${filters.agency && !picked ? styles.barDim : ""}`}
                  onClick={() => updateFilters({ agency: picked ? undefined : value })}
                  aria-pressed={picked}
                >
                  <span className={styles.barLabel}>
                    <span className={styles.barName}>{row.agency ? thaiDigitsToArabic(row.agency) : UNKNOWN_AGENCY}</span>
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

            <div className={`${styles.panelHead} ${styles.panelHeadStacked}`}><h2 className={styles.panelTitle}>แนวโน้มรายเดือน</h2>{filters.month
              ? <button type="button" className={styles.panelClear} onClick={() => updateFilters({ month: undefined })}>ล้างตัวกรองเดือน</button>
              : <span className={styles.panelHint}>คลิกเดือนเพื่อกรอง</span>}</div>
            {/* Drawn as bars for the same reason the agency chart is: a column of
                numbers is a table, and a trend is a shape. Scaled to the busiest
                month so the months are read against each other. */}
            <div className={styles.trend}>
              {[...dashboard.trend].sort((left, right) =>
                left.month === right.month ? 0 : !left.month ? 1 : !right.month ? -1 : 0).map((row) => (
                <button
                  type="button"
                  key={row.month || UNKNOWN}
                  className={`${styles.trendRow} ${filters.month && filters.month !== (row.month || UNKNOWN) ? styles.barDim : ""}`}
                  onClick={() => updateFilters({ month: filters.month === (row.month || UNKNOWN) ? undefined : (row.month || UNKNOWN) })}
                  aria-pressed={filters.month === (row.month || UNKNOWN)}
                >
                  <span className={styles.trendLabel}>
                    <span className={styles.trendMonth}>{row.month ? formatThaiMonth(row.month) : UNKNOWN_MONTH}</span>
                    <span className={styles.trendStat}>{row.torCount.toLocaleString("th-TH")} · {formatBudget(row.budgetSum)}</span>
                  </span>
                  <span className={styles.barTrack}>
                    <span className={styles.trendFill} style={{ width: `${widestMonth === 0 ? 0 : (row.budgetSum / widestMonth) * 100}%` }} />
                  </span>
                </button>
              ))}
            </div>
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
