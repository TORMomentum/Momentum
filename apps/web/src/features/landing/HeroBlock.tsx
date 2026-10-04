"use client";

import Link from "next/link";

import { formatBudgetShort, formatThaiDate } from "../../shared/lib/format";
import styles from "./landing.module.css";
import { budgetParts, editionOf, type LandingFigures } from "./landing.figures";
import { useCountUp } from "./useLandingMotion";
import { Reveal } from "./Reveal";

export function Hero({ figures }: { figures: LandingFigures | null }) {
  const edition = editionOf(figures?.lastIntakeAt ?? null);
  return (
    <section className={styles.hero}>
      <div className={styles.eyebrow}>
        {edition ? <>ฉบับ {edition} · </> : null}จัดซื้อจัดจ้างภาครัฐไทย ที่มองเห็นได้
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
        {figures ? (
          <>
            คลังข้อมูลปัจจุบัน · <span className={styles.liveDot}>●</span> TOR{" "}
            {figures.torCount.toLocaleString("en-US")} ฉบับ
            <br />
            อัปเดตข้อมูลล่าสุด {figures.lastIntakeAt ? formatThaiDate(figures.lastIntakeAt) : "ยังไม่มีข้อมูล"}
            <br />
            ครอบคลุมเฉพาะเอกสารที่ระบบรวบรวมได้
          </>
        ) : (
          <>ยังเชื่อมต่อข้อมูลไม่ได้ในขณะนี้</>
        )}
      </div>
    </section>
  );
}

const ANOMALY_LABEL = "ความผิดปกติทางสถิติ";

/** Headline figures on a loop. Duplicated once so the scroll never shows a gap. */
export function Marquee({ figures }: { figures: LandingFigures | null }) {
  if (!figures) return null;
  const items = [
    `นำเข้า TOR ${figures.torCount.toLocaleString("en-US")} ฉบับ`,
    `ติดตามงบประมาณ ${formatBudgetShort(figures.budgetSum)}`,
    `หน่วยงานรัฐ ${figures.agencyCount.toLocaleString("en-US")} แห่ง`,
    `${ANOMALY_LABEL} ${figures.anomalyCount ?? 0} รายการ`,
    "ข้อมูลจากประกาศ e-GP จริง",
  ];
  const run = [...items, ...items];

  return (
    <div className={styles.marquee}>
      <div className={styles.marqueeTrack}>
        {run.map((item, index) => (
          <span key={`${item}-${index}`}>
            <span className={item.startsWith(ANOMALY_LABEL) ? styles.marqueeFlag : undefined}>
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
  /** Null when the figure is unavailable: shown as a dash, never a guess. */
  value: number | null;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  note: string;
  flagged?: boolean;
}) {
  const counter = useCountUp(value ?? 0, decimals);
  return (
    <div className={`${styles.stat} ${flagged ? styles.statFlagged : ""}`}>
      <div className={styles.statKey}>{label}</div>
      <div className={styles.statValue}>
        {value === null ? (
          "—"
        ) : (
          <>
            {prefix}
            <span ref={counter.ref}>{counter.text}</span>
            {suffix}
          </>
        )}
      </div>
      <div className={styles.statNote}>{note}</div>
    </div>
  );
}

export function Stats({ figures }: { figures: LandingFigures | null }) {
  const budget = figures ? budgetParts(figures.budgetSum) : null;
  return (
    <section className={styles.section}>
      <Reveal className={styles.stats}>
        <Stat label="TOR ทั้งหมด" value={figures?.torCount ?? null} note="ฉบับ จากประกาศสาธารณะ" />
        <Stat
          label="งบประมาณรวม"
          value={budget?.value ?? null}
          decimals={budget?.decimals ?? 0}
          prefix="฿"
          suffix={budget?.suffix ?? ""}
          note="ตามงบประมาณที่ประกาศ"
        />
        <Stat label="หน่วยงาน" value={figures?.agencyCount ?? null} note="หน่วยงานในข้อมูลที่รวบรวมได้" />
        <Stat
          label={ANOMALY_LABEL}
          value={figures ? (figures.anomalyCount ?? 0) : null}
          note="เกณฑ์ 1.5×IQR — ไม่ใช่ข้อกล่าวหา"
          flagged
        />
      </Reveal>
    </section>
  );
}
