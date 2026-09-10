"use client";

import { useMemo, useState, useTransition } from "react";
import labels from "../shared/ui/labels.module.css";
import styles from "../features/admin/admin.module.css";
import {
  approveRecordAction,
  reextractRecordAction,
  rejectRecordAction,
  saveCorrections,
} from "../features/admin/admin.actions";
import type { QueueEntry, ReviewRecord } from "../shared/lib/admin-api";

/**
 * The extraction review queue (FR-G-1, FR-G-2). Ported from the "Admin Queue"
 * screen of mockups/TOR Radar App.dc.html and wired to the real records.
 *
 * The data arrives from the server component that renders this — the admin key
 * lives there and never reaches the browser. Edits and decisions go back out as
 * server actions for the same reason.
 */

/** The nine extracted fields, in the order a reviewer reads a document. */
/** The toggle names the region it opens, so a screen reader is told what moved. */
const QUEUE_LIST_ID = "admin-review-queue";

const FIELD_ORDER = [
  { key: "title", label: "ชื่อโครงการ" },
  { key: "agency", label: "หน่วยงาน" },
  { key: "budget", label: "งบประมาณ (฿)" },
  { key: "deadline", label: "กำหนดยื่นซอง" },
  { key: "category", label: "หมวดหมู่" },
  { key: "scopeSummary", label: "ขอบเขตงาน" },
  { key: "qualifications", label: "คุณสมบัติผู้ยื่นข้อเสนอ" },
  { key: "contact", label: "ติดต่อ" },
  { key: "torStatus", label: "สถานะ" },
] as const;

/** Machine reasons from grading, in the words a reviewer uses. */
const REASON_LABELS: Record<string, string> = {
  "agency-missing": "ขาดหน่วยงาน",
  "agency-unreadable": "อ่านหน่วยงานไม่ได้",
  "budget-missing": "ขาดงบประมาณ",
  "budget-unreadable": "อ่านงบประมาณไม่ได้",
  "budget-implausible": "งบประมาณไม่สมเหตุสมผล",
  "deadline-before-announcement": "วันยื่นก่อนวันประกาศ",
  "cancelled-with-deadline": "ประกาศยกเลิกแต่มีวันยื่น",
  "closed-with-future-deadline": "ปิดรับแล้วแต่วันยื่นยังไม่ถึง",
  "copy-through": "หลายฟิลด์ซ้ำกัน",
};

const ROUTE_LABELS: Record<string, string> = {
  upload: "อัปโหลด",
  url: "URL",
  api: "API",
};

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

