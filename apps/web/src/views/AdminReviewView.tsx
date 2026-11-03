"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import styles from "../features/admin/admin.module.css";
import { RecordPanel } from "../features/admin/RecordPanel";
import type { QueueEntry, ReviewRecord } from "../shared/lib/admin-api";

const QUEUE_LIST_ID = "admin-review-queue";
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
  "category-unconfirmed": "ยืนยันหมวดหมู่",
  "qualifications-unconfirmed": "ยืนยันคุณสมบัติ",
};
function reasonLabel(reason: string) {
  return REASON_LABELS[reason] ?? reason;
}
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d={open ? "M15 18l-6-6 6-6" : "M9 18l6-6-6-6"} />
    </svg>
  );
}

export function AdminReviewView({
  queue,
  unverifiedNotQueued,
  fieldsToConfirm = 0,
  view = "confidence",
  record,
  documentHref,
  offline,
  missingRecord = false,
  activeReason,
}: {
  queue: QueueEntry[];
  unverifiedNotQueued: number;
  fieldsToConfirm?: number;
  view?: "confidence" | "fields";
  record: ReviewRecord | null;
  documentHref: string | null;
  offline: string | null;
  missingRecord?: boolean;
  activeReason?: string;
}) {
  const [search, setSearch] = useState("");
  const [queueOpen, setQueueOpen] = useState(true);
  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle
      ? queue.filter(
          (item) =>
            [item.title, item.agency, ...item.reviewReasons.map(reasonLabel)]
              .join(" ")
              .toLowerCase()
              .includes(needle) || item.id.toLowerCase().startsWith(needle),
        )
      : queue;
  }, [queue, search]);
  const reasons = useMemo(() => [...new Set(queue.flatMap((item) => item.reviewReasons))], [queue]);
  return (
    <main className={styles.adminPage}>
      <div className={styles.adminBar}>
        <h1 className={styles.adminTitle}>คิวตรวจสอบการสกัดข้อมูล</h1>
        <nav className={styles.adminTabs} aria-label="รายการตรวจสอบ">
          <Link
            href="/admin/review"
            className={`${styles.adminTab} ${view === "confidence" ? styles.adminTabOn : ""}`}
            aria-current={view === "confidence" ? "page" : undefined}
          >
            ความเชื่อมั่นต่ำ{view === "confidence" ? ` · ${queue.length}` : ""}
          </Link>
          <Link
            href="/admin/review?view=fields"
            className={`${styles.adminTab} ${view === "fields" ? styles.adminTabOn : ""}`}
            aria-current={view === "fields" ? "page" : undefined}
          >
            รอยืนยันฟิลด์ · {fieldsToConfirm}
          </Link>
        </nav>
        <span className={styles.adminMeta}>
          {view === "fields"
            ? "TOR ที่รอยืนยันฟิลด์"
            : `ในคิว ${queue.length} · ยังไม่ยืนยันและไม่เข้าคิว ${unverifiedNotQueued}`}
        </span>
      </div>
      {offline && <div className={styles.overviewOffline}>{offline}</div>}
      {missingRecord && !offline && (
        <div className={styles.adminNotice}>รายการที่เปิดจากลิงก์นี้ไม่อยู่ในระบบแล้ว</div>
      )}
      {queue.length === 0 && !record ? (
        <div className={`${styles.adminBody} ${styles.adminBodyBlank}`}>
          <div className={styles.adminBlank}>
            <h2 className={styles.adminBlankTitle}>
              {offline ? "ยังไม่ทราบว่ามีอะไรรอตรวจสอบ" : "ไม่มีเอกสารรอตรวจสอบ"}
            </h2>
            <p className={styles.adminBlankBody}>
              เอกสารใหม่จะเข้าคิวเมื่อความเชื่อมั่นต่ำกว่าเกณฑ์หรือไม่ผ่านการตรวจสอบความสมเหตุสมผล
            </p>
          </div>
        </div>
      ) : (
        <div className={`${styles.adminBody} ${queueOpen ? "" : styles.adminBodyCollapsed}`}>
          <button
            type="button"
            className={styles.queueEdgeToggle}
            onClick={() => setQueueOpen(!queueOpen)}
            aria-label={queueOpen ? "ย่อคิว" : "แสดงคิว"}
            aria-expanded={queueOpen}
            aria-controls={QUEUE_LIST_ID}
          >
            <Chevron open={queueOpen} />
          </button>
          {!queueOpen && <div className={styles.queueRail} />}
          <aside
            id={QUEUE_LIST_ID}
            className={`${styles.adminQueueList} ${queueOpen ? "" : styles.adminQueueListHidden}`}
          >
            <div className={styles.queueTools}>
              <div className={styles.queueToolsHead}>
                <span className={styles.queueToolsTitle}>คิวตรวจสอบ · {queue.length}</span>
              </div>
              <input
                className={styles.queueSearch}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ค้นหาชื่อโครงการ หน่วยงาน หรือเหตุผล"
                aria-label="ค้นหาในคิวตรวจสอบ"
              />
              {view === "confidence" && reasons.length > 0 && (
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
            </div>
            {shown.length === 0 && <div className={styles.queueEmpty}>ไม่พบรายการที่ตรงกับคำค้น</div>}
            {shown.map((item, index) => (
              <a
                key={item.id}
                href={`/admin/review?id=${item.id}${view === "fields" ? "&view=fields" : ""}${activeReason ? `&reason=${encodeURIComponent(activeReason)}` : ""}`}
                className={`${styles.adminQueueItem} ${record?.id === item.id ? styles.adminQueueItemOn : ""}`}
              >
                <span className={styles.adminQueueIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.adminQueueItemBody}>
                  <span className={styles.adminQueueTitle}>
                    {item.title || "(ไม่มีชื่อโครงการที่สกัดได้)"}
                  </span>
                  <span className={styles.adminQueueConfidence}>{item.confidence.toFixed(2)}</span>
                  <span className={styles.adminQueueFlag}>
                    {item.reviewReasons.map(reasonLabel).join(" · ") || "ต่ำกว่าเกณฑ์"}
                  </span>
                </span>
              </a>
            ))}
          </aside>
          {record ? (
            <>
              {/* The key remounts record-scoped drafts and viewer state for the newly selected TOR. */}
              <RecordPanel key={record.id} record={record} documentHref={documentHref} mode="review" />
            </>
          ) : (
            <div className={styles.adminSelectionEmpty}>เลือกรายการจากคิวเพื่อเริ่มตรวจสอบ</div>
          )}
        </div>
      )}
    </main>
  );
}
