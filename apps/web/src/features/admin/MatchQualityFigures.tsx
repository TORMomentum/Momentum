import type { MatchQualityFigures as Figures } from "../../shared/lib/admin-api";
import styles from "./admin.module.css";

const percent = (value: number | null) => (value === null ? "—" : `${Math.round(value * 100)}%`);

/**
 * The benchmark's three figures (design §7.8), each with the count it rests
 * on: a precision of 100% from two labels says little, and the screen must
 * not let it look like more.
 */
export function MatchQualityFigures({ figures }: { figures: Figures }) {
  return (
    <div className={styles.overviewGrid}>
      <div className={styles.overviewCard}>
        <div className={styles.overviewCardKey}>ความแม่นยำ</div>
        <div className={styles.overviewCardValue}>{percent(figures.precision)}</div>
        <div className={styles.overviewCardNote}>ที่อีเมลจะส่ง ถูกตัดสินว่าเกี่ยวข้อง · จาก {figures.precisionOf} รายการ</div>
      </div>
      <div className={styles.overviewCard}>
        <div className={styles.overviewCardKey}>ความครอบคลุม</div>
        <div className={styles.overviewCardValue}>{percent(figures.recall)}</div>
        <div className={styles.overviewCardNote}>ที่เกี่ยวข้อง อีเมลส่งถึง · ประมาณจากตัวอย่าง {figures.recallOf} รายการ</div>
      </div>
      <div className={styles.overviewCard}>
        <div className={styles.overviewCardKey}>ไม่แน่ใจ</div>
        <div className={styles.overviewCardValue}>{percent(figures.unsureRate)}</div>
        <div className={styles.overviewCardNote}>ตรวจแล้ว {figures.labelled} คู่ จาก {figures.vendors} ผู้ใช้</div>
      </div>
    </div>
  );
}
