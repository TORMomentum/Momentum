"use client";

import Link from "next/link";
import { useEffect } from "react";
import styles from "../src/features/app-shell/error.module.css";

/**
 * The error boundary for every route.
 *
 * It shows what a reader can do, never what went wrong internally: a stack
 * trace or a database message on a public page is an information leak, and it
 * helps nobody reading it. `digest` is the one identifier shown, because it is
 * what ties this screen to the server log entry.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The detail belongs in the log, not on the screen.
    console.error(error);
  }, [error]);

  return (
    <main className={styles.errorPage}>
      <div className={styles.errorCard}>
        <div className={`${styles.errorCode} ${styles.errorCodeWarn}`}>500</div>
        <h1 className={styles.errorTitle}>มีบางอย่างผิดพลาด</h1>
        <p className={styles.errorBody}>
          หน้านี้โหลดไม่สำเร็จ — ข้อมูลที่แสดงอยู่ก่อนหน้ายังปลอดภัยและไม่ถูกแก้ไข
          ลองใหม่อีกครั้ง หรือกลับไปหน้าอื่นก่อน
        </p>
        <div className={styles.errorActions}>
          <button type="button" onClick={reset} className={styles.errorPrimary}>
            ลองใหม่
          </button>
          <Link href="/dashboard" className={styles.errorSecondary}>
            ไปที่แดชบอร์ด
          </Link>
        </div>
        {error.digest && <div className={styles.errorDigest}>รหัสอ้างอิง: {error.digest}</div>}
      </div>
    </main>
  );
}
