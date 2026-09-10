"use client";

import Link from "next/link";
import styles from "./admin.module.css";
import { useViewer } from "../../shared/lib/viewer";

/**
 * The staff area's gate.
 *
 * The sections themselves live in the app header, which swaps to the staff ones
 * inside /admin — one navigation bar rather than a second band under the first.
 *
 * The gate here is NOT access control — the API is what refuses an unauthorised
 * request, and it does so on every admin route with a key today and a staff
 * session in slice 4. This only stops a signed-out browser from landing on a
 * screen of empty panels, and says why.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const { signedIn, ready } = useViewer();

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
            <Link href="/login" className={styles.adminGatePrimary}>
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
