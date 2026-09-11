"use client";

import { useEffect } from "react";
import styles from "../../src/features/app-shell/error.module.css";

/** Keeps the application header mounted while only the failed screen resets. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className={styles.errorPage}>
      <div className={styles.errorCard}>
        <div className={`${styles.errorCode} ${styles.errorCodeWarn}`}>500</div>
        <h1 className={styles.errorTitle}>เปิดหน้านี้ไม่สำเร็จ</h1>
        <p className={styles.errorBody}>
          ข้อมูลก่อนหน้ายังไม่ถูกแก้ไข ลองโหลดหน้านี้อีกครั้ง หรือใช้เมนูด้านบนเพื่อไปหน้าอื่น
        </p>
        <div className={styles.errorActions}>
          <button type="button" onClick={reset} className={styles.errorPrimary}>
            ลองใหม่
          </button>
        </div>
        {error.digest && <div className={styles.errorDigest}>รหัสอ้างอิง: {error.digest}</div>}
      </div>
    </main>
  );
}
