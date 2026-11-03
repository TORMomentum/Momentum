"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { AdminBulkAction, AdminTorKind, AdminTorStatus } from "../../shared/lib/admin-api";
import { AdminConfirmDialog } from "./admin-confirm-dialog";
import { bulkTorsAction, selectAllTorsAction } from "./admin.actions";
import styles from "./admin.module.css";

export interface AdminTorsTableRow {
  id: string;
  title: string;
  invitation: boolean;
  agency: string;
  projectNumber: string | null;
  status: { label: string; tone: string };
  createdAt: string;
}

const ACTIONS: Record<AdminBulkAction, { button: string; title: string; body: string; confirm: string; tone: "danger" | "primary" }> = {
  reextract: {
    button: "สกัดใหม่",
    title: "สกัดใหม่ทั้งหมดที่เลือก",
    body: "ระเบียนที่เลือกจะกลับเข้าคิวสกัดข้อมูล ค่าที่สกัดไว้จะถูกแทนด้วยผลใหม่ และการเรียก AI แต่ละครั้งมีค่าใช้จ่าย",
    confirm: "สกัดใหม่",
    tone: "primary",
  },
  reject: {
    button: "ถอดจากหน้าสาธารณะ",
    title: "ถอดที่เลือกออกจากหน้าสาธารณะ",
    body: "ระเบียนจะไม่แสดงต่อสาธารณะ เอกสารต้นฉบับยังเก็บไว้ครบ และคืนกลับได้ภายหลัง ทุกระเบียนจะถูกบันทึกพร้อมเหตุผลนี้",
    confirm: "ถอดจากหน้าสาธารณะ",
    tone: "danger",
  },
  restore: {
    button: "คืนสู่หน้าสาธารณะ",
    title: "คืนที่เลือกสู่หน้าสาธารณะ",
    body: "ระเบียนที่ถูกถอดไว้จะกลับมาแสดงต่อสาธารณะ ระเบียนที่ไม่ได้ถูกถอดจะถูกข้ามไป",
    confirm: "คืนสู่หน้าสาธารณะ",
    tone: "primary",
  },
};

/**
 * The all-TORs table, with selection: tick rows (or the whole page), then act
 * on all of them at once. Each TOR still goes through the same audited change
 * as its own page; any the API refuses are listed with the reason.
 */
