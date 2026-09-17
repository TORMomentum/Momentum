"use client";

import { useCallback, useState } from "react";
import { fetchRecentUploadsAction, type RecentUpload } from "../features/admin/admin.actions";
import { stateLabel } from "../features/admin/labels";
import { UploadForm } from "../features/admin/UploadForm";
import styles from "../features/admin/admin.module.css";

/**
 * TOR-148 / Slice-1 Task 13. The list below the form is not decoration: it is
 * how a reviewer confirms a submission actually landed and, on a later look,
 * that the worker moved it past "queued" — the same activity trail the log
 * page reads, refreshed after every upload.
 */
export function UploadView({ initialUploads }: { initialUploads: RecentUpload[] }) {
  const [items, setItems] = useState(initialUploads);

  const refresh = useCallback(() => {
    fetchRecentUploadsAction()
      .then(setItems)
      .catch(() => {
        // The form's own error state already reports a failed upload; a
        // failed refresh of the recent-documents list is not worth a second
        // banner, so the list just keeps showing what it last had.
      });
  }, []);

  return (
    <main className={styles.uploadPage}>
      <div className={styles.uploadPageInner}>
        <h1 className={styles.overviewTitle}>อัปโหลดเอกสาร TOR</h1>
        <p className={styles.overviewLede}>
          นำเข้าเอกสารโดยตรง — ไฟล์จะถูกเก็บอย่างถาวรและเข้าสู่คิวประมวลผลอัตโนมัติ
        </p>

        <UploadForm onUploaded={refresh} />

        {items.length > 0 && (
          <section className={styles.uploadRecent}>
            <h2 className={styles.uploadRecentTitle}>เอกสารล่าสุด</h2>
            <ul className={styles.uploadRecentList}>
              {items.map((item) => (
                <li key={item.torId} className={styles.uploadRecentItem}>
                  <span className={styles.uploadRecentName}>{item.title || item.torId}</span>
                  <span className={styles.uploadRecentState}>{stateLabel(item.state)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
