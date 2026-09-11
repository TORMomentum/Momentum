import styles from "../../../src/features/dashboard/dashboard.module.css";

export default function DashboardLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="กำลังโหลดภาพรวม">
      <div className={styles.skeletonHead}>
        <span className={`${styles.skeletonBlock} ${styles.skeletonTitle}`} />
        <span className={`${styles.skeletonBlock} ${styles.skeletonCoverage}`} />
      </div>
      <div className={styles.skeletonFilters}>
        {Array.from({ length: 3 }, (_, index) => <span key={index} className={styles.skeletonChip} />)}
      </div>
      <div className={styles.stats}>
        {Array.from({ length: 4 }, (_, index) => (
          <div className={styles.stat} key={index}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonStatKey}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonStatValue}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonStatNote}`} />
          </div>
        ))}
      </div>
      <div className={styles.split}>
        <section className={styles.splitLeft}>
          <span className={`${styles.skeletonBlock} ${styles.skeletonPanelTitle}`} />
          <div className={styles.skeletonBars}>
            {Array.from({ length: 6 }, (_, index) => <span key={index} className={styles.skeletonBar} />)}
          </div>
        </section>
        <section className={styles.splitRight}>
          <span className={`${styles.skeletonBlock} ${styles.skeletonPanelTitle}`} />
          <div className={styles.skeletonPlot} />
        </section>
      </div>
    </main>
  );
}
