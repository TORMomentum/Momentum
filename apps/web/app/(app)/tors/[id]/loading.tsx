import styles from "../../../../src/features/tor-detail/tor-detail.module.css";

/**
 * The TOR detail page was the one public screen with no loading state, so a
 * reader opening a record saw the previous page until the whole document had
 * loaded. The skeleton classes were already written for it; only the file that
 * uses them was missing.
 *
 * It follows the loaded page's own two-column reading order, so nothing moves
 * when the real content replaces it.
 */
export default function TorDetailLoading() {
  return (
    <main className={styles.detailPage} aria-busy="true" aria-label="กำลังโหลดรายละเอียด TOR">
      <section className={styles.detailMain}>
        <span className={`${styles.skeletonBlock} ${styles.skeletonBack}`} />
        <span className={`${styles.skeletonBlock} ${styles.skeletonKicker}`} />
        <span className={`${styles.skeletonBlock} ${styles.skeletonTitle}`} />
        <span className={`${styles.skeletonBlock} ${styles.skeletonAgency}`} />

        <div className={styles.factGrid}>
          {Array.from({ length: 4 }, (_, index) => (
            <div className={styles.factCell} key={index}>
              <span className={`${styles.skeletonBlock} ${styles.skeletonFactLabel}`} />
              <span className={`${styles.skeletonBlock} ${styles.skeletonFactValue}`} />
              <span className={`${styles.skeletonBlock} ${styles.skeletonFactNote}`} />
            </div>
          ))}
        </div>

        {Array.from({ length: 2 }, (_, section) => (
          <div className={styles.skeletonSection} key={section}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonSectionLabel}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonText}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonText}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonTextShort}`} />
          </div>
        ))}
      </section>

      <aside className={styles.detailSide}>
        <span className={`${styles.skeletonBlock} ${styles.skeletonAction}`} />
        <span className={`${styles.skeletonBlock} ${styles.skeletonSideLabel}`} />
        <span className={`${styles.skeletonBlock} ${styles.skeletonScore}`} />
        {Array.from({ length: 4 }, (_, index) => (
          <span className={`${styles.skeletonBlock} ${styles.skeletonCheck}`} key={index} />
        ))}
        <span className={styles.skeletonDocument} />
      </aside>
    </main>
  );
}
