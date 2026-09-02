"use client";

import styles from "./landing.module.css";
import { useNavVisibility } from "./useLandingMotion.js";

/** Fixed header. Hides on the way down, returns on the way up. */
export function SiteNav() {
  const { hidden, scrolled } = useNavVisibility();
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
        <a href="#how">HOW IT WORKS</a>
        <a href="#data">DATA</a>
        <a href="#quality">QUALITY</a>
      </nav>
      <div className={styles.auth}>
        <button type="button" className={styles.signIn}>
          เข้าสู่ระบบ
        </button>
        <button type="button" className={`${styles.primary} ${styles.navCta}`}>
          ลงทะเบียนผู้ประกอบการ
        </button>
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
        PDPA-ALIGNED · PII MINIMIZED · TAKEDOWN WORKFLOW
        <br />
        ISSUE NO. 2569-08 · BUILT FOR TRANSPARENCY
      </div>
    </footer>
  );
}
