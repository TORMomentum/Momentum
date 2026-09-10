import Link from "next/link";
import styles from "../src/features/app-shell/error.module.css";

/**
 * 404. Shown for any URL this app does not serve — including a TOR reference
 * that does not exist, which is the case a reader is most likely to hit by
 * following an old link.
 *
 * Thai, like every other user-facing surface (NFR-F7), and it offers the two
 * routes that actually help: search, and the public dashboard.
 */
export default function NotFound() {
  return (
    <main className={styles.errorPage}>
      <div className={styles.errorCard}>
        <div className={styles.errorCode}>404</div>
        <h1 className={styles.errorTitle}>ไม่พบหน้าที่คุณเรียก</h1>
        <p className={styles.errorBody}>
          หน้านี้อาจถูกย้าย หรือลิงก์ที่ตามมาอาจพิมพ์ไม่ครบ — ถ้ากำลังหา TOR ฉบับใดฉบับหนึ่ง
          ลองค้นจากชื่อโครงการหรือหน่วยงานได้
        </p>
        <div className={styles.errorActions}>
          <Link href="/search" className={styles.errorPrimary}>
            ค้นหา TOR
          </Link>
          <Link href="/dashboard" className={styles.errorSecondary}>
            ไปที่แดชบอร์ด
          </Link>
        </div>
      </div>
    </main>
  );
}
