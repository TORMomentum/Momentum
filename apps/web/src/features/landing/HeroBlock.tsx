"use client";

import styles from "./landing.module.css";
import { useCountUp, useReveal } from "./useLandingMotion";

/** Placeholder figures. Replaced by the API in slice 3; see SampleDataNotice. */
const SAMPLE = {
  corpus: 487,
  budgetMillions: 1284,
  agencies: 128,
  anomalies: 12,
  lastUpdated: "12 AUG 2026",
} as const;

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.eyebrow}>
        ISSUE NO. 2569-08 · THAI PUBLIC PROCUREMENT, MADE VISIBLE
      </div>

      <h1 className={styles.heroTitle}>
        การจัดซื้อภาครัฐ
        <br />
        <em>มองเห็นได้</em>
        <br />
        ตรวจสอบได้
      </h1>

      <div className={styles.heroBody}>
        <p className={styles.heroLede}>
          แพลตฟอร์มรวม TOR จากประกาศจัดซื้อจัดจ้างภาครัฐ — สกัดข้อมูลด้วย AI
          จับคู่ให้ผู้ประกอบการตามทักษะ และเปิดข้อมูลราคาให้ประชาชนตรวจสอบ
        </p>
        <div className={styles.heroActions}>
          <a className={styles.primary} href="#data">
            สำรวจแดชบอร์ด →
          </a>
          <button type="button" className={styles.secondary}>
            รับการแจ้งเตือน TOR
          </button>
        </div>
      </div>

      <div className={styles.scrollHint}>SCROLL TO CONTINUE ↓</div>
      <div className={styles.heroMeta}>
        LIVE CORPUS · <span className={styles.liveDot}>●</span> {SAMPLE.corpus} TORs
        <br />
        DATA LAST UPDATED {SAMPLE.lastUpdated}
      </div>
    </section>
  );
}

/** Headline figures on a loop. Duplicated once so the scroll never shows a gap. */
export function Marquee() {
  const items = [
    `${SAMPLE.corpus} TOR INGESTED`,
    `฿1.28B TRACKED`,
    `${SAMPLE.agencies} GOV AGENCIES`,
    `${SAMPLE.anomalies} STATISTICAL ANOMALIES`,
    "EMAIL MATCH ≤ 5 MIN",
  ];
  const run = [...items, ...items];

  return (
    <div className={styles.marquee}>
      <div className={styles.marqueeTrack}>
        {run.map((item, index) => (
          <span key={`${item}-${index}`}>
            <span className={item.includes("ANOMALIES") ? styles.marqueeFlag : undefined}>
              {item}
            </span>
            <span aria-hidden="true"> ◆</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  note,
  flagged = false,
}: {
  label: string;
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  note: string;
  flagged?: boolean;
}) {
  const counter = useCountUp(value, decimals);
  return (
    <div className={`${styles.stat} ${flagged ? styles.statFlagged : ""}`}>
      <div className={styles.statKey}>[ {label} ]</div>
      <div className={styles.statValue}>
        {prefix}
        <span ref={counter.ref}>{counter.text}</span>
        {suffix}
      </div>
      <div className={styles.statNote}>{note}</div>
    </div>
  );
}

export function Stats() {
  const reveal = useReveal<HTMLElement>();

  return (
    <section className={styles.section} ref={reveal} data-reveal>
      <div className={styles.stats}>
        <Stat label="TOR ทั้งหมด" value={SAMPLE.corpus} note="ฉบับ จากประกาศสาธารณะ" />
        <Stat
          label="งบประมาณรวม"
          value={SAMPLE.budgetMillions}
          prefix="฿"
          suffix="M"
          note="ตามราคากลางที่ประกาศ"
        />
        <Stat label="หน่วยงาน" value={SAMPLE.agencies} note="หน่วยงานรัฐทั่วประเทศ" />
        <Stat
          label="ความผิดปกติทางสถิติ"
          value={SAMPLE.anomalies}
          note="เกณฑ์ 1.5×IQR — ไม่ใช่ข้อกล่าวหา"
          flagged
        />
      </div>
    </section>
  );
}
