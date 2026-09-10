"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";
import { useViewer } from "../../shared/lib/viewer";

/**
 * The staff area's prototype empty state and chrome boundary.
 *
 * The sections themselves live in the app header, which swaps to the staff ones
 * inside /admin — one navigation bar rather than a second band under the first.
 *
 * This client-side viewer check is not, and never was, access control. The
 * server pages and every Server Action independently enforce the signed staff
 * session because both are directly reachable entry points.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { signedIn, ready } = useViewer();

  // The real sign-in screen must remain reachable before the prototype viewer
  // decoration has been populated by a successful staff sign-in.
  if (pathname === "/admin/login") return <>{children}</>;

  if (!ready) return null;

  if (!signedIn) {
    return (
      <main className={styles.adminGate}>
        <div className={styles.adminGateCard}>
          <div className={styles.adminGateKicker}>เฉพาะเจ้าหน้าที่</div>
          <h1 className={styles.adminGateTitle}>ส่วนผู้ดูแลระบบ</h1>
          <p className={styles.adminGateBody}>
            หน้านี้สำหรับเจ้าหน้าที่ที่ดูแลคุณภาพข้อมูลเท่านั้น — คิวตรวจสอบการสกัด บันทึกกิจกรรม
            และการอนุมัติเผยแพร่ กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าหน้าที่
          </p>
          <div className={styles.adminGateActions}>
            <Link href="/admin/login" className={styles.adminGatePrimary}>
              เข้าสู่ระบบ
            </Link>
            <Link href="/dashboard" className={styles.adminGateSecondary}>
              ← กลับหน้าสาธารณะ
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
