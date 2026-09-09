"use client";

import Link from "next/link";

import styles from "./landing.module.css";
import { useNavVisibility } from "./useLandingMotion";
import { AccountControls } from "../app-shell/AccountControls";
import { useViewer } from "../../shared/lib/viewer";

/** Fixed header. Hides on the way down, returns on the way up. */
export function SiteNav() {
  const { hidden, scrolled } = useNavVisibility();
  const { signedIn, ready } = useViewer();
  const className = [
    styles.nav,
    hidden ? styles.navHidden : "",
    scrolled ? styles.navScrolled : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <header className={className}>
      <div className={styles.wordmark}>TOR RADAR</div>
      <nav className={styles.navLinks}>
        <a href="#how">วิธีทำงาน</a>
        <a href="#data">ข้อมูล</a>
        <a href="#quality">คุณภาพ</a>
        {/* The way into the app belongs with the other navigation, not over
            with the account controls. It only appears once there is a session
            to go back to. */}
        {ready && signedIn && <Link href="/dashboard">แดชบอร์ด</Link>}
      </nav>
      <div className={styles.auth}>
        {/*
          Signed in, this header carries the same bell and account menu as the
          app shell instead of the two auth buttons — a reader who lands back
          on the public page is still signed in and should be able to see it.
          Nothing renders until the stored session has been read, so neither
          branch flashes.
        */}
        {ready && !signedIn && (
          <>
            <Link href="/login" className={styles.signIn}>
              เข้าสู่ระบบ
            </Link>
            <Link href="/login?mode=signup" className={`${styles.primary} ${styles.navCta}`}>
              ลงทะเบียนผู้ประกอบการ
            </Link>
          </>
        )}
        {ready && signedIn && <AccountControls />}
      </div>
    </header>
  );
}

/**
 * The figures on this page are placeholders until the pipeline fills them.
 * FR-E-6 requires the interface to say what its numbers cover; publishing
 * invented totals unlabelled would be the exact failure that requirement
 * exists to prevent.
 */
export function SampleDataNotice() {
  return (
    <p className={styles.sampleNotice}>
      ตัวอย่างข้อมูลเพื่อการออกแบบ · ยังไม่ได้เชื่อมต่อข้อมูลจริง — ตัวเลขทั้งหมดในหน้านี้เป็นข้อมูลสมมติ
    </p>
  );
}

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div>
        TOR RADAR · แพลตฟอร์มอิสระ ไม่ใช่หน่วยงานราชการ
        <br />
        ข้อมูลจากประกาศสาธารณะเท่านั้น · เนื้อหาสกัดโดย AI มีป้ายกำกับเสมอ
      </div>
      <div className={styles.footerRight}>
        สอดคล้องแนวทาง PDPA · ลดทอนข้อมูลส่วนบุคคล · มีขั้นตอนขอถอดถอน
        <br />
        ฉบับ 2569-08 · สร้างเพื่อความโปร่งใส
      </div>
    </footer>
  );
}
