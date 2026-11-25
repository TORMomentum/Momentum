import Link from "next/link";
import styles from "./admin-sign-in.module.css";

/**
 * Where the staff area sends a reader it did not let in (TOR-199). There is no staff password to type any more:
 * an admin signs in with their own account at /login, and the staff area opens for that account's role.
 */
export function AdminSignInNotice({ signedInAs }: { signedInAs: string | null }) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.kicker}>เฉพาะผู้ดูแลระบบ</div>
        <h1 className={styles.title}>เข้าสู่ส่วนผู้ดูแลระบบ</h1>
        {signedInAs ? (
          <div className={styles.notice} role="status">
            ตอนนี้เข้าสู่ระบบอยู่ด้วยบัญชี <strong>{signedInAs}</strong> ซึ่งไม่ใช่บัญชีผู้ดูแลระบบ
            หากต้องการสิทธิ์ผู้ดูแล โปรดติดต่อผู้ดูแลระบบที่มีอยู่
          </div>
        ) : (
          <>
            <p className={styles.description}>
              เข้าสู่ระบบด้วยบัญชีของคุณ หากบัญชีได้รับสิทธิ์ผู้ดูแลระบบ จะเข้าส่วนนี้ได้ทันที
            </p>
            <Link className={styles.submit} href="/login">
              เข้าสู่ระบบ
            </Link>
          </>
        )}
        <Link className={styles.publicLink} href="/dashboard">
          ← กลับหน้าสาธารณะ
        </Link>
      </section>
    </main>
  );
}
