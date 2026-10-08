"use client";

import Link from "next/link";
import { useState } from "react";
import { matchPercent } from "@tor-radar/shared";
import type { MatchLabel, MatchWorksheetItem } from "../../shared/lib/admin-api";
import { saveMatchLabelAction } from "./admin-accounts.actions";
import styles from "./admin.module.css";

const LABELS: Array<{ value: MatchLabel; text: string }> = [
  { value: "relevant", text: "✓ เกี่ยวข้อง" },
  { value: "not-relevant", text: "✗ ไม่เกี่ยวข้อง" },
  { value: "unsure", text: "? ไม่แน่ใจ" },
];

/**
 * One vendor's worksheet: the TORs email would send (judging precision) and a
 * fixed sample of their categories' TORs it would not (judging recall). Each
 * press is saved at once, so leaving half way loses nothing.
 */
export function MatchLabelSheet({ accountId, items }: { accountId: string; items: MatchWorksheetItem[] }) {
  const [labels, setLabels] = useState<Record<string, MatchLabel | null>>(() => Object.fromEntries(items.map((item) => [item.torId, item.label])));
  const [error, setError] = useState<string | null>(null);

  async function choose(torId: string, label: MatchLabel) {
    const previous = labels[torId] ?? null;
    setLabels((current) => ({ ...current, [torId]: label }));
    setError(null);
    const outcome = await saveMatchLabelAction(accountId, torId, label);
    if (!outcome.ok) {
      setLabels((current) => ({ ...current, [torId]: previous }));
      setError(outcome.reason);
    }
  }

  const done = items.filter((item) => labels[item.torId]).length;
  const groups = [
    { title: "อีเมลจะส่ง — ตรวจว่าถูกต้องไหม", rows: items.filter((item) => item.matched) },
    { title: "อีเมลจะไม่ส่ง — ตรวจว่ามีที่พลาดไปไหม", rows: items.filter((item) => !item.matched) },
  ];

  return (
    <>
      <p className={styles.torsCount}>ตรวจแล้ว {done} จาก {items.length} รายการ</p>
      {error && <div className={styles.adminToast} role="alert">{error}</div>}
      {groups.map((group) => (
        <section key={group.title} className={styles.termsSection}>
          <h2 className={styles.termsTitle}>{group.title}</h2>
          {group.rows.length === 0 ? (
            <div className={styles.logEmpty}>ไม่มีรายการในกลุ่มนี้</div>
          ) : (
            <ul className={styles.labelList}>
              {group.rows.map((item) => (
                <li key={item.torId} className={styles.labelRow}>
                  <span className={styles.labelScore}>{matchPercent(item.score)}%</span>
                  <div className={styles.labelBody}>
                    <Link href={`/tors/${item.torId}`} target="_blank" className={styles.labelTitle}>
                      {item.title || "ไม่พบชื่อโครงการ"}
                    </Link>
                    <div className={styles.labelMeta}>{item.agency || "ไม่ระบุหน่วยงาน"} · {item.reasons.slice(0, 2).join(" · ")}</div>
                  </div>
                  <div className={styles.labelChoices} role="group" aria-label={`ตัดสิน ${item.title}`}>
                    {LABELS.map((choice) => (
                      <button
                        type="button"
                        key={choice.value}
                        aria-pressed={labels[item.torId] === choice.value}
                        className={`${styles.labelChoice} ${labels[item.torId] === choice.value ? styles.labelChoiceOn : ""}`}
                        onClick={() => void choose(item.torId, choice.value)}
                      >
                        {choice.text}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
