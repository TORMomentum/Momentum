"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import { TOR_CATEGORIES, isTorCategory } from "@tor-radar/shared";
import styles from "./admin.module.css";
import { AdminConfirmDialog } from "./admin-confirm-dialog";
import {
  approveRecordAction,
  reextractRecordAction,
  rejectRecordAction,
  restoreRecordAction,
  saveCorrections,
  setFieldVerificationAction,
} from "./admin.actions";
import type { ReviewRecord } from "../../shared/lib/admin-api";

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

function percentStyle(value: number) {
  return { "--progress-width": `${Math.max(0, Math.min(100, value * 100))}%` } as CSSProperties;
}

/**
 * The record detail surface is deliberately keyed by its caller with record.id.
 * Its draft and viewer state must never survive a move to another TOR.
 */
export function RecordPanel({
  record,
  documentHref,
  mode,
}: {
  record: ReviewRecord;
  documentHref: string | null;
  mode: "review" | "manage";
}) {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<"approve" | "reextract" | "reject" | "save" | null>(null);
  const [brokenDocUrl, setBrokenDocUrl] = useState<string | null>(null);
  const [docShown, setDocShown] = useState<"tor" | "invitation">("tor");
  const [pending, startTransition] = useTransition();
  const invitationId = record.fields.deadline?.fromDocument;
  const shownKind = invitationId ? docShown : "tor";
  const viewerHref =
    shownKind === "invitation" && invitationId ? `/admin/tors/${invitationId}/document` : documentHref;
  const pendingEdits = Object.entries(edits).map(([field, value]) => ({ field, value }));
  const verifiedCount = FIELD_ORDER.filter(({ key }) => record.fields[key]?.verified).length;

  function run(action: () => Promise<void>, message: string, clearEdits = true) {
    setToast(null);
    const result = (async () => {
      try {
        await action();
        if (clearEdits) setEdits({});
        setToast(message);
      } catch (error) {
        console.error("[admin/record] action failed", error);
        setToast("ทำรายการไม่สำเร็จ — ลองใหม่อีกครั้ง");
      }
    })();
    startTransition(() => result);
    return result;
  }

  return (
    <>
      <section className={styles.adminDoc} aria-label="เอกสารต้นฉบับ">
        <div className={styles.adminDocToolbar}>
          {invitationId ? (
            <div className={styles.adminDocSwitch} role="tablist" aria-label="เอกสารที่แสดง">
              {(["tor", "invitation"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="tab"
                  aria-selected={shownKind === kind}
                  className={`${styles.adminDocSwitchItem} ${shownKind === kind ? styles.adminDocSwitchOn : ""}`}
                  onClick={() => setDocShown(kind)}
                >
                  {kind === "tor" ? "TOR" : "ประกาศเชิญชวน"}
                </button>
              ))}
            </div>
          ) : (
            <span>{record.contentType}</span>
          )}
          <span>
            {shownKind === "tor"
              ? `${record.storage.bytes.toLocaleString("th-TH")} ไบต์`
              : "ที่มาของวันยื่นข้อเสนอ"}
          </span>
        </div>
        <div className={styles.adminDocViewer}>
          {viewerHref && brokenDocUrl !== viewerHref ? (
            shownKind === "tor" && record.contentType.startsWith("image/") ? (
              <img
                src={`${viewerHref}?disposition=inline`}
                alt="ต้นฉบับ TOR"
                className={styles.adminDocImage}
                onError={() => setBrokenDocUrl(viewerHref)}
              />
            ) : (
              <iframe
                src={`${viewerHref}?disposition=inline`}
                title="ต้นฉบับ TOR"
                className={styles.adminDocFrame}
                referrerPolicy="no-referrer"
              />
            )
          ) : (
            <p className={styles.adminDocError}>
              {viewerHref ? "เปิดต้นฉบับไม่ได้ — ข้อมูลที่สกัดได้ยังตรวจสอบได้ตามปกติ" : "ไม่พบลิงก์ต้นฉบับ"}
            </p>
          )}
        </div>
        {viewerHref && (
          <a href={viewerHref} target="_blank" rel="noreferrer" className={styles.adminDocFallback}>
            เปิดต้นฉบับในแท็บใหม่ ↗
          </a>
        )}
        <footer className={styles.adminDocHash}>
          ต้นฉบับเก็บถาวรไม่แก้ไข · SHA-256 {record.contentHash.slice(0, 12)}
          <p className={styles.adminFieldsNote}>การแก้ไขไม่เปลี่ยนต้นฉบับ</p>
        </footer>
      </section>

      {/* data-record-panel marks the record's own fields, so a test can tell them
          from the queue search that sits beside them on the review screen. */}
      <section className={styles.adminFields} aria-label="ฟิลด์ที่สกัดได้" data-record-panel>
        <header className={styles.adminFieldsHeader}>
          <h2 className={styles.adminFieldsTitle}>ฟิลด์ที่สกัดได้</h2>
          <span className={styles.adminReasonNote}>
            {mode === "manage"
              ? record.restricted
                ? "ถอดจากหน้าสาธารณะแล้ว"
                : record.state === "unverified"
                  ? "ยังไม่ยืนยันการสกัด"
                  : "เผยแพร่ต่อสาธารณะ"
              : record.reviewReasons.join(" · ")}
          </span>
        </header>
        {mode === "manage" && record.state === "unverified" && (
          <Link href={`/admin/review?id=${record.id}`} className={styles.adminDocFallback}>
            เปิดในคิวตรวจสอบ →
          </Link>
        )}
        {record.restricted && (
          <div className={styles.restrictedBanner} role="status">
            <span>
              ถอดจากหน้าสาธารณะแล้ว
              {record.restrictedReason ? ` — ${record.restrictedReason}` : ""}
            </span>
            <button
              type="button"
              className={styles.adminSecondaryBtn}
              disabled={pending}
              onClick={() => run(() => restoreRecordAction(record.id), "คืนสู่หน้าสาธารณะแล้ว")}
            >
              คืนสู่หน้าสาธารณะ
            </button>
          </div>
        )}
        {toast && <div className={styles.adminToast}>{toast}</div>}
        <div className={styles.adminFieldList}>
          {FIELD_ORDER.map(({ key, label }) => {
            const field = record.fields[key];
            const value = edits[key] ?? field?.raw ?? "";
            const modified = edits[key] !== undefined && edits[key] !== (field?.raw ?? "");
            return (
              <div className={styles.adminFieldRow} key={key}>
                <div className={styles.adminFieldHead}>
                  {mode === "review" && (
                    <button
                      type="button"
                      className={`${styles.adminFieldTick} ${field?.verified ? styles.adminFieldTickOn : ""}`}
                      aria-label={`${field?.verified ? "ยกเลิกการยืนยัน" : "ยืนยัน"} ${label}`}
                      aria-pressed={field?.verified ?? false}
                      disabled={pending}
                      onClick={() =>
                        run(
                          () => setFieldVerificationAction(record.id, key, !field?.verified),
                          "บันทึกการยืนยันแล้ว",
                          false,
                        )
                      }
                    >
                      ✓
                    </button>
                  )}
                  <span className={styles.adminFieldLabel}>
                    {label}
                    {!field && " — ขาดหาย"}
                  </span>
                  {mode === "review" && !field?.verified && (
                    <span className={styles.adminFieldBadge}>ต้องยืนยัน</span>
                  )}
                  {modified && <span className={styles.adminFieldEdited}>แก้ไขแล้ว</span>}
                  <span className={styles.adminFieldConfidence}>{(field?.confidence ?? 0).toFixed(2)}</span>
                </div>
                {key === "category" ? (
                  <select
                    className={`${styles.adminFieldInput} ${field?.verified ? "" : styles.adminFieldInputWarn}`}
                    value={edits.category ?? (isTorCategory(field?.value) ? field.value : "")}
                    onChange={(event) =>
                      setEdits((previous) => ({ ...previous, category: event.target.value }))
                    }
                    aria-label="หมวดหมู่"
                  >
                    <option value="" disabled>
                      เลือกหมวดหมู่
                    </option>
                    {TOR_CATEGORIES.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className={`${styles.adminFieldInput} ${field?.verified ? "" : styles.adminFieldInputWarn}`}
                    value={value}
                    onChange={(event) => setEdits((previous) => ({ ...previous, [key]: event.target.value }))}
                  />
                )}
                <div className={styles.adminFieldNote}>
                  {field?.evidence ? `อ้างอิง: “${field.evidence}”` : "ไม่มีข้อความอ้างอิงจากการสกัด"}
                </div>
              </div>
            );
          })}
        </div>
        <footer className={styles.adminFieldsFooter}>
          {mode === "review" && (
            <>
              <div className={styles.adminProgressHead}>
                <span>
                  ยืนยันแล้ว {verifiedCount} / {FIELD_ORDER.length}
                </span>
                <button
                  type="button"
                  className={styles.adminConfirmAll}
                  disabled={pending || verifiedCount === FIELD_ORDER.length}
                  onClick={() =>
                    run(
                      () =>
                        Promise.all(
                          FIELD_ORDER.filter(({ key }) => !record.fields[key]?.verified).map(({ key }) =>
                            setFieldVerificationAction(record.id, key, true),
                          ),
                        ).then(() => undefined),
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
                style={percentStyle(verifiedCount / FIELD_ORDER.length)}
                role="progressbar"
                aria-valuenow={verifiedCount}
              >
                <span className={styles.adminProgressFill} />
              </div>
              <button
                type="button"
                className={styles.adminApproveBtn}
                disabled={pending}
                onClick={() =>
                  verifiedCount === FIELD_ORDER.length
                    ? run(() => approveRecordAction(record.id, pendingEdits), "ยืนยันและเผยแพร่แล้ว")
                    : setConfirmation("approve")
                }
              >
                ยืนยันและเผยแพร่
              </button>
            </>
          )}
          {/* The primary action takes a row of its own, as approve does in
              review mode; inside the row it squeezed the two beside it. */}
          {mode === "manage" && (
            <button
              type="button"
              className={styles.adminApproveBtn}
              disabled={pending || pendingEdits.length === 0}
              onClick={() => setConfirmation("save")}
            >
              บันทึกการแก้ไข
            </button>
          )}
          <div className={styles.adminActions}>
            <button
              type="button"
              className={styles.adminSecondaryBtn}
              disabled={pending}
              onClick={() => setConfirmation("reextract")}
            >
              สกัดใหม่
            </button>
            {!record.restricted && (
              <button
                type="button"
                className={`${styles.adminSecondaryBtn} ${styles.adminRejectBtn}`}
                disabled={pending}
                onClick={() => setConfirmation("reject")}
              >
                ถอดจากหน้าสาธารณะ
              </button>
            )}
          </div>
        </footer>
        {mode === "review" && (
          <AdminConfirmDialog
            open={confirmation === "approve"}
            title="ยืนยันและเผยแพร่ระเบียนนี้หรือไม่"
            body={`ยังมี ${FIELD_ORDER.length - verifiedCount} ฟิลด์ที่ไม่ได้ยืนยัน`}
            cancelLabel="ยกเลิก"
            confirmLabel="ยืนยันและเผยแพร่"
            tone="primary"
            onClose={() => setConfirmation(null)}
            onConfirm={() => run(() => approveRecordAction(record.id, pendingEdits), "ยืนยันและเผยแพร่แล้ว")}
          />
        )}
        <AdminConfirmDialog
          open={confirmation === "save"}
          title="บันทึกการแก้ไขหรือไม่"
          body="ค่าที่แก้ไขจะใช้กับระเบียนนี้ โดยต้นฉบับจะไม่ถูกเปลี่ยน"
          cancelLabel="ยกเลิก"
          confirmLabel="บันทึก"
          tone="primary"
          onClose={() => setConfirmation(null)}
          onConfirm={() => run(() => saveCorrections(record.id, pendingEdits), "บันทึกการแก้ไขแล้ว")}
        />
        <AdminConfirmDialog
          open={confirmation === "reextract"}
          title="สกัดข้อมูลใหม่หรือไม่"
          body={pendingEdits.length > 0 ? "ค่าที่ยังไม่บันทึกจะหายไป" : "โมเดลจะสกัดข้อมูลใหม่"}
          cancelLabel="ยกเลิก"
          confirmLabel="สกัดใหม่"
          tone="primary"
          onClose={() => setConfirmation(null)}
          onConfirm={() => run(() => reextractRecordAction(record.id), "ส่งกลับเข้าคิวสกัดใหม่แล้ว")}
        />
        <AdminConfirmDialog
          open={confirmation === "reject"}
          title={
            "ถอดระเบียนนี้จากหน้าสาธารณะหรือไม่"
          }
          body="ระเบียนจะไม่แสดงต่อสาธารณะ แต่ต้นฉบับจะยังเก็บไว้และคืนได้ภายหลัง"
          cancelLabel="ยกเลิก"
          confirmLabel="ถอดออก"
          tone="danger"
          reason={{ label: "เหตุผลที่ถอดออก" }}
          onClose={() => setConfirmation(null)}
          onConfirm={(reason) =>
            run(() => rejectRecordAction(record.id, reason ?? ""), "ถอดจากหน้าสาธารณะแล้ว")
          }
        />
      </section>
    </>
  );
}
