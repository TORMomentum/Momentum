import type { Completeness } from "./profile-completeness";
import styles from "./profile.module.css";

/**
 * The share of what matching reads that the vendor has given it, and what each missing item would add. Neutral
 * colour throughout: nothing here is an error (design 2026-11-25-completeness-and-persona §2 decision 4).
 */
export function CompletenessBar({ completeness }: { completeness: Completeness }) {
  const { percent, missing } = completeness;
  return (
    <section className={styles.completeness} aria-labelledby="completeness-title">
      <div className={styles.completenessHead}>
        <h2 id="completeness-title" className={styles.completenessTitle}>ข้อมูลที่ระบบใช้จับคู่ได้</h2>
        <span className={styles.completenessValue}>{percent}%</span>
      </div>
      <div
        className={styles.completenessTrack}
        role="progressbar"
        aria-labelledby="completeness-title"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className={styles.completenessFill} style={{ width: `${percent}%` }} />
      </div>
      {missing.length === 0 ? (
        <p className={styles.completenessDone}>ระบบใช้ข้อมูลของคุณได้ครบทุกส่วนแล้ว</p>
      ) : (
        <>
          <p className={styles.completenessNote}>ไม่บังคับ — คุณได้รับการแจ้งเตือนอยู่แล้ว ข้อมูลเหล่านี้ช่วยให้จับคู่แม่นขึ้น</p>
          <ul className={styles.completenessList}>
            {missing.map((item) => (
              <li key={item.key}>
                <a href={item.href} className={styles.completenessLink}>เพิ่ม{item.label}</a>
                <span className={styles.completenessAdds}> — {item.adds}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
