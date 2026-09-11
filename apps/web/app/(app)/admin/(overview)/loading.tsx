import styles from "../../../../src/features/admin/admin.module.css";

export default function AdminOverviewLoading() {
  return (
    <main className={styles.overviewPage} aria-busy="true" aria-label="กำลังโหลดภาพรวมงานผู้ดูแล">
      <span className={`${styles.skeletonBlock} ${styles.skeletonOverviewTitle}`} />
      <span className={`${styles.skeletonBlock} ${styles.skeletonOverviewLede}`} />
      <div className={styles.overviewGrid}>
        {Array.from({ length: 5 }, (_, index) => (
          <div className={styles.overviewCard} key={index}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonCardKey}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonCardValue}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonCardNote}`} />
          </div>
        ))}
      </div>
      <div className={styles.overviewSections}>
        {Array.from({ length: 2 }, (_, index) => (
          <div className={styles.overviewLink} key={index}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonOverviewLinkTitle}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonOverviewLinkBody}`} />
          </div>
        ))}
      </div>
    </main>
  );
}
