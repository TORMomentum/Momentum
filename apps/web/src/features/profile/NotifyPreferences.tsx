"use client";
import { NOTIFY_MIN_MATCH } from "@tor-radar/shared";
import { BudgetRange } from "../../shared/ui/BudgetRange";

import { useState } from "react";
import styles from "./profile.module.css";

/**
 * How often, and how closely matched, a vendor wants to be emailed.
 *
 * Ported from the screen that came before the profile rebuild, which held all
 * of this in component state and saved none of it. It is a real preference now,
 * stored with the profile — but nothing is dispatched until matching exists and
 * has been measured (design §7.8), and the panel says so rather than implying
 * emails are already going out.
 */

export interface Notify {
  preset: "all" | "daily" | "high" | "off";
  minMatch: number;
  leadDays: number;
  deadlineReminder: boolean;
  anomalyAlert: boolean;
}

/** Each preset is a named position on the same minimum-match scale. */
const PRESETS: Array<{ key: Notify["preset"]; title: string; desc: string; minMatch: number }> = [
  {
    key: "all",
    title: "ทุกงานที่เกี่ยวข้อง",
    desc: "ส่งทุกครั้งที่มี TOR ตรงกับโปรไฟล์ตั้งแต่ 50% ขึ้นไป",
    minMatch: 50,
  },
  {
    key: "daily",
    title: "สรุปรายวัน (แนะนำ)",
    desc: "วันละครั้ง รวมงานที่ตรงตั้งแต่ 70% และเตือนก่อนหมดเขต",
    minMatch: 70,
  },
  {
    key: "high",
    title: "เฉพาะงานที่ตรงมาก",
    desc: "เฉพาะงานที่ตรงตั้งแต่ 85% ขึ้นไป",
    minMatch: 85,
  },
  // Every notification email has to offer a way out. Before this there was
  // none short of withdrawing consent entirely on the account page. The match
  // threshold is kept, so switching back on restores what was set before.
  {
    key: "off",
    title: "ปิดการแจ้งเตือนทางอีเมล",
    desc: "ไม่ส่งอีเมลใด ๆ รวมถึงการเตือนก่อนหมดเขต — ยังดูงานที่ตรงกับคุณได้ที่แดชบอร์ด",
    minMatch: 70,
  },
];

const LEAD_OPTIONS = [3, 7, 14];

export function NotifyPreferences({
  value,
  onChange,
}: {
  value: Notify;
  onChange: (next: Notify) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const set = (patch: Partial<Notify>) => onChange({ ...value, ...patch });

  return (
    <div>
      <div className={styles.presetList}>
        {PRESETS.map((preset) => {
          const on = value.preset === preset.key;
          return (
            <button
              type="button"
              key={preset.key}
              className={`${styles.presetCard} ${on ? styles.presetCardOn : ""}`}
              aria-pressed={on}
              // Picking a preset moves the threshold with it; the advanced panel
              // then fine-tunes from there.
              onClick={() =>
                set(preset.key === "off" ? { preset: "off" } : { preset: preset.key, minMatch: preset.minMatch })
              }
            >
              <span className={`${styles.presetDot} ${on ? styles.presetDotOn : ""}`} />
              <span>
                <span className={styles.presetTitle}>{preset.title}</span>
                <span className={styles.presetDesc}>{preset.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className={styles.advancedToggle}
        aria-expanded={advanced}
        onClick={() => setAdvanced((open) => !open)}
      >
        <span className={`${styles.advancedArrow} ${advanced ? styles.advancedArrowOpen : ""}`}>▾</span>
        <span className={styles.advancedLabel}>
          {advanced ? "ซ่อนการตั้งค่าขั้นสูง" : "การตั้งค่าขั้นสูง"}
        </span>
      </button>

      {advanced && (
        <div className={styles.advancedPanel}>
          <div>
            <div className={styles.advancedRow}>
              <span className={styles.advancedRowTitle}>คะแนนจับคู่ขั้นต่ำ</span>
              <span className={styles.advancedRowValue}>{value.minMatch}%</span>
            </div>
            {/* The same slider as budget and the search match filter, one handle:
                the fill runs from the threshold up, "this and better". */}
            <BudgetRange
              single
              unit="percent"
              tone="match"
              min={value.minMatch}
              max={NOTIFY_MIN_MATCH.ceiling}
              floor={NOTIFY_MIN_MATCH.floor}
              ceiling={NOTIFY_MIN_MATCH.ceiling}
              step={NOTIFY_MIN_MATCH.step}
              onChange={({ min }) => set({ minMatch: min })}
              minLabel="คะแนนจับคู่ขั้นต่ำ"
              floorLabel={`${NOTIFY_MIN_MATCH.floor}% (กว้าง)`}
              ceilingLabel={`${NOTIFY_MIN_MATCH.ceiling}% (เฉพาะที่ตรงมาก)`}
            />
          </div>

          <div>
            <div className={styles.leadGroupTitle}>เตือนก่อนกำหนดยื่นข้อเสนอ</div>
            <div className={styles.skillRow} role="group" aria-label="เตือนก่อนกำหนดยื่นข้อเสนอ">
              {LEAD_OPTIONS.map((days) => (
                <button
                  type="button"
                  key={days}
                  className={`${styles.skillPill} ${value.leadDays === days ? styles.skillPillOn : ""}`}
                  aria-pressed={value.leadDays === days}
                  onClick={() => set({ leadDays: days })}
                >
                  {days} วัน
                </button>
              ))}
            </div>
          </div>

          <label className={styles.extraRow}>
            <input
              type="checkbox"
              checked={value.deadlineReminder}
              onChange={(event) => set({ deadlineReminder: event.target.checked })}
            />
            <span>
              <span className={styles.extraLabel}>เตือน TOR ที่บันทึกไว้ใกล้หมดเขต</span>
              <span className={styles.extraNote}>ตามจำนวนวันที่เลือกด้านบน</span>
            </span>
          </label>

          <label className={styles.extraRow}>
            <input
              type="checkbox"
              checked={value.anomalyAlert}
              onChange={(event) => set({ anomalyAlert: event.target.checked })}
            />
            <span>
              <span className={styles.extraLabel}>เตือนเมื่อพบความผิดปกติทางสถิติ</span>
              {/* NFR-F5 constrains this wording: a statistical anomaly is not an
                  accusation, and the label must never read as one. */}
              <span className={styles.extraNote}>เป็นผลทางสถิติ ไม่ใช่ข้อกล่าวหา</span>
            </span>
          </label>
        </div>
      )}
    </div>
  );
}
