"use client";

import Link from "next/link";

import styles from "./landing.module.css";
import { useCountUp } from "./useLandingMotion";
import { Reveal } from "./Reveal";

/** Placeholder figures. Replaced by the API in slice 3; see SampleDataNotice. */
const SAMPLE = {
  corpus: 487,
  budgetMillions: 1284,
  agencies: 128,
  anomalies: 12,
  lastUpdated: "12 ส.ค. 2569",
} as const;

export function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.eyebrow}>
        ฉบับ 2569-08 · จัดซื้อจัดจ้างภาครัฐไทย ที่มองเห็นได้
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
          <a className={styles.primary} href="/dashboard">
            สำรวจแดชบอร์ด →
          </a>
          <Link href="/login?mode=signup" className={styles.secondary}>
            รับการแจ้งเตือน TOR
          </Link>
        </div>
      </div>

      <div className={styles.scrollHint}>เลื่อนลงเพื่ออ่านต่อ ↓</div>
      <div className={styles.heroMeta}>
        คลังข้อมูลปัจจุบัน · <span className={styles.liveDot}>●</span> TOR {SAMPLE.corpus} ฉบับ
        <br />
        อัปเดตข้อมูลล่าสุด {SAMPLE.lastUpdated}
      </div>
    </section>
  );
}

/** Headline figures on a loop. Duplicated once so the scroll never shows a gap. */
export function Marquee() {
  const items = [
    `นำเข้า TOR ${SAMPLE.corpus} ฉบับ`,
    `ติดตามงบประมาณ ฿1.28B`,
    `หน่วยงานรัฐ ${SAMPLE.agencies} แห่ง`,
    `ความผิดปกติทางสถิติ ${SAMPLE.anomalies} รายการ`,
    "อีเมลจับคู่ภายใน 5 นาที",
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
  return (
    <section className={styles.section}>
      <Reveal className={styles.stats}>
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
      </Reveal>
    </section>
  );
}
