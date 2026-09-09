"use client";

import { useState } from "react";
import Link from "next/link";
import labels from "../shared/ui/labels.module.css";
import styles from "../features/admin/admin.module.css";

type AdminField = { label: string; conf: string; value: string; ok: boolean };

type QueueItem = {
  conf: string;
  flag: string;
  title: string;
  src: string;
  docType: string;
  docRef: string;
  docNote: string;
  fields: AdminField[];
};

/** The default toast shown for a freshly-selected queue item — matches the
 * mockup's initial `adminToast` state and its `pick` handler. */
const DEFAULT_TOAST = "การแก้ไขถูกเก็บเป็น few-shot example ให้ extractor (FR-G2)";

const APPROVE_TOAST = "✓ อนุมัติแล้ว — ล้างแท็ก unverified และเผยแพร่สู่หน้าค้นหา · บันทึกเป็น few-shot example";
const REEXTRACT_TOAST = "↻ ส่งกลับเข้าคิวสกัดใหม่ด้วย prompt เฉพาะฟิลด์ที่ขาด";
const REJECT_TOAST = "✕ ปฏิเสธ — เอกสารถูกทำเครื่องหมายว่าไม่ใช่ TOR ที่เกี่ยวข้อง";

/** Records below the low-confidence threshold (T_LOW) or flagged by a sanity
 * check — sample size only, matching the mockup's "UNVERIFIED (NOT QUEUED)
 * 34" figure (records that stayed below-threshold and unverified without
 * tripping a sanity check, so they never entered this queue). */
const UNVERIFIED_NOT_QUEUED = 34;

const QUEUE: QueueItem[] = [
  {
    conf: "0.31",
    flag: "ขาดงบประมาณ",
    title: "จ้างเหมาปรับปรุงอาคารเรียน โรงเรียนบ้านหนองแวง",
    src: "ภาพถ่ายเอกสาร · นำเข้า 09:12",
    docType: "ภาพสแกน · JPG",
    docRef: "ประกาศ สพฐ. เขตพื้นที่ 3",
    docNote: "ถ่ายด้วยโทรศัพท์ · เอียง 4° · เงาบางส่วน",
    fields: [
      { label: "ชื่อโครงการ", conf: "0.91", value: "จ้างเหมาปรับปรุงอาคารเรียน โรงเรียนบ้านหนองแวง", ok: true },
      { label: "หน่วยงาน", conf: "0.88", value: "สพฐ. เขตพื้นที่การศึกษาประถมศึกษา 3", ok: true },
      { label: "งบประมาณ (฿) — ขาดหาย", conf: "0.12", value: "OCR อ่านไม่ได้ — ดูหน้า 2 ย่อหน้า 3", ok: false },
      { label: "กำหนดยื่นซอง", conf: "0.54", value: "29 ส.ค. 2569", ok: false },
      { label: "หมวดหมู่", conf: "0.83", value: "ก่อสร้าง / ปรับปรุงอาคาร", ok: true },
    ],
  },
  {
    conf: "0.28",
    flag: "วันที่ไม่สมเหตุสมผล",
    title: "ซื้อครุภัณฑ์คอมพิวเตอร์ 45 เครื่อง สำนักงานจังหวัดลำปาง",
    src: "สแกน PDF · นำเข้า 08:47",
    docType: "SCANNED PDF · 4 หน้า",
    docRef: "ประกาศสำนักงานจังหวัดลำปาง",
    docNote: "กำหนดยื่นซองก่อนวันประกาศ — ติด sanity check",
    fields: [
      { label: "ชื่อโครงการ", conf: "0.89", value: "ซื้อครุภัณฑ์คอมพิวเตอร์ 45 เครื่อง", ok: true },
      { label: "หน่วยงาน", conf: "0.92", value: "สำนักงานจังหวัดลำปาง", ok: true },
      { label: "งบประมาณ (฿)", conf: "0.86", value: "1,350,000", ok: true },
      { label: "กำหนดยื่นซอง — ไม่สมเหตุสมผล", conf: "0.19", value: "2 ส.ค. 2569 (ก่อนวันประกาศ)", ok: false },
      { label: "หมวดหมู่", conf: "0.81", value: "ไอที/ซอฟต์แวร์ · ครุภัณฑ์", ok: true },
    ],
  },
  {
    conf: "0.35",
    flag: "งบ ฿0 (ไม่สมเหตุสมผล)",
    title: "จ้างเหมาดูแลสวนสาธารณะ เทศบาลเมืองอุดรธานี ปีงบ 2570",
    src: "ภาพถ่ายเอกสาร · นำเข้า 08:15",
    docType: "ภาพสแกน · PNG",
    docRef: "ประกาศเทศบาลเมืองอุดรธานี",
    docNote: "ตัวเลขงบประมาณอ่านได้ ฿0 — ติด sanity check",
    fields: [
      { label: "ชื่อโครงการ", conf: "0.87", value: "จ้างเหมาดูแลสวนสาธารณะ ปีงบ 2570", ok: true },
      { label: "หน่วยงาน", conf: "0.9", value: "เทศบาลเมืองอุดรธานี", ok: true },
      { label: "งบประมาณ (฿) — ไม่น่าเป็นไปได้", conf: "0.15", value: "0", ok: false },
      { label: "กำหนดยื่นซอง", conf: "0.72", value: "3 ก.ย. 2569", ok: true },
      { label: "หมวดหมู่", conf: "0.79", value: "จ้างเหมาบริการ", ok: true },
    ],
  },
  {
    conf: "0.38",
    flag: "ไม่พบหน่วยงานในบัญชีกลาง",
    title: "จ้างก่อสร้างถนน อบต.บางพลี — รอยืนยันหน่วยงาน",
    src: "URL · นำเข้า 07:58",
    docType: "ไฟล์ HTML ต้นทาง",
    docRef: "ประกาศจาก URL ภายนอก",
    docNote: "ชื่อหน่วยงานไม่ตรงบัญชีกลาง — รอยืนยัน",
    fields: [
      { label: "ชื่อโครงการ", conf: "0.84", value: "จ้างก่อสร้างถนน คสล. หมู่ 4", ok: true },
      { label: "หน่วยงาน — ไม่พบในบัญชีกลาง", conf: "0.22", value: "อบต.บางพลี", ok: false },
      { label: "งบประมาณ (฿)", conf: "0.9", value: "2,780,000", ok: true },
      { label: "กำหนดยื่นซอง", conf: "0.85", value: "27 ส.ค. 2569", ok: true },
      { label: "หมวดหมู่", conf: "0.88", value: "ก่อสร้าง", ok: true },
    ],
  },
];

