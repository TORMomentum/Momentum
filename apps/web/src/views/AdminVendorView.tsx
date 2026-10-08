"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { WHOLE_COUNTRY_AREA } from "@tor-radar/seeds";
import { AdminConfirmDialog } from "../features/admin/admin-confirm-dialog";
import {
  disableVendorAction,
  enableVendorAction,
  saveVendorProfileAction,
  sendMatchEmailAction,
  sendPasswordResetAction,
  sendVerificationEmailAction,
  setVendorRoleAction,
} from "../features/admin/admin-accounts.actions";
import styles from "../features/admin/admin.module.css";
import { ServiceAreaPicker } from "../features/profile/ServiceAreaPicker";
import { TaxonomyPicker } from "../features/profile/TaxonomyPicker";
import profileStyles from "../features/profile/profile.module.css";
import type { AccountRole, AdminAccountOpen, AdminVendorProfile } from "../shared/lib/admin-api";
import { BUDGET_PREFERENCE_MAX, BUDGET_PREFERENCE_MIN, BUDGET_PREFERENCE_STEP } from "../shared/lib/budget-preference";
import { BudgetRange } from "../shared/ui/BudgetRange";

/** The API's own Thai refusal, carried to the toast unchanged. */
class MatchEmailRefused extends Error {}

