import Link from "next/link";
import styles from "../../../../src/features/admin/admin.module.css";
import { fetchEvents, AdminApiUnavailable } from "../../../../src/shared/lib/admin-api";

export const dynamic = "force-dynamic";

const STATE_LABELS: Record<string, string> = {
  queued: "เข้าคิว",
  extracting: "กำลังสกัด",
  published: "เผยแพร่",
  failed: "ไม่สำเร็จ",
  restricted: "จำกัดการเข้าถึง",
};

const SOURCE_LABELS: Record<string, string> = {
  upload: "อัปโหลด",
  url: "URL",
  api: "API",
  worker: "ตัวประมวลผล",
  admin: "ผู้ดูแล",
};

function label(value: string | null, table: Record<string, string>): string {
  if (!value) return "—";
  return table[value] ?? value;
}

/**
 * Every state change ever recorded (FR-E-5), newest first.
 *
 * This reads `tor_events`, which is the complete trail — the copy kept on each
 * record holds only the last few entries, for the detail screen.
 */
export default async function AdminLogPage() {
  let events: Awaited<ReturnType<typeof fetchEvents>> = [];
  let offline: string | null = null;

  try {
    events = await fetchEvents(100);
  } catch (error) {
    offline =
      error instanceof AdminApiUnavailable
        ? "ยังไม่ได้เชื่อมต่อกับ API — บันทึกกิจกรรมจะปรากฏเมื่อบริการทำงาน"
        : String(error);
  }

  return (
    <main className={styles.logPage}>
      <h1 className={styles.overviewTitle}>บันทึกกิจกรรม</h1>
      <p className={styles.overviewLede}>
        ทุกการเปลี่ยนสถานะของทุกระเบียน พร้อมผู้กระทำและเหตุผล — เก็บครบทุกรายการ ไม่ตัดทิ้ง
      </p>

      {offline && <div className={styles.overviewOffline}>{offline}</div>}

      {!offline && events.length === 0 && (
        <div className={styles.logEmpty}>ยังไม่มีกิจกรรม — จะปรากฏเมื่อมีเอกสารเข้าระบบ</div>
      )}

      {events.length > 0 && (
        <table className={styles.logTable}>
          <thead>
            <tr>
              <th>เวลา</th>
              <th>ระเบียน</th>
              <th>เปลี่ยนสถานะ</th>
              <th>โดย</th>
              <th>เหตุผล</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <tr key={`${event.torId}-${event.at}-${index}`}>
                <td className={styles.logWhen}>
                  {new Date(event.at).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
                </td>
                <td>
                  <Link href={`/admin/review?id=${event.torId}`}>{event.title || event.torId}</Link>
                </td>
                <td className={styles.logMove}>
                  {label(event.from, STATE_LABELS)} → {label(event.to, STATE_LABELS)}
                </td>
                <td className={styles.logActor}>
                  {event.actor} · {label(event.source, SOURCE_LABELS)}
                </td>
                <td className={styles.logReason}>{event.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
