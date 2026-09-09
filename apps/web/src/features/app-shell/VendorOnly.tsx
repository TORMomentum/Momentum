"use client";

import Link from "next/link";
import styles from "./app-shell.module.css";
import { useViewer } from "../../shared/lib/viewer";

/**
 * Wraps a screen that only means something for a signed-in vendor.
 *
 * This is NOT access control — nothing here is secret, and slice 4's
 * authentication is what will actually protect vendor data. It exists so a
 * signed-out reader who lands on a vendor route sees why the page is empty and
 * what an account gives them, rather than a broken screen.
 */
export function VendorOnly({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  const { signedIn, ready } = useViewer();

  // Nothing until the stored state has been read, so the page does not flash
  // the wrong branch on first paint.
  if (!ready) return null;
  if (signedIn) return <>{children}</>;

  return (
    <main className={styles.gatePage}>
      <div className={styles.gateCard}>
        <div className={styles.gateKicker}>สำหรับผู้ประกอบการที่เข้าสู่ระบบ</div>
        <h1 className={styles.gateTitle}>{title}</h1>
        <p className={styles.gateBody}>{body}</p>
        <div className={styles.gateActions}>
          <Link href="/login?mode=signup" className={styles.gatePrimary}>
            ลงทะเบียนฟรี
          </Link>
          <Link href="/login" className={styles.gateSecondary}>
            เข้าสู่ระบบ
          </Link>
        </div>
        <Link href="/dashboard" className={styles.gateEscape}>
          ← ดูแดชบอร์ดสาธารณะโดยไม่เข้าสู่ระบบ
        </Link>
      </div>
    </main>
  );
}