/**
 * Admin Review Queue (FR-B-3/FR-G-1) — staff-only. Ported from the "Admin
 * Review Queue" screen of mockups/TOR Radar App.dc.html. Records land here
 * when extraction confidence is below T_LOW or a sanity check trips;
 * medium-confidence records publish tagged "unverified extraction" without
 * reaching this queue at all (see CLAUDE.md's two-tier review policy).
 */
export function AdminReviewView() {
  const [qIdx, setQIdx] = useState(0);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [toast, setToast] = useState(DEFAULT_TOAST);

  const current = QUEUE[qIdx];

  function valueFor(fieldIdx: number, field: AdminField) {
    const key = `${qIdx}:${fieldIdx}`;
    return edits[key] ?? field.value;
  }

  function editField(fieldIdx: number, value: string) {
    setEdits((prev) => ({ ...prev, [`${qIdx}:${fieldIdx}`]: value }));
  }

  return (
    <main className={styles.adminPage}>
      <div className={styles.adminBar}>
        <h1 className={styles.adminTitle}>คิวตรวจสอบการสกัดข้อมูล</h1>
        <span className={styles.adminMeta}>
          ในคิว {QUEUE.length} · ยังไม่ยืนยันและไม่เข้าคิว {UNVERIFIED_NOT_QUEUED} · เข้าคิวเมื่อความเชื่อมั่น
          &lt; T_LOW หรือไม่ผ่านการตรวจความสมเหตุสมผล
        </span>
        <Link href="/dashboard" className={styles.adminExitLink}>
          ← ออกจากมุมมองผู้ดูแล
        </Link>
      </div>

      <div className={styles.adminBody}>
        <div className={styles.adminQueueList}>
          {QUEUE.map((item, index) => (
            <button
              type="button"
              key={item.title}
              className={`${styles.adminQueueItem} ${index === qIdx ? styles.adminQueueItemOn : ""}`}
              onClick={() => {
                setQIdx(index);
                setToast(DEFAULT_TOAST);
              }}
            >
              <div className={styles.adminQueueFlag}>
                ความเชื่อมั่น {item.conf} · {item.flag}
              </div>
              <div className={styles.adminQueueTitle}>{item.title}</div>
              <div className={styles.adminQueueSrc}>{item.src}</div>
            </button>
          ))}
        </div>

        <div className={styles.adminDetail}>
          <div className={styles.adminDoc}>
            <div className={labels.blockLabel}>เอกสารต้นฉบับ — อ่านอย่างเดียว</div>
            <div className={styles.adminDocPreview}>
              <div className={styles.adminDocPreviewText}>
                {current.docType}
                <br />
                {current.docRef}
                <br />
                {current.docNote}
                <br />
                <br />[ ซูม ] [ หมุน ] [ เพิ่มความคมชัด ]</div>
            </div>
            <div className={styles.adminDocHash}>ต้นฉบับเก็บถาวรไม่แก้ไข · บันทึก SHA-256 แล้ว</div>
          </div>

          <div className={styles.adminFields}>
            <div className={labels.blockLabel}>ฟิลด์ที่สกัดได้ — แก้ไขได้</div>
            <div className={styles.adminFieldList}>
              {current.fields.map((field, fieldIdx) => (
                <div key={field.label}>
                  <div className={styles.adminFieldHead}>
                    <span className={field.ok ? styles.adminFieldLabel : styles.adminFieldLabelWarn}>
                      {field.label}
                    </span>
                    <span className={field.ok ? styles.adminFieldConfOk : styles.adminFieldConfWarn}>
                      {field.conf}
                    </span>
                  </div>
                  <input
                    className={`${styles.adminFieldInput} ${field.ok ? "" : styles.adminFieldInputWarn}`}
                    value={valueFor(fieldIdx, field)}
                    onChange={(e) => editField(fieldIdx, e.target.value)}
                  />
                </div>
              ))}
            </div>

            <div className={styles.adminActions}>
              <button type="button" className={styles.adminApproveBtn} onClick={() => setToast(APPROVE_TOAST)}>
                ✓ อนุมัติ — ล้างแท็ก unverified
              </button>
              <button
                type="button"
                className={styles.adminSecondaryBtn}
                onClick={() => setToast(REEXTRACT_TOAST)}
              >
                สกัดใหม่
              </button>
              <button
                type="button"
                className={`${styles.adminSecondaryBtn} ${styles.adminRejectBtn}`}
                onClick={() => setToast(REJECT_TOAST)}
              >
                ปฏิเสธ
              </button>
            </div>
            <div className={styles.adminToast}>{toast}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
