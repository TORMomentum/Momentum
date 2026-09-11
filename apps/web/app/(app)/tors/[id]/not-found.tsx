import Link from "next/link";
import styles from "../../../../src/features/tor-detail/tor-detail.module.css";

export default function TorNotFound() {
  return (
    <main className={`${styles.detailPage} ${styles.notFoundPage}`}>
      <div className={styles.notFoundContent}>
        <div className={styles.notFoundCode}>404</div>
        <h1 className={styles.notFoundTitle}>ไม่พบ TOR รายการนี้</h1>
        <p className={styles.notFoundBody}>
          รายการอาจไม่อยู่ในระบบ หรือที่อยู่ที่เปิดมาไม่ถูกต้อง ลองค้นหาจากชื่อโครงการหรือหน่วยงานอีกครั้ง
        </p>
        <Link href="/search" className={styles.notFoundLink}>
          กลับไปค้นหา TOR
        </Link>
      </div>
    </main>
  );
}
