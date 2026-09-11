"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useMemo, useState, useTransition } from "react";
import styles from "../features/admin/admin.module.css";
import { AdminConfirmDialog } from "../features/admin/admin-confirm-dialog";
import {
  approveRecordAction,
  reextractRecordAction,
  rejectRecordAction,
  setFieldVerificationAction,
} from "../features/admin/admin.actions";
import type { QueueEntry, ReviewDocument, ReviewRecord } from "../shared/lib/admin-api";

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

function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

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

function percentStyle(value: number, property: "--confidence-width" | "--progress-width") {
  const percent = Math.max(0, Math.min(100, value * 100));
  return { [property]: `${percent}%` } as CSSProperties;
}

export function AdminReviewView({
  queue,
  unverifiedNotQueued,
  record,
  document,
  documentError,
  offline,
  missingRecord = false,
  activeReason,
}: {
  queue: QueueEntry[];
  unverifiedNotQueued: number;
  record: ReviewRecord | null;
  document: ReviewDocument | null;
  documentError: string | null;
  offline: string | null;
  /** A deep link pointed at a record that no longer exists. */
  missingRecord?: boolean;
  activeReason?: string;
}) {
  const [search, setSearch] = useState("");
  const [queueOpen, setQueueOpen] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"approve" | "reextract" | "reject" | null>(null);
  /** The signed URL that failed to load, if any — see the viewer below. */
  const [brokenDocUrl, setBrokenDocUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /** ObjectIds match by prefix only; all reviewer-facing text uses substring search. */
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

  const reasons = useMemo(
    () => [...new Set(queue.flatMap((item) => item.reviewReasons))],
    [queue],
  );
  const queueIndexes = useMemo(
    () => new Map(queue.map((item, index) => [item.id, index + 1])),
    [queue],
  );
  const pendingEdits = Object.entries(edits).map(([field, value]) => ({ field, value }));
  const verifiedCount = record
    ? FIELD_ORDER.filter(({ key }) => record.fields[key]?.verified).length
    : 0;

  function run(action: () => Promise<void>, message: string, clearEdits = true): Promise<void> {
    setToast(null);
    const result = (async () => {
      try {
        await action();
        if (clearEdits) setEdits({});
        setToast(message);
      } catch (error) {
        // The detail belongs in the log, not in a Thai sentence on screen.
        console.error("[admin/review] action failed", error);
        setToast("ทำรายการไม่สำเร็จ — ลองใหม่อีกครั้ง");
      }
    })();
    startTransition(() => result);
    return result;
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

      {/* Not an error state: the link is stale, the queue is fine. */}
      {missingRecord && !offline && (
        <div className={styles.adminNotice}>
          รายการที่เปิดจากลิงก์นี้ไม่อยู่ในระบบแล้ว — อาจถูกปฏิเสธหรือตรวจสอบเสร็จแล้ว
        </div>
      )}

      {queue.length === 0 ? (
        <div className={`${styles.adminBody} ${styles.adminBodyBlank}`}>
          <div className={styles.adminBlank}>
            <h2 className={styles.adminBlankTitle}>
              {offline ? "ยังไม่ทราบว่ามีอะไรรอตรวจสอบ" : "ไม่มีเอกสารรอตรวจสอบ"}
            </h2>
            <p className={styles.adminBlankBody}>
              {offline
                ? "ยังเชื่อมต่อกับ API ไม่ได้ คิวจะปรากฏเมื่อบริการทำงาน"
                : "ทุกระเบียนผ่านเกณฑ์ความเชื่อมั่นหรือได้รับการตรวจสอบแล้ว เอกสารใหม่จะเข้าคิวเองเมื่อความเชื่อมั่นต่ำกว่าเกณฑ์หรือไม่ผ่านการตรวจความสมเหตุสมผล"}
            </p>
            {!offline && (
              <Link href="/admin/log" className={styles.adminBlankLink}>
                ดูบันทึกกิจกรรม →
              </Link>
            )}
          </div>
        </div>
      ) : (
        <div className={`${styles.adminBody} ${queueOpen ? "" : styles.adminBodyCollapsed}`}>
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
              {reasons.length > 0 && (
                <div className={styles.queueReasons}>
                  <a href="/admin/review" className={`${styles.queueReason} ${activeReason ? "" : styles.queueReasonOn}`}>
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

            {shown.map((item) => (
              <a
                key={item.id}
                href={`/admin/review?id=${item.id}${activeReason ? `&reason=${encodeURIComponent(activeReason)}` : ""}`}
                className={`${styles.adminQueueItem} ${record?.id === item.id ? styles.adminQueueItemOn : ""}`}
              >
                <span className={styles.adminQueueIndex}>
                  {String(queueIndexes.get(item.id) ?? 0).padStart(2, "0")}
                </span>
                <span className={styles.adminQueueItemBody}>
                  <span className={styles.adminQueueTitle}>{item.title || "(ไม่มีชื่อโครงการที่สกัดได้)"}</span>
                  <span className={styles.adminQueueConfidence}>
                    <span className={styles.adminQueueConfidenceTrack} style={percentStyle(item.confidence, "--confidence-width")}>
                      <span className={styles.adminQueueConfidenceFill} />
                    </span>
                    <span>{item.confidence.toFixed(2)}</span>
                  </span>
                  <span className={styles.adminQueueFlag}>
                    {item.reviewReasons.map(reasonLabel).join(" · ") || "ต่ำกว่าเกณฑ์"}
                  </span>
                </span>
              </a>
            ))}
          </aside>

          {record ? (
            <>
              <section className={styles.adminDoc} aria-label="เอกสารต้นฉบับ">
                <div className={styles.adminDocToolbar}>
                  <span>{document?.contentType ?? record.contentType}</span>
                  <span>{(document?.bytes ?? record.storage.bytes).toLocaleString("th-TH")} ไบต์</span>
                </div>
                <div className={styles.adminDocViewer}>
                  {/*
                    Three outcomes, not two. The URL can fail to be issued, and
                    it can be issued correctly and point at nothing — a signed
                    link to a missing object loads as a broken image, which
                    tells a reviewer nothing. The failure is tracked by URL
                    rather than by a flag, so moving to the next record clears
                    it without a reset.
                  */}
                  {document && brokenDocUrl !== document.url ? (
                    document.contentType.startsWith("image/") ? (
                      <img
                        src={document.url}
                        alt="ต้นฉบับ TOR"
                        className={styles.adminDocImage}
                        onError={() => setBrokenDocUrl(document.url)}
                      />
                    ) : (
                      <iframe
                        src={document.url}
                        title="ต้นฉบับ TOR"
                        className={styles.adminDocFrame}
                        referrerPolicy="no-referrer"
                        onError={() => setBrokenDocUrl(document.url)}
                      />
                    )
                  ) : (
                    <p className={styles.adminDocError}>
                      {document
                        ? "เปิดต้นฉบับไม่ได้ — ไฟล์อาจยังไม่ถูกจัดเก็บ ข้อมูลที่สกัดได้ยังตรวจสอบได้ตามปกติ"
                        : (documentError ?? "ไม่พบลิงก์ต้นฉบับ")}
                    </p>
                  )}
                </div>
                {document && (
                  <a href={document.url} target="_blank" rel="noreferrer" className={styles.adminDocFallback}>
                    เปิดต้นฉบับในแท็บใหม่ ↗
                  </a>
                )}
                <footer className={styles.adminDocHash}>
                  ต้นฉบับเก็บถาวรไม่แก้ไข · SHA-256 {record.contentHash.slice(0, 12)}
                  <p className={styles.adminFieldsNote}>
                    การแก้ไขถูกเก็บเป็นตัวอย่างสอน extractor (FR-G-2) · ต้นฉบับไม่ถูกแก้ไข
                  </p>
                </footer>
              </section>

              <section className={styles.adminFields} aria-label="ฟิลด์ที่สกัดได้">
                <header className={styles.adminFieldsHeader}>
                  <h2 className={styles.adminFieldsTitle}>ฟิลด์ที่สกัดได้</h2>
                  {/* The reason rides the same line as the title: a stacked block
                      spent 125px saying two short things, and the label
                      "เหตุผลที่ต้องตรวจสอบ" repeated what the reason already says. */}
                  <span className={styles.adminReasonNote} title="เหตุผลที่ต้องตรวจสอบ">
                    {record.reviewReasons.map(reasonLabel).join(" · ") || "ความเชื่อมั่นต่ำกว่าเกณฑ์"}
                  </span>
                </header>

                {toast && <div className={styles.adminToast}>{toast}</div>}

                <div className={styles.adminFieldList}>
                  {FIELD_ORDER.map(({ key, label }) => {
                    const field = record.fields[key];
                    const confidence = field?.confidence ?? 0;
                    const value = edits[key] ?? field?.raw ?? "";
                    const modified = edits[key] !== undefined && edits[key] !== (field?.raw ?? "");

                    return (
                      <div className={styles.adminFieldRow} key={key}>
                        <div className={styles.adminFieldHead}>
                          <button
                            type="button"
                            className={`${styles.adminFieldTick} ${field?.verified ? styles.adminFieldTickOn : ""}`}
                          aria-label={`${field?.verified ? "ยกเลิกการยืนยัน" : "ยืนยัน"} ${label}`}
                          aria-pressed={field?.verified ?? false}
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => setFieldVerificationAction(record.id, key, !field?.verified),
                              field?.verified ? `ยกเลิกการยืนยัน ${label} แล้ว` : `ยืนยัน ${label} แล้ว`,
                              false,
                            )
                          }
                          >
                            ✓
                          </button>
                          <span className={styles.adminFieldLabel}>{label}{!field && " — ขาดหาย"}</span>
                          {!field?.verified && <span className={styles.adminFieldBadge}>ต้องยืนยัน</span>}
                          {modified && <span className={styles.adminFieldEdited}>แก้ไขแล้ว</span>}
                          <span className={styles.adminFieldConfidence}>{confidence.toFixed(2)}</span>
                        </div>
                        <input
                          className={`${styles.adminFieldInput} ${field?.verified ? "" : styles.adminFieldInputWarn}`}
                          value={value}
                          placeholder={field ? "" : "ไม่พบค่าในเอกสาร — กรอกจากต้นฉบับ"}
                          onChange={(event) => setEdits((previous) => ({ ...previous, [key]: event.target.value }))}
                        />
                        <div className={styles.adminFieldNote}>
                          {field?.evidence ? `อ้างอิง: “${field.evidence}”` : "ไม่มีข้อความอ้างอิงจากการสกัด"}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <footer className={styles.adminFieldsFooter}>
                  <div className={styles.adminProgressHead}>
                    <span>ยืนยันแล้ว {verifiedCount} / {FIELD_ORDER.length}</span>
                    <button
                      type="button"
                      className={styles.adminConfirmAll}
                      disabled={pending || verifiedCount === FIELD_ORDER.length}
                      onClick={() =>
                        run(
                          async () => {
                            await Promise.all(
                              FIELD_ORDER.filter(({ key }) => !record.fields[key]?.verified).map(({ key }) =>
                                setFieldVerificationAction(record.id, key, true),
                              ),
                            );
                          },
                          "ยืนยันทุกฟิลด์แล้ว",
                          false,
                        )
                      }
                    >
                      ยืนยันทั้งหมด
                    </button>
                  </div>
                  <div
                    className={styles.adminProgressTrack}
                    style={percentStyle(verifiedCount / FIELD_ORDER.length, "--progress-width")}
                    role="progressbar"
                    aria-label="ความคืบหน้าการยืนยันฟิลด์"
                    aria-valuemin={0}
                    aria-valuemax={FIELD_ORDER.length}
                    aria-valuenow={verifiedCount}
                  >
                    <span className={styles.adminProgressFill} />
                  </div>

                  <button
                    type="button"
                    className={styles.adminApproveBtn}
                    disabled={pending}
                    onClick={() => {
                      if (verifiedCount === FIELD_ORDER.length) {
                        void run(() => approveRecordAction(record.id, pendingEdits), "✓ ยืนยันและเผยแพร่แล้ว · บันทึกการแก้ไขเป็นตัวอย่างสอน extractor");
                      } else {
                        setConfirmation("approve");
                      }
                    }}
                  >
                    ยืนยันและเผยแพร่
                  </button>

                  <div className={styles.adminActions}>
                    <button
                      type="button"
                      className={styles.adminSecondaryBtn}
                      disabled={pending}
                      onClick={() => setConfirmation("reextract")}
                    >
                      สกัดใหม่
                    </button>
                    <button
                      type="button"
                      className={`${styles.adminSecondaryBtn} ${styles.adminRejectBtn}`}
                      disabled={pending}
                      onClick={() => setConfirmation("reject")}
                    >
                      ปฏิเสธ
                    </button>
                  </div>

                </footer>

                <AdminConfirmDialog
                  open={confirmation === "approve"}
                  title="ยืนยันและเผยแพร่ระเบียนนี้หรือไม่"
                  body={`ยังมี ${FIELD_ORDER.length - verifiedCount} ฟิลด์ที่ไม่ได้ยืนยัน การเผยแพร่จะนำระเบียนนี้ขึ้นเว็บไซต์สาธารณะ`}
                  cancelLabel="ยกเลิก"
                  confirmLabel="ยืนยันและเผยแพร่"
                  tone="primary"
                  onClose={() => setConfirmation(null)}
                  onConfirm={() => run(
                    () => approveRecordAction(record.id, pendingEdits),
                    "✓ ยืนยันและเผยแพร่แล้ว · บันทึกการแก้ไขเป็นตัวอย่างสอน extractor",
                  )}
                />

                <AdminConfirmDialog
                  open={confirmation === "reextract"}
                  title="สกัดข้อมูลใหม่หรือไม่"
                  body={
                    pendingEdits.length > 0
                      ? "โมเดลจะเขียนทับค่าปัจจุบัน และการแก้ไขในแบบฟอร์มที่ยังไม่ได้บันทึกจะสูญหาย"
                      : "โมเดลจะเขียนทับค่าปัจจุบันด้วยค่าที่สกัดใหม่"
                  }
                  cancelLabel="ยกเลิก"
                  confirmLabel="สกัดใหม่"
                  tone="primary"
                  onClose={() => setConfirmation(null)}
                  onConfirm={() => run(
                    () => reextractRecordAction(record.id),
                    "↻ ส่งกลับเข้าคิวสกัดใหม่แล้ว",
                  )}
                />

                <AdminConfirmDialog
                  open={confirmation === "reject"}
                  title="ปฏิเสธระเบียนนี้หรือไม่"
                  body="การปฏิเสธจะจำกัดการเข้าถึงสาธารณะและเขียนรายการลงบันทึกการตรวจสอบ เอกสารต้นฉบับจะยังถูกเก็บไว้และจะไม่ถูกลบ"
                  cancelLabel="ยกเลิก"
                  confirmLabel="ปฏิเสธ"
                  tone="danger"
                  reason={{ label: "เหตุผลในการปฏิเสธ" }}
                  onClose={() => setConfirmation(null)}
                  onConfirm={(reason) => run(
                    () => rejectRecordAction(record.id, reason ?? ""),
                    "✕ ปฏิเสธ — จำกัดการเข้าถึงและบันทึกเหตุผล ต้นฉบับยังเก็บไว้",
                  )}
                />
              </section>
            </>
          ) : (
            <div className={styles.adminSelectionEmpty}>เลือกรายการจากคิวเพื่อเริ่มตรวจสอบ</div>
          )}
        </div>
      )}
    </main>
  );
}
