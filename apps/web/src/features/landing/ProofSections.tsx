"use client";

import styles from "./landing.module.css";
import { useCountUp, useReveal } from "./useLandingMotion";

const STEPS = [
  {
    key: "01 · INGEST",
    title: "รวบรวมทุกฟอร์แมต",
    body: "PDF, สแกน, ภาพถ่ายจากประกาศสาธารณะ — เก็บต้นฉบับถาวรแบบแก้ไขไม่ได้ พร้อมลิงก์กลับแหล่งที่มาเสมอ",
    foot: "UPLOAD · URL · API → SAME PIPELINE",
  },
  {
    key: "02 · EXTRACT",
    title: "AI สกัดโครงสร้าง",
    body: 'OCR ภาษาไทย + สกัดงบประมาณ ขอบเขต คุณสมบัติ กำหนดยื่นซอง — ทุกฟิลด์มีคะแนนความมั่นใจและป้าย "unverified" เมื่อไม่แน่ใจ',
    foot: "CONFIDENCE-TIERED · HUMAN REVIEW QUEUE",
  },
  {
    key: "03 · MATCH",
    title: "จับคู่และแจ้งเตือน",
    body: "โปรไฟล์ทักษะ × TOR ใหม่ — อีเมลถึงผู้ประกอบการภายใน 5 นาที พร้อมเหตุผลว่าทำไมงานนี้ถึงตรงกับคุณ",
    foot: "✉ MATCH 92% · TOP-3 SKILL REASONS",
    matched: true,
  },
] as const;

