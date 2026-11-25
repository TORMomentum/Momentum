import styles from "../../../src/features/search/search.module.css";

export default function SearchLoading() {
  return (
    <main className={styles.searchPage} aria-busy="true" aria-label="กำลังโหลดรายการ TOR">
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