export function AdminTorsTable({
  rows,
  linkSuffix,
  query,
  total,
}: {
  rows: AdminTorsTableRow[];
  linkSuffix: string;
  /** The list's current filters, for "select everything matching". */
  query: { q?: string; status: AdminTorStatus; kind: AdminTorKind };
  /** How many TORs match those filters, across every page. */
  total: number;
}) {
  // How many ids one bulk request may carry; the API states it with the ids.
  const [chunk, setChunk] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<AdminBulkAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allOnPage = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function selectAllMatching() {
    setMessage(null);
    const outcome = await selectAllTorsAction(query);
    if (!outcome.ok) {
      setMessage(outcome.reason);
      return;
    }
    setChunk(outcome.chunk);
    setSelected(new Set(outcome.ids));
    if (outcome.ids.length < outcome.total) setMessage(`เลือกได้ครั้งละไม่เกิน ${outcome.ids.length} รายการ — เลือกไว้ ${outcome.ids.length} รายการล่าสุด`);
  }

  async function run(action: AdminBulkAction, reason?: string) {
    const ids = [...selected];
    // Sent a chunk at a time — the API's per-request cap — with progress, so
    // hundreds of TORs neither hit the cap nor sit behind one long request.
    const size = chunk ?? ids.length;
    const done: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (let start = 0; start < ids.length; start += size) {
      if (ids.length > size) setMessage(`กำลังดำเนินการ ${Math.min(start + size, ids.length)} / ${ids.length} รายการ…`);
      const outcome = await bulkTorsAction(action, ids.slice(start, start + size), reason);
      if (!outcome.ok) {
        failed.push(...ids.slice(start).map((id) => ({ id, reason: outcome.reason })));
        break;
      }
      done.push(...outcome.result.done);
      failed.push(...outcome.result.failed);
    }
    setMessage(
      failed.length === 0
        ? `✓ ${ACTIONS[action].confirm}แล้ว ${done.length} รายการ`
        : `✓ ${ACTIONS[action].confirm}แล้ว ${done.length} รายการ · ไม่สำเร็จ ${failed.length} รายการ: ${[...new Set(failed.map((item) => item.reason))].join(" · ")}`,
    );
    // What failed stays selected, so it can be looked at or tried again.
    setSelected(new Set(failed.map((item) => item.id)));
  }

  return (
    <>
      {selected.size > 0 && (
        <div className={styles.bulkBar} role="region" aria-label="จัดการที่เลือก">
          <span className={styles.bulkCount}>เลือก {selected.size} รายการ</span>
          {(Object.keys(ACTIONS) as AdminBulkAction[]).map((action) => (
            <button
              key={action}
              type="button"
              className={`${styles.adminSecondaryBtn} ${action === "reject" ? styles.adminRejectBtn : ""}`}
              disabled={pending}
              onClick={() => setConfirming(action)}
            >
              {ACTIONS[action].button}
            </button>
          ))}
          <button type="button" className={styles.bulkClear} onClick={() => setSelected(new Set())} disabled={pending}>
            ล้างที่เลือก
          </button>
        </div>
      )}
      {allOnPage && total > rows.length && selected.size < total && (
        <p className={styles.selectAllNote}>
          เลือกครบ {rows.length} รายการในหน้านี้แล้ว ·{" "}
          <button type="button" className={styles.selectAllLink} onClick={() => void selectAllMatching()} disabled={pending}>
            เลือกทั้งหมด {total.toLocaleString("th-TH")} รายการที่ตรงกับตัวกรอง
          </button>
        </p>
      )}
      {message && <div className={styles.adminToast} role="status">{message}</div>}

      <table className={styles.logTable}>
        <thead>
          <tr>
            <th className={styles.selectCell}>
              <input
                type="checkbox"
                aria-label="เลือกทั้งหน้านี้"
                checked={allOnPage}
                onChange={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    for (const row of rows) {
                      if (allOnPage) next.delete(row.id);
                      else next.add(row.id);
                    }
                    return next;
                  })
                }
              />
            </th>
            <th>ชื่อโครงการ</th>
            <th>หน่วยงาน</th>
            <th>เลขที่โครงการ</th>
            <th>สถานะ</th>
            <th>เข้าระบบ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={selected.has(row.id) ? styles.rowSelected : undefined}>
              <td className={styles.selectCell}>
                <input
                  type="checkbox"
                  aria-label={`เลือก ${row.title || row.id}`}
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                />
              </td>
              <td>
                <Link href={`/admin/tors/${row.id}${linkSuffix}`}>{row.title || "ยังไม่มีชื่อ — ยังไม่ได้สกัด"}</Link>
                {row.invitation && <span className={styles.torsKind}>ประกาศเชิญชวน</span>}
              </td>
              <td>{row.agency || "—"}</td>
              <td className={styles.logWhen}>{row.projectNumber ?? "—"}</td>
              <td>
                <span className={`${styles.torsStatus} ${row.status.tone}`}>{row.status.label}</span>
              </td>
              <td className={styles.logWhen}>
                {new Date(row.createdAt).toLocaleDateString("th-TH", { dateStyle: "medium" })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {confirming && (
        <AdminConfirmDialog
          open
          title={`${ACTIONS[confirming].title} (${selected.size} รายการ)`}
          body={ACTIONS[confirming].body}
          cancelLabel="ยกเลิก"
          confirmLabel={ACTIONS[confirming].confirm}
          tone={ACTIONS[confirming].tone}
          {...(confirming === "reject" ? { reason: { label: "เหตุผล (บันทึกกับทุกระเบียนที่เลือก)" } } : {})}
          onClose={() => setConfirming(null)}
          onConfirm={(reason) => new Promise<void>((resolve) => startTransition(async () => { await run(confirming, reason); resolve(); }))}
        />
      )}
    </>
  );
}
