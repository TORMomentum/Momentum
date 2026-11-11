import Link from "next/link";
import styles from "./path.module.css";

/** The way into the company path from the profile screen. */
export function PathLink() {
  return (
    <p className={styles.entry}>
      อยากขยายไปสาขางานใหม่? <Link href="/profile/path">ดูว่าต้องเตรียมอะไรเพิ่ม</Link>
    </p>
  );
}
