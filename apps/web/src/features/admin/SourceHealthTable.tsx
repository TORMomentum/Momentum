import type { AdminSource, AdminSources } from "../../shared/lib/admin-api";
import { formatThaiDateTime } from "../../shared/lib/format";
import styles from "./admin.module.css";

const STATUS: Record<AdminSource["status"], { label: string; className: string | undefined }> = {
  ok: { label: "ปกติ", className: styles.sourceOk },
  failing: { label: "ล้มเหลวต่อเนื่อง", className: styles.sourceFailing },
  stale: { label: "ไม่ได้อัปเดตเกินกำหนด", className: styles.sourceStale },
  never: { label: "ยังไม่เคยทำงาน", className: styles.sourceNever },
};

const KIND: Record<AdminSource["kind"], string> = {
  automatic: "ทำงานอัตโนมัติ",
  manual: "รันด้วยมือ",
};

const when = (iso: string | null) => (iso ? formatThaiDateTime(iso) : "—");

/**
 * Every collecting source with its health (TOR-87, FR-A-4): last success, last failure and why, failures in a
 * row, the last run, and what it has given us. The thresholds are stated under the table.
 */
export function SourceHealthTable({ data }: { data: AdminSources }) {
  return (
    <>
      <div className={styles.sourceTableWrap}>
        <table className={styles.logTable}>
          <thead>
            <tr>
              <th>แหล่งข้อมูล</th>
              <th>สถานะ</th>
              <th>สำเร็จล่าสุด</th>
              <th>ล้มเหลวล่าสุด</th>
              <th>ล้มเหลวติดกัน</th>
              <th>รอบล่าสุด</th>
              <th>ระเบียนที่ได้</th>
            </tr>
          </thead>
          <tbody>
            {data.sources.map((source) => {
              const status = STATUS[source.status];
              return (
                <tr key={source.id} data-source={source.id}>
                  <td>
                    <span className={styles.sourceName}>{source.name}</span>
                    <span className={styles.sourceKind}>{KIND[source.kind]}</span>
                  </td>
                  <td>
                    <span className={`${styles.sourceStatus} ${status.className ?? ""}`}>{status.label}</span>
                    {source.alertSentAt && <span className={styles.sourceKind}>แจ้งผู้ดูแลแล้ว {when(source.alertSentAt)}</span>}
                  </td>
                  <td className={styles.logWhen}>{when(source.lastSuccessAt)}</td>
                  <td className={styles.logWhen}>
                    {when(source.lastFailureAt)}
                    {source.lastFailureAt && source.lastError && <span className={styles.sourceError}>{source.lastError}</span>}
                  </td>
                  <td>{source.consecutiveFailures}</td>
                  <td className={styles.logWhen}>
                    {source.lastRun
                      ? `${when(source.lastRun.at)} · ${source.lastRun.items.toLocaleString("th-TH")} โครงการ${source.lastRun.failed ? `, ล้มเหลว ${source.lastRun.failed.toLocaleString("th-TH")}` : ""}`
                      : "—"}
                  </td>
                  <td>
                    {source.records.toLocaleString("th-TH")}
                    {source.latestRecordAt && <span className={styles.sourceKind}>ล่าสุด {when(source.latestRecordAt)}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={styles.sourceNote}>
        แหล่งที่ทำงานอัตโนมัติถือว่าล้มเหลวต่อเนื่องเมื่อล้มเหลวติดกัน {data.settings.alertFailures} รอบ และไม่ได้อัปเดตเกินกำหนดเมื่อไม่มีสัญญาณเกิน{" "}
        {data.settings.staleHours} ชั่วโมง — ระบบส่งอีเมลแจ้งผู้ดูแลทุกคนครั้งเดียวเมื่อเกิดปัญหา และอีกครั้งเมื่อกลับมาปกติ
        แหล่งที่รันด้วยมือแสดงผลของการรันครั้งล่าสุด ไม่มีกำหนดเวลาจึงไม่นับว่าเกินกำหนด · ตรวจเมื่อ {when(data.checkedAt)}
      </p>
    </>
  );
}
