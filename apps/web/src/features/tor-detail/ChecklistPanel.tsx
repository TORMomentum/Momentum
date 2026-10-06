import Link from "next/link";
import type { CheckResult, Checklist } from "@tor-radar/shared";
import styles from "./tor-detail.module.css";
import labels from "../../shared/ui/labels.module.css";

const RESULT_LABELS: Record<CheckResult, string> = {
  pass: "ผ่าน",
  fail: "ไม่ผ่าน",
  "not-evaluated": "ยังไม่ประเมิน",
};

const RESULT_CLASS: Record<CheckResult, string> = {
  pass: styles.checkPass,
  fail: styles.checkFail,
  "not-evaluated": styles.checkNone,
};

/** FR-F-1 to FR-F-3: the score, every reason, the required label, and the methodology link. */
export function ChecklistPanel({ checklist }: { checklist: Checklist }) {
  return (
    <section className={styles.checklistBlock} aria-labelledby="checklist-heading">
      <div id="checklist-heading" className={labels.blockLabel}>
        การตรวจคุณภาพข้อกำหนด
      </div>
      <div className={styles.checklistScore}>
        ผ่าน {checklist.passed} จาก {checklist.evaluated} ข้อที่ประเมินได้
      </div>
      <div className={styles.checklistNote}>
        AI-generated specification-quality check — not a legal or corruption judgment
      </div>
      <ul className={styles.checklistList}>
        {checklist.checks.map((check) => (
          <li key={check.id} className={styles.checklistItem}>
            <span className={`${styles.checkResult} ${RESULT_CLASS[check.result]}`}>{RESULT_LABELS[check.result]}</span>
            <div>
              <div className={styles.checkLabel}>
                {check.label}
              </div>
              <div className={styles.checkReason}>{check.reason}</div>
            </div>
          </li>
        ))}
      </ul>
      <Link href="/methodology" className={styles.sourceLink}>
        อ่านวิธีการตรวจ →
      </Link>
    </section>
  );
}
