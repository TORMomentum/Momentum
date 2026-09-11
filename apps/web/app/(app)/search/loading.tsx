import styles from "../../../src/features/search/search.module.css";

export default function SearchLoading() {
  return (
    <main className={styles.searchPage} aria-busy="true" aria-label="กำลังโหลดรายการ TOR">
      <aside className={styles.sidebar}>
        <span className={`${styles.skeletonBlock} ${styles.skeletonSidebarTitle}`} />
        {Array.from({ length: 4 }, (_, group) => (
          <div className={styles.skeletonFilterGroup} key={group}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonFilterTitle}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonFilterLine}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonFilterLineShort}`} />
          </div>
        ))}
      </aside>
      <section className={styles.results}>
        <span className={`${styles.skeletonBlock} ${styles.skeletonSearchInput}`} />
        <div className={styles.resultList}>
          {Array.from({ length: 5 }, (_, index) => (
            <div className={styles.skeletonResultRow} key={index}>
              <div>
                <span className={`${styles.skeletonBlock} ${styles.skeletonBadge}`} />
                <span className={`${styles.skeletonBlock} ${styles.skeletonResultTitle}`} />
                <span className={`${styles.skeletonBlock} ${styles.skeletonResultMeta}`} />
              </div>
              <span className={`${styles.skeletonBlock} ${styles.skeletonResultValue}`} />
              <span className={`${styles.skeletonBlock} ${styles.skeletonResultValue}`} />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