/** Inline, because two chevrons do not justify an icon dependency. */
function ChevronLeft() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function AdminReviewView({
  queue,
  unverifiedNotQueued,
  record,
  offline,
  activeReason,
}: {
  queue: QueueEntry[];
  unverifiedNotQueued: number;
  record: ReviewRecord | null;
  offline: string | null;
  activeReason?: string;
}) {
  const [search, setSearch] = useState("");
  // Collapsing the queue gives the document and the fields the whole width,
  // which is what a reviewer wants once they have chosen what to work on.
  const [queueOpen, setQueueOpen] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Search filters what is already loaded — no round trip while typing.
   *
   * The record id is matched by PREFIX, never as a substring. A 24-character
   * hex id contains most letters and digits, so including it in the free-text
   * haystack made "a" or "2f" match every row — a search that returns
   * everything is the same as no search at all.
   */
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return queue;

    return queue.filter((item) => {
      const text = [item.title, item.agency, ...item.reviewReasons.map(reasonLabel)]
        .join(" ")
        .toLowerCase();
      return text.includes(needle) || item.id.toLowerCase().startsWith(needle);
    });
  }, [queue, search]);

  /** Every reason present in the queue, for the triage chips. */
  const reasons = useMemo(
    () => [...new Set(queue.flatMap((item) => item.reviewReasons))],
    [queue],
  );

  const pendingEdits = Object.entries(edits).map(([field, value]) => ({ field, value }));

  function run(action: () => Promise<void>, message: string) {
    setToast(null);
    startTransition(async () => {
      try {
        await action();
        setEdits({});
        setToast(message);
      } catch (error) {
        setToast(`ไม่สำเร็จ: ${String(error)}`);
      }
    });
  }

  return (
    <main className={styles.adminPage}>
      <div className={styles.adminBar}>
        <h1 className={styles.adminTitle}>คิวตรวจสอบการสกัดข้อมูล</h1>
        <span className={styles.adminMeta}>
          ในคิว {queue.length} · ยังไม่ยืนยันและไม่เข้าคิว {unverifiedNotQueued} · เข้าคิวเมื่อความเชื่อมั่น
          &lt; T_LOW หรือไม่ผ่านการตรวจความสมเหตุสมผล
        </span>
      </div>

      {offline && <div className={styles.overviewOffline}>{offline}</div>}

      <div className={`${styles.adminBody} ${queueOpen ? "" : styles.adminBodyCollapsed}`}>
        {/* One control, on the seam between the columns, in both states — the
            rail beside it only reports how many are still waiting. */}
        <button
          type="button"
          className={styles.queueEdgeToggle}
          onClick={() => setQueueOpen(!queueOpen)}
          title={queueOpen ? "ย่อคิว" : "แสดงคิว"}
          aria-label={queueOpen ? "ย่อคิว" : "แสดงคิว"}
          aria-expanded={queueOpen}
          aria-controls={QUEUE_LIST_ID}
        >
          {queueOpen ? <ChevronLeft /> : <ChevronRight />}
        </button>

        {!queueOpen && (
          <div className={styles.queueRail}>
            <span className={styles.queueRailCount}>{queue.length}</span>
          </div>
        )}

        <div
          id={QUEUE_LIST_ID}
          className={`${styles.adminQueueList} ${queueOpen ? "" : styles.adminQueueListHidden}`}
        >
          <div className={styles.queueTools}>
            <div className={styles.queueToolsHead}>
              <span className={styles.queueToolsTitle}>คิวตรวจสอบ</span>
            </div>
            <input
              className={styles.queueSearch}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาในคิว — ชื่อโครงการ หน่วยงาน หรือเหตุผล"
              aria-label="ค้นหาในคิวตรวจสอบ"
            />

            {reasons.length > 0 && (
              <div className={styles.queueReasons}>
                <a
                  href="/admin/review"
                  className={`${styles.queueReason} ${activeReason ? "" : styles.queueReasonOn}`}
                >
                  ทั้งหมด
                </a>
                {reasons.map((reason) => (
                  <a
                    key={reason}
                    href={`/admin/review?reason=${encodeURIComponent(reason)}`}
                    className={`${styles.queueReason} ${activeReason === reason ? styles.queueReasonOn : ""}`}
                  >
                    {reasonLabel(reason)}
                  </a>
                ))}
              </div>
            )}

            <span className={styles.queueCount}>
              แสดง {shown.length} จาก {queue.length}
            </span>
          </div>

          {shown.length === 0 && (
            <div className={styles.queueEmpty}>
              {queue.length === 0
                ? "ไม่มีเอกสารรอตรวจสอบ — ทุกระเบียนผ่านเกณฑ์หรือได้รับการอนุมัติแล้ว"
                : "ไม่พบรายการที่ตรงกับคำค้น"}
            </div>
          )}

          {shown.map((item) => (
            <a
              key={item.id}
              href={`/admin/review?id=${item.id}${activeReason ? `&reason=${encodeURIComponent(activeReason)}` : ""}`}
              className={`${styles.adminQueueItem} ${record?.id === item.id ? styles.adminQueueItemOn : ""}`}
            >
              <div className={styles.adminQueueFlag}>
                ความเชื่อมั่น {item.confidence.toFixed(2)} ·{" "}
                {item.reviewReasons.map(reasonLabel).join(" · ") || "ต่ำกว่าเกณฑ์"}
              </div>
              <div className={styles.adminQueueTitle}>{item.title || "(ไม่มีชื่อโครงการที่สกัดได้)"}</div>
              <div className={styles.adminQueueSrc}>
                {ROUTE_LABELS[item.route] ?? item.route} · นำเข้า{" "}
                {new Date(item.submittedAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}
              </div>
            </a>
          ))}
        </div>

        {record ? (
          <div className={styles.adminDetail}>
            <div className={styles.adminDoc}>
              <div className={labels.blockLabel}>เอกสารต้นฉบับ — อ่านอย่างเดียว</div>
              <div className={styles.adminDocPreview}>
                <div className={styles.adminDocPreviewText}>
                  {record.contentType}
                  <br />
                  {record.hasTextLayer ? "มีชั้นข้อความ (ดิจิทัล)" : "ไม่มีชั้นข้อความ — ผ่าน OCR"}
                  <br />
                  {(record.storage.bytes / 1024).toFixed(0)} KB
                  <br />
                  <br />[ ซูม ] [ หมุน ] [ เพิ่มความคมชัด ]
                </div>
              </div>
              <div className={styles.adminDocHash}>
                ต้นฉบับเก็บถาวรไม่แก้ไข · SHA-256 {record.contentHash.slice(0, 16)}…
              </div>
            </div>

            <div className={styles.adminFields}>
              <div className={labels.blockLabel}>ฟิลด์ที่สกัดได้ — แก้ไขได้</div>
              <div className={styles.adminFieldList}>
                {FIELD_ORDER.map(({ key, label }) => {
                  const field = record.fields[key];
                  const confidence = field?.confidence ?? 0;
                  // Marked ONLY if this field is why the record is here. On a
                  // low-confidence record nothing is verified yet, so marking
                  // "not verified" would paint every row orange and tell a
                  // reviewer nothing. The server decides, because the threshold
                  // lives with the config.
                  const flagged = !field || (record.flaggedFields ?? []).includes(key);
                  const ok = !flagged;
                  const value = edits[key] ?? field?.raw ?? "";

                  return (
                    <div key={key}>
                      <div className={styles.adminFieldHead}>
                        <span className={ok ? styles.adminFieldLabel : styles.adminFieldLabelWarn}>
                          {label}
                          {!field && " — ขาดหาย"}
                        </span>
                        <span className={ok ? styles.adminFieldConfOk : styles.adminFieldConfWarn}>
                          {confidence.toFixed(2)}
                        </span>
                      </div>
                      <input
                        className={`${styles.adminFieldInput} ${ok ? "" : styles.adminFieldInputWarn}`}
                        value={value}
                        placeholder={field ? "" : "ไม่พบค่าในเอกสาร — กรอกจากต้นฉบับ"}
                        onChange={(event) =>
                          setEdits((prev) => ({ ...prev, [key]: event.target.value }))
                        }
                      />
                      {field?.verified && <div className={styles.fieldVerified}>✓ ตรวจแล้ว</div>}
                      {field?.evidence && <div className={styles.adminQueueSrc}>“{field.evidence}”</div>}
                    </div>
                  );
                })}
              </div>

              <div className={styles.adminActions}>
                <button
                  type="button"
                  className={styles.adminApproveBtn}
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => approveRecordAction(record.id, pendingEdits),
                      "✓ อนุมัติแล้ว — ล้างแท็กยังไม่ยืนยัน และเผยแพร่สู่หน้าค้นหา · บันทึกการแก้ไขเป็นตัวอย่างสอน extractor",
                    )
                  }
                >
                  ✓ อนุมัติ — ล้างแท็กยังไม่ยืนยัน
                </button>
                <button
                  type="button"
                  className={styles.adminSecondaryBtn}
                  disabled={pending || pendingEdits.length === 0}
                  onClick={() =>
                    run(
                      () => saveCorrections(record.id, pendingEdits),
                      `บันทึกการแก้ไข ${pendingEdits.length} ฟิลด์ — เก็บเป็นตัวอย่างสอน extractor (FR-G-2)`,
                    )
                  }
                >
                  บันทึกการแก้ไข
                </button>
                <button
                  type="button"
                  className={styles.adminSecondaryBtn}
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => reextractRecordAction(record.id),
                      "↻ ส่งกลับเข้าคิวสกัดใหม่แล้ว",
                    )
                  }
                >
                  สกัดใหม่
                </button>
                <button
                  type="button"
                  className={`${styles.adminSecondaryBtn} ${styles.adminRejectBtn}`}
                  disabled={pending}
                  onClick={() =>
                    run(
                      () => rejectRecordAction(record.id, "ไม่ใช่ TOR ที่เกี่ยวข้อง"),
                      "✕ ปฏิเสธ — จำกัดการเข้าถึงและบันทึกเหตุผล ต้นฉบับยังเก็บไว้",
                    )
                  }
                >
                  ปฏิเสธ
                </button>
              </div>

              <div className={styles.adminToast}>
                {toast ?? "การแก้ไขถูกเก็บเป็นตัวอย่างสอน extractor (FR-G-2) · ต้นฉบับไม่ถูกแก้ไข"}
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.adminDetail}>
            <div className={styles.queueEmpty}>
              {queue.length > 0 ? "เลือกรายการจากคิวเพื่อเริ่มตรวจสอบ" : "ไม่มีอะไรต้องตรวจสอบตอนนี้"}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
