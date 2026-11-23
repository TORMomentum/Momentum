import styles from "../../../../src/features/admin/admin.module.css";

export default function AdminSourcesLoading() {
  return (
    <main className={styles.logPage} aria-busy="true" aria-label="กำลังโหลดสถานะแหล่งข้อมูล">
      <span className={`${styles.skeletonBlock} ${styles.skeletonOverviewTitle}`} />
      <span className={`${styles.skeletonBlock} ${styles.skeletonOverviewLede}`} />
      <div className={styles.skeletonLogTable}>
        <div className={styles.skeletonLogHead}>
          {Array.from({ length: 5 }, (_, index) => <span key={index} className={styles.skeletonBlock} />)}
        </div>
        {Array.from({ length: 3 }, (_, row) => (
          <div className={styles.skeletonLogRow} key={row}>
            {Array.from({ length: 5 }, (_, cell) => <span key={cell} className={styles.skeletonBlock} />)}
          </div>
        ))}
      </div>
    </main>
  );
}