export function HowItWorks() {
  const reveal = useReveal<HTMLElement>();

  return (
    <section className={styles.section} id="how" ref={reveal} data-reveal>
      <div className={styles.headingRow}>
        <span className={styles.index}>01 — 03</span>
        <h2 className={styles.heading}>
          เอกสารกระจัดกระจาย
          <br />
          <span>→ ข้อมูลที่ใช้งานได้</span>
        </h2>
      </div>

      <div className={styles.steps}>
        {STEPS.map((step) => (
          <div className={styles.step} key={step.key}>
            <div className={styles.stepKey}>[ {step.key} ]</div>
            <div className={styles.stepTitle}>{step.title}</div>
            <p className={styles.stepBody}>{step.body}</p>
            <div
              className={`${styles.stepFoot} ${"matched" in step ? styles.stepFootMatched : ""}`}
            >
              {step.foot}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Budgets within one peer group. A flagged point means the figure sits outside
 * 1.5×IQR of comparable projects — a statistical statement, never an accusation
 * (NFR-F5).
 */
const CATEGORY_COLUMNS = [7, 32, 57, 82];
const SPREAD = [0.18, 0.31, 0.24, 0.12, 0.27, 0.2, 0.15, 0.34, 0.22, 0.29, 0.11, 0.25, 0.19, 0.3, 0.16, 0.26];

const PLOT_POINTS = SPREAD.map((height, index) => {
  const left = CATEGORY_COLUMNS[index % CATEGORY_COLUMNS.length] + ((index * 2.3) % 9);
  return {
    left: `${left}%`,
    bottom: `${height * 100}%`,
    flagged: false,
    tip: `฿${(1 + height * 12).toFixed(1)}M · ในช่วงปกติของกลุ่มเทียบ`,
  };
}).concat([
  {
    left: "14%",
    bottom: "68%",
    flagged: true,
    tip: "฿7.1M · สูงกว่ากลุ่มเทียบ 2.4×IQR — ความผิดปกติทางสถิติ",
  },
]);

const CATEGORIES = [
  { left: "5%", name: "ก่อสร้าง" },
  { left: "30%", name: "ชลประทาน" },
  { left: "55%", name: "ไอที/ซอฟต์แวร์" },
  { left: "80%", name: "จ้างเหมาบริการ" },
];

export function AnomalyPlot() {
  const reveal = useReveal<HTMLElement>();

  return (
    <section className={styles.section} id="data" ref={reveal} data-reveal>
      <div className={styles.plotHead}>
        <h2 className={styles.heading}>
          ราคาที่<em> โดดจากกลุ่ม</em>
          <br />
          มองเห็นได้ทันที
        </h2>
        <div className={styles.method}>
          เทียบภายในกลุ่ม (หมวด × ช่วงเวลา) · n ≥ 8
          <br />
          ธง = นอกช่วง 1.5×IQR · &quot;ความผิดปกติทางสถิติ&quot; ไม่ใช่ข้อกล่าวหา
        </div>
      </div>

      <div className={styles.plot}>
        <span className={styles.axisLabel} style={{ top: -5 }}>฿10M</span>
        <span className={styles.axisLabel} style={{ top: 165 }}>฿5M</span>
        <span className={styles.axisLabel} style={{ bottom: -5 }}>฿0</span>
        <div className={styles.gridLine} style={{ top: 170 }} />
        <div className={styles.gridLine} style={{ top: 85 }} />

        {PLOT_POINTS.map((point) => (
          <div
            key={`${point.left}-${point.bottom}`}
            className={`${styles.dot} ${point.flagged ? styles.dotFlagged : ""}`}
            style={{ left: point.left, bottom: point.bottom }}
            title={point.tip}
          />
        ))}

        <div
          className={styles.dotAnomaly}
          style={{ left: "58%", bottom: "80%" }}
          title="฿9,400,000 · สูงกว่ากลุ่มเทียบ 3.1×IQR"
        />
        <div className={styles.anomalyLabel} style={{ left: "61.5%", bottom: "86%" }}>
          [ ANOMALY ] ฿9.4M · 3.1×IQR เหนือกลุ่มเทียบ
        </div>

        {CATEGORIES.map((category) => (
          <div key={category.name} className={styles.categoryLabel} style={{ left: category.left }}>
            {category.name}
          </div>
        ))}
      </div>

      <div className={styles.plotFoot}>
        HOVER A DOT · 1 จุด = 1 TOR · ข้อมูลตัวอย่างจาก corpus นำร่อง
      </div>
    </section>
  );
}

export function QualityChecklist() {
  const reveal = useReveal<HTMLElement>();
  const score = useCountUp(8.5, 1);

  return (
    <section className={styles.section} id="quality" ref={reveal} data-reveal>
      <div className={styles.quality}>
        <div>
          <div className={styles.eyebrow}>[ AI QUALITY CHECKLIST ]</div>
          <h2 className={styles.heading}>
            TOR เขียนดีแค่ไหน
            <br />
            <span>AI ตรวจให้ก่อนตัดสินใจยื่น</span>
          </h2>
          <p className={styles.heroLede} style={{ maxWidth: 480, marginTop: 20 }}>
            เช็กลิสต์แบบอธิบายได้: งบประมาณระบุไหม กำหนดเวลาสมเหตุสมผลไหม ขอบเขตเฉพาะเจาะจงไหม —
            ทุกคะแนนมาพร้อมเหตุผลตามกฎ ไม่ใช่กล่องดำ และไม่ใช่คำตัดสินทางกฎหมาย
          </p>
        </div>

        <div className={styles.qualityCard}>
          <div className={styles.score}>
            <span className={styles.scoreValue} ref={score.ref}>
              {score.text}
            </span>
            <span className={styles.scoreOutOf}>/ 10 · SPEC QUALITY</span>
          </div>

          <div className={styles.checks}>
            <div className={styles.check}>
              <span className={styles.checkPass}>✓</span>
              <span>ระบุงบประมาณชัดเจน (฿4,850,000)</span>
            </div>
            <div className={styles.check}>
              <span className={styles.checkPass}>✓</span>
              <span>กำหนดยื่นซอง 14 วัน ≥ เกณฑ์ขั้นต่ำ</span>
            </div>
            <div className={styles.check}>
              <span className={styles.checkPass}>✓</span>
              <span>ขอบเขตงานระบุ deliverable 6 รายการ</span>
            </div>
            <div className={styles.check}>
              <span className={styles.checkWarn}>△</span>
              <span>คุณสมบัติ &quot;ทุนจดทะเบียน ≥ ฿1M&quot; ไม่มีเหตุผลประกอบ</span>
            </div>
          </div>

          <div className={styles.disclaimer}>
            AI-GENERATED SPECIFICATION-QUALITY CHECK
            <br />
            NOT A LEGAL OR CORRUPTION JUDGMENT
          </div>
        </div>
      </div>
    </section>
  );
}

export function Closing() {
  const reveal = useReveal<HTMLElement>();

  return (
    <section className={styles.closing} ref={reveal} data-reveal>
      <h2 className={styles.closingTitle}>
        งานที่ใช่ ไม่ควร
        <br />
        <em>หลุดมือ</em> อีกต่อไป
      </h2>
      <p className={styles.closingLede}>
        สร้างโปรไฟล์ทักษะครั้งเดียว — ให้ TOR ที่ตรงกับคุณวิ่งมาหาเอง ภายใน 5 นาทีหลังประกาศ
      </p>
      <div className={styles.closingActions}>
        <button type="button" className={`${styles.primary} ${styles.ctaLarge}`}>
          ลงทะเบียนฟรี
        </button>
        <a className={`${styles.secondary} ${styles.ctaLarge}`} href="#data">
          ดูแดชบอร์ดสาธารณะ
        </a>
      </div>
    </section>
  );
}