const AUDIT_LABELS: Record<string, string> = {
  viewed: "เปิดดูบัญชี",
  "profile-edited": "แก้ไขโปรไฟล์",
  "role-changed": "เปลี่ยนสิทธิ์",
  disabled: "ระงับบัญชี",
  enabled: "เปิดใช้บัญชี",
  "verification-email-sent": "ส่งอีเมลยืนยัน",
  "password-reset-sent": "ส่งลิงก์ตั้งรหัสผ่านใหม่",
  "match-email-sent": "ส่งอีเมล TOR ที่ตรงกัน",
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "—";

type Editable = Pick<AdminVendorProfile, "categories" | "areas" | "otherCategories" | "budget">;

/**
 * One vendor's account, for staff (NFR-S2). An admin never sees or sets a password — the reset
 * link is the way to fix one. Every action, including opening this screen, is in the audit list
 * at the bottom, and a profile saved here is marked to the vendor as changed by an admin.
 */
export function AdminVendorView({ opened }: { opened: AdminAccountOpen }) {
  const { account, audit } = opened;
  const [profile, setProfile] = useState<Editable>({
    categories: opened.profile.categories,
    areas: opened.profile.areas.length > 0 ? opened.profile.areas : [WHOLE_COUNTRY_AREA],
    otherCategories: opened.profile.otherCategories,
    budget: opened.profile.budget,
  });
  const [toast, setToast] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<"disable" | "role" | null>(null);
  const [pending, startTransition] = useTransition();
  const budget = profile.budget ?? { minThb: BUDGET_PREFERENCE_MIN, maxThb: BUDGET_PREFERENCE_MAX };
  const nextRole: AccountRole = account.role === "admin" ? "vendor" : "admin";

  /** An action may return its own message (the match email says how many it sent). */
  function run(action: () => Promise<void | string>, done: string): Promise<void> {
    setToast(null);
    const result = (async () => {
      try {
        const said = await action();
        setToast(typeof said === "string" ? said : done);
      } catch (error) {
        // A refusal the API worded for a person is shown as it is.
        if (error instanceof MatchEmailRefused) { setToast(error.message); return; }
        console.error("[admin/vendors] action failed", error);
        setToast("ทำรายการไม่สำเร็จ — ลองใหม่อีกครั้ง");
      }
    })();
    startTransition(() => result);
    return result;
  }

  return (
    <main className={styles.logPage}>
      <p className={styles.torsCount}><Link href="/admin/vendors">← ผู้ใช้ทั้งหมด</Link></p>
      <h1 className={styles.overviewTitle}>{account.displayName || account.email}</h1>
      <p className={styles.overviewLede}>
        {account.email} · {account.role === "admin" ? "ผู้ดูแล" : "ผู้ประกอบการ"} ·{" "}
        {account.disabled ? "ถูกระงับ" : account.verified ? "ยืนยันอีเมลแล้ว" : "ยังไม่ยืนยันอีเมล"} · สมัครเมื่อ {when(account.createdAt)}
        {account.consentWithdrawnAt ? ` · ถอนความยินยอมเมื่อ ${when(account.consentWithdrawnAt)}` : ""}
      </p>

      {toast && <div className={styles.adminToast} role="status">{toast}</div>}

      <section className={styles.vendorActions} aria-label="จัดการบัญชี">
        {!account.verified && (
          <button type="button" className={styles.adminSecondaryBtn} disabled={pending}
            onClick={() => void run(() => sendVerificationEmailAction(account.id), "✓ ส่งอีเมลยืนยันแล้ว")}>
            ส่งอีเมลยืนยันอีกครั้ง
          </button>
        )}
        {account.verified && !account.disabled && (
          <button type="button" className={styles.adminSecondaryBtn} disabled={pending}
            onClick={() => void run(() => sendPasswordResetAction(account.id), "✓ ส่งลิงก์ตั้งรหัสผ่านใหม่แล้ว — ผู้ใช้ตั้งรหัสเองจากลิงก์")}>
            ส่งลิงก์ตั้งรหัสผ่านใหม่
          </button>
        )}
        {account.verified && !account.disabled && (
          <button type="button" className={styles.adminSecondaryBtn} disabled={pending}
            onClick={() => void run(async () => {
              const result = await sendMatchEmailAction(account.id);
              if (!result.ok) throw new MatchEmailRefused(result.reason);
              return result.sent === 0
                ? "ตอนนี้ยังไม่มี TOR ที่เปิดรับและผ่านเกณฑ์ของผู้ใช้ — ไม่ได้ส่งอีเมล"
                : `✓ ส่งอีเมล TOR ที่ตรงกัน ${result.sent} รายการแล้ว`;
            }, "")}>
            ส่งอีเมล TOR ที่ตรงกันตอนนี้
          </button>
        )}
        <button type="button" className={styles.adminSecondaryBtn} disabled={pending} onClick={() => setConfirming("role")}>
          {nextRole === "admin" ? "ให้สิทธิ์ผู้ดูแล" : "เปลี่ยนเป็นผู้ประกอบการ"}
        </button>
        {account.disabled ? (
          <button type="button" className={styles.adminSecondaryBtn} disabled={pending}
            onClick={() => void run(() => enableVendorAction(account.id), "✓ เปิดใช้บัญชีแล้ว")}>
            เปิดใช้บัญชี
          </button>
        ) : (
          <button type="button" className={`${styles.adminSecondaryBtn} ${styles.adminRejectBtn}`} disabled={pending} onClick={() => setConfirming("disable")}>
            ระงับบัญชี
          </button>
        )}
      </section>

      <section className={profileStyles.profileCard}>
        <h2 className={profileStyles.profileFactTitle}>หมวดหมู่งาน</h2>
        <TaxonomyPicker
          value={profile.categories}
          other={profile.otherCategories}
          onChange={(categories) => setProfile((current) => ({ ...current, categories }))}
          onOtherChange={(otherCategories) => setProfile((current) => ({ ...current, otherCategories }))}
        />
      </section>

      <section className={profileStyles.profileCard}>
        <h2 className={profileStyles.profileFactTitle}>พื้นที่ให้บริการ</h2>
        <ServiceAreaPicker value={profile.areas} onChange={(areas) => setProfile((current) => ({ ...current, areas }))} />
      </section>

      <section className={`${profileStyles.profileCard} ${profileStyles.profileCardLast}`}>
        <h2 className={profileStyles.profileFactTitle}>ช่วงงบประมาณที่สนใจ</h2>
        <BudgetRange
          min={budget.minThb}
          max={budget.maxThb}
          floor={BUDGET_PREFERENCE_MIN}
          ceiling={BUDGET_PREFERENCE_MAX}
          step={BUDGET_PREFERENCE_STEP}
          onChange={(next) => setProfile((current) => ({ ...current, budget: { minThb: next.min, maxThb: next.max } }))}
        />
      </section>

      <div className={profileStyles.saveRow}>
        <button type="button" className={profileStyles.addSkillConfirm} disabled={pending}
          onClick={() => void run(() => saveVendorProfileAction(account.id, profile), "✓ บันทึกโปรไฟล์แล้ว — ผู้ใช้จะเห็นว่าแก้ไขโดยผู้ดูแล")}>
          บันทึกโปรไฟล์
        </button>
        <span className={styles.torsCount}>
          แก้ไขล่าสุด {when(opened.profile.updatedAt)}{opened.profile.updatedBy === "admin" ? " โดยผู้ดูแล" : ""}
        </span>
      </div>

      <h2 className={styles.vendorAuditTitle}>บันทึกการดำเนินการของผู้ดูแล</h2>
      {audit.length === 0 ? (
        <div className={styles.logEmpty}>ยังไม่มีรายการ</div>
      ) : (
        <table className={styles.logTable}>
          <thead><tr><th>เวลา</th><th>การดำเนินการ</th><th>โดย</th><th>รายละเอียด</th></tr></thead>
          <tbody>
            {audit.map((entry, index) => (
              <tr key={`${entry.at}-${index}`}>
                <td className={styles.logWhen}>{when(entry.at)}</td>
                <td>{AUDIT_LABELS[entry.action] ?? entry.action}</td>
                <td className={styles.logActor}>{entry.actor}</td>
                <td className={styles.logReason}>{entry.detail ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <AdminConfirmDialog
        open={confirming === "disable"}
        title="ระงับบัญชีนี้หรือไม่"
        body="ผู้ใช้จะเข้าสู่ระบบไม่ได้และถูกออกจากระบบทุกอุปกรณ์ทันที ข้อมูลของบัญชียังอยู่ครบ และเปิดใช้คืนได้ภายหลัง"
        cancelLabel="ยกเลิก"
        confirmLabel="ระงับบัญชี"
        tone="danger"
        reason={{ label: "เหตุผลที่ระงับ" }}
        onClose={() => setConfirming(null)}
        onConfirm={(reason) => run(() => disableVendorAction(account.id, reason ?? ""), "✓ ระงับบัญชีแล้ว")}
      />
      <AdminConfirmDialog
        open={confirming === "role"}
        title={nextRole === "admin" ? "ให้สิทธิ์ผู้ดูแลแก่บัญชีนี้หรือไม่" : "เปลี่ยนบัญชีนี้เป็นผู้ประกอบการหรือไม่"}
        body="การเปลี่ยนสิทธิ์จะทำให้บัญชีนี้ออกจากระบบทุกอุปกรณ์ แล้วต้องเข้าสู่ระบบใหม่"
        cancelLabel="ยกเลิก"
        confirmLabel="เปลี่ยนสิทธิ์"
        tone="primary"
        onClose={() => setConfirming(null)}
        onConfirm={() => run(() => setVendorRoleAction(account.id, nextRole), "✓ เปลี่ยนสิทธิ์แล้ว")}
      />
    </main>
  );
}
