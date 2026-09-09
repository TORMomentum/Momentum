"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import styles from "../features/tor-detail/tor-detail.module.css";
import labels from "../shared/ui/labels.module.css";
import { formatBudgetFull, getTorBySlug } from "../data/tor-samples";

/**
 * TOR detail (FR-A/FR-B/FR-G). Ported from the "TOR Detail" screen of
 * mockups/TOR Radar App.dc.html. As on the Search screen, this app shell has
 * no logged-out state, so the mockup's "register to see your match" branch is
 * not modelled — the logged-in qualification/match view always renders.
 */
export function TorDetailView() {
  const params = useParams<{ id: string }>();
  const slug = params?.id ?? "";
  const [saved, setSaved] = useState(true);

  const tor = getTorBySlug(slug);

  if (!tor) {
    return (
      <main className={styles.detailPage}>
        <div className={styles.detailMain}>
          <Link href="/search" className={styles.backLink}>
            ← กลับไปผลการค้นหา
          </Link>
          <p className={styles.notFound}>ไม่พบ TOR รายการนี้ — อาจถูกลบหรือลิงก์ไม่ถูกต้อง</p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.detailPage}>
      <div className={styles.detailMain}>
        <Link href="/search" className={styles.backLink}>
          ← กลับไปผลการค้นหา
        </Link>

        <div className={styles.detailKicker}>
          {tor.id} ·{" "}
          <span className={tor.open ? styles.statusOpen : styles.statusClosed}>
            {tor.open ? "เปิดรับข้อเสนอ" : "ปิดรับแล้ว"}
          </span>{" "}
          · ประกาศ {tor.posted}
        </div>
        <h1 className={styles.detailTitle}>{tor.title}</h1>
        <div className={styles.detailAgency}>{tor.agency}</div>

        <div className={styles.factGrid}>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>งบประมาณ</div>
            <div className={`${styles.factValue} ${tor.anomaly ? styles.factValueAnomaly : ""}`}>
              {formatBudgetFull(tor.budget)}
            </div>
            <div className={styles.factNote}>{tor.priceNote}</div>
          </div>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>กำหนดยื่นซอง</div>
            <div className={styles.factValue}>{tor.deadline}</div>
            <div className={styles.factNote}>{tor.deadlineNote}</div>
          </div>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>หมวดหมู่</div>
            <div className={styles.factValueSmall}>{tor.cat}</div>
          </div>
          <div className={styles.factCell}>
            <div className={styles.factLabel}>ติดต่อ</div>
            <div className={styles.factValueSmall}>{tor.contact}</div>
            <div className={styles.factNote}>PII ถูกลดทอนตามนโยบาย</div>
          </div>
        </div>

        <div className={styles.scopeBlock}>
          <div className={labels.blockLabel}>ขอบเขตงาน — สรุปโดย AI</div>
          <p className={styles.scopeText}>{tor.scope}</p>
        </div>

        <div className={styles.qualsBlock}>
          <div className={labels.blockLabel}>คุณสมบัติผู้ยื่นข้อเสนอ</div>
          <div className={styles.qualsRow}>
            {tor.quals.map((qual) => (
              <span
                key={qual.text}
                className={`${styles.qualPill} ${qual.ok ? styles.qualPillOk : ""}`}
              >
                {qual.ok ? `✓ ${qual.text}` : qual.text}
              </span>
            ))}
          </div>
          <div className={styles.matchNote}>
            ✓ = ตรงกับโปรไฟล์ของคุณ ({tor.match != null ? `จับคู่ ${tor.match}%` : "ยังไม่มีคะแนน"})
          </div>
        </div>

        <div className={styles.provenance}>
          สกัดเมื่อ {tor.extractedAt} · ความเชื่อมั่น {tor.conf}
          <br />
          เนื้อหาสกัดโดย AI — ตรวจสอบกับเอกสารต้นฉบับเสมอ
        </div>
      </div>

      <div className={styles.detailSide}>
        <div className={styles.sideActions}>
          <span className={styles.openDocBtn}>เปิดเอกสารต้นฉบับ ↗</span>
          <button
            type="button"
            className={`${styles.saveBtn} ${saved ? styles.saveBtnOn : ""}`}
            onClick={() => setSaved((v) => !v)}
          >
            {saved ? "★ บันทึกแล้ว" : "☆ บันทึก"}
          </button>
        </div>

        <div className={`${labels.blockLabel} ${labels.blockLabelWide}`}>ตรวจคุณภาพข้อกำหนดด้วย AI</div>
        <div className={styles.qualityRow}>
          <span className={styles.qualityValue}>{tor.quality}</span>
          <span className={styles.qualityUnit}>/ 10 · คุณภาพข้อกำหนด</span>
        </div>
        <div className={styles.qualityCaption}>
          การตรวจความครบถ้วนของข้อกำหนดโดย AI — ไม่ใช่คำตัดสินทางกฎหมาย
        </div>

        <div className={styles.checksList}>
          {tor.checks.map((check) => (
            <div key={check.text} className={styles.checkRow}>
              <span className={check.level === "ok" ? styles.checkMarkOk : styles.checkMarkWarn}>
                {check.mark}
              </span>
              <span>{check.text}</span>
            </div>
          ))}
        </div>

        <div className={styles.docBlock}>
          <div className={`${labels.blockLabel} ${labels.blockLabelMid}`}>เอกสารต้นฉบับ</div>
          <div className={styles.docPreview}>
            <div className={styles.docPreviewText}>
              ตัวอย่างเอกสาร PDF
              <br />
              {tor.docRef}
            </div>
          </div>
          <div className={styles.docHash}>ยืนยันด้วย SHA-256 · เก็บถาวรไม่แก้ไข</div>
        </div>
      </div>
    </main>
  );
}
