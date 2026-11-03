import Link from "next/link";
import styles from "./app-shell.module.css";

/**
 * The one control for moving between the site and the staff area, shown only
 * while a staff session is alive. A two-way switch rather than a single "go
 * back" link: it reads the same from both sides, and says which side you are on.
 *
 * Leaving the staff VIEW is not ending the staff SESSION — that lives in the
 * account menu, with the other sign-out.
 */
export function ModeToggle({ mode }: { mode: "site" | "admin" }) {
  return (
    <nav className={styles.modeToggle} aria-label="สลับมุมมอง">
      <Link href="/dashboard" className={`${styles.modeOption} ${mode === "site" ? styles.modeOptionOn : ""}`} aria-current={mode === "site" ? "page" : undefined}>
        มุมมองผู้ใช้
      </Link>
      <Link href="/admin" className={`${styles.modeOption} ${mode === "admin" ? styles.modeOptionOn : ""}`} aria-current={mode === "admin" ? "page" : undefined}>
        ผู้ดูแล
      </Link>
    </nav>
  );
}
