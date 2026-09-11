import styles from "../../../../src/features/admin/admin.module.css";

export default function AdminReviewLoading() {
  return (
    <main className={styles.adminPage} aria-busy="true" aria-label="กำลังโหลดคิวตรวจสอบ">
      <div className={styles.adminBar}>
        <span className={`${styles.skeletonBlock} ${styles.skeletonReviewTitle}`} />
        <span className={`${styles.skeletonBlock} ${styles.skeletonReviewMeta}`} />
      </div>
      <div className={styles.adminBody}>
        <aside className={styles.adminQueueList}>
          <div className={styles.skeletonQueueTools}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonQueueHeading}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonQueueSearch}`} />
          </div>
          {Array.from({ length: 5 }, (_, index) => (
            <div className={styles.skeletonQueueItem} key={index}>
              <span className={`${styles.skeletonBlock} ${styles.skeletonQueueIndex}`} />
              <div>
                <span className={`${styles.skeletonBlock} ${styles.skeletonQueueTitle}`} />
                <span className={`${styles.skeletonBlock} ${styles.skeletonQueueTrack}`} />
              </div>
            </div>
          ))}
        </aside>
        <section className={styles.adminDoc}>
          <div className={styles.adminDocToolbar}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonToolbarLine}`} />
            <span className={`${styles.skeletonBlock} ${styles.skeletonToolbarLineShort}`} />
          </div>
          <div className={styles.adminDocViewer}>
            <div className={styles.skeletonDocumentPane} />
          </div>
        </section>
        <section className={styles.adminFields}>
          <div className={styles.adminFieldsHeader}>
            <span className={`${styles.skeletonBlock} ${styles.skeletonFieldsHeading}`} />
          </div>
          <div className={styles.adminFieldList}>
            {Array.from({ length: 5 }, (_, index) => (
              <div className={styles.adminFieldRow} key={index}>
                <span className={`${styles.skeletonBlock} ${styles.skeletonFieldLabel}`} />
                <span className={`${styles.skeletonBlock} ${styles.skeletonFieldInput}`} />
                <span className={`${styles.skeletonBlock} ${styles.skeletonFieldNote}`} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
