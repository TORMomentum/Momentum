"use client";

import Link from "next/link";
import { useState } from "react";
import type { ChecklistSummary } from "@tor-radar/shared";
import { thaiDigitsToArabic } from "../../shared/lib/format";
import styles from "./dashboard.module.css";

/** Flagged TORs listed before "ดูทั้งหมด", as the agency list does. */
const FLAGGED_SHOWN = 10;

/**
 * FR-F-4: failed specification-quality checks beside the budgets flagged as a statistical anomaly,
 * over the same TORs the plot shows. A count is something to look into, never a verdict (NFR-F5).
 */
export function ChecklistSummaryPanel({ summary }: { summary: ChecklistSummary }) {
  const [allFlagged, setAllFlagged] = useState(false);
  if (summary.tors === 0) return null;
  const count = (value: number) => value.toLocaleString("th-TH");
  const flagged = allFlagged ? summary.flagged : summary.flagged.slice(0, FLAGGED_SHOWN);
  return (
    <section className={styles.checklist} aria-labelledby="dashboard-checklist-title">
      <div className={styles.panelHead}>
        <h2 id="dashboard-checklist-title" className={styles.panelTitle}>การตรวจคุณภาพข้อกำหนด</h2>
        <span className={styles.panelHint}>จาก TOR {count(summary.tors)} ฉบับในกราฟ</span>
      </div>
      <table className={styles.checklistTable}>
        <colgroup>
          <col />
          <col className={styles.checklistCount} />
          <col className={styles.checklistCount} />
          <col className={styles.checklistCount} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">ข้อตรวจ</th>
            <th scope="col">ผ่าน</th>
            <th scope="col">ไม่ผ่าน</th>
            <th scope="col">ยังไม่ประเมิน</th>
          </tr>
        </thead>
        <tbody>
          {summary.byCheck.map((row) => {
            // A check that ran on none of the TORs has no results to report, only its absence.
            const idle = row.notEvaluated === summary.tors;
            // Every TOR either passed the check, failed it, or was not evaluated on it.
            const passed = summary.tors - row.failed - row.notEvaluated;
            const cell = (value: number) => (idle ? "–" : count(value));
            return (
              <tr key={row.id} className={idle ? styles.checklistIdle : undefined}>
                <th scope="row">{row.label}</th>
                <td className={idle || passed === 0 ? styles.checklistZero : styles.checklistPassed}>{cell(passed)}</td>
                <td className={idle || row.failed === 0 ? styles.checklistZero : styles.checklistFailed}>{cell(row.failed)}</td>
                <td className={row.notEvaluated === 0 ? styles.checklistZero : undefined}>{count(row.notEvaluated)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {summary.flagged.length > 0 && (
        <div className={styles.flaggedList}>
          <h3 className={styles.flaggedTitle}>
            TOR ที่งบประมาณเป็นความผิดปกติทางสถิติ ({count(summary.flagged.length)}) — ข้อที่ไม่ผ่าน
          </h3>
          <ul>
            {flagged.map((tor) => (
              <li key={tor.id} className={styles.flaggedItem}>
                <Link href={`/tors/${tor.id}`} className={styles.flaggedName}>
                  {tor.title ? thaiDigitsToArabic(tor.title) : "ไม่ระบุชื่อโครงการ"}
                </Link>
                <span className={styles.flaggedBudget}>฿{tor.budget.toLocaleString("en-US")}</span>
                <span className={tor.failed.length > 0 ? styles.checklistFailed : styles.flaggedNone}>
                  {tor.failed.length > 0 ? `ไม่ผ่าน: ${tor.failed.map((check) => check.label).join(", ")}` : "ไม่มีข้ออื่นที่ไม่ผ่าน"}
                </span>
              </li>
            ))}
          </ul>
          {summary.flagged.length > FLAGGED_SHOWN && (
            <button type="button" className={`${styles.panelClear} ${styles.barsMore}`} onClick={() => setAllFlagged(!allFlagged)} aria-expanded={allFlagged}>
              {allFlagged ? `แสดงเฉพาะ ${FLAGGED_SHOWN} รายการแรก` : `ดูทั้งหมด (${count(summary.flagged.length)} รายการ)`}
            </button>
          )}
        </div>
      )}

      {/* FR-F-2: the notice travels with every result, in Thai first (NFR-F7); FR-F-3: the methodology link. */}
      <p className={styles.method}>
        การตรวจคุณภาพข้อกำหนดโดย AI — ไม่ใช่การวินิจฉัยทางกฎหมายหรือการทุจริต · AI-generated specification-quality check — not a legal or corruption judgment{" "}
        <Link href="/methodology">ดูวิธีการตรวจ</Link>
      </p>
    </section>
  );
}
