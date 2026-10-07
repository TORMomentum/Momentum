"use client";

import { useState } from "react";
import { WHOLE_COUNTRY_AREA } from "@tor-radar/seeds";
import {
  BUDGET_PREFERENCE_MAX,
  BUDGET_PREFERENCE_MIN,
  BUDGET_PREFERENCE_STEP,
} from "../shared/lib/budget-preference";
import { BudgetRange } from "../shared/ui/BudgetRange";
import { ServiceAreaPicker } from "../features/profile/ServiceAreaPicker";
import { TaxonomyPicker } from "../features/profile/TaxonomyPicker";
import {
  describeAreas,
  describeBudget,
  describeCategories,
} from "../features/profile/profile-summary";
import styles from "../features/profile/profile.module.css";

/**
 * The vendor's own answer to three questions, and nothing else (profile and
 * matching design §7.1): what they do, where they will do it, and what size of
 * work they want.
 *
 * The screen has two states (§7.1.1). A profile nobody has filled in leads with
 * the pickers, because there is exactly one thing to do. A profile that has
 * been answered leads with the ANSWERS — a vendor coming back is owed their own
 * words, not the sixty-five choices they already worked through — and each
 * section opens for editing on its own.
 */

interface Profile {
  categories: string[];
  areas: string[];
  /** Work the taxonomy has no node for. Kept, but not matched against. */
  otherCategories: string[];
  budget: { minThb: number; maxThb: number } | null;
}

/** A vendor who has answered nothing yet still has a profile to edit. */
const EMPTY: Profile = {
  categories: [],
  areas: [WHOLE_COUNTRY_AREA],
  otherCategories: [],
  budget: null,
};

/** The account's own routes, reached through the handler that holds the cookie. */
const PROFILE_URL = "/api/auth/me/profile";

type Section = "categories" | "areas" | "budget";

/**
 * The vendor's own answers, and nothing the server owns.
 *
 * A reply also carries `taxonomyVersion` and `updatedAt`, which the API stamps.
 * Holding the whole reply in state and posting it back sent those with it, and
 * the API — rightly strict about what it accepts — refused the save.
 */
function ownedFields(profile: Profile): Profile {
  return {
    categories: profile.categories,
    areas: profile.areas,
    otherCategories: profile.otherCategories ?? [],
    budget: profile.budget,
  };
}

export function VendorProfileView({ initial }: { initial: Profile | null }) {
  const [profile, setProfile] = useState<Profile>(initial ? ownedFields(initial) : EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(
    initial === null ? "ไม่สามารถโหลดโปรไฟล์ได้ในขณะนี้ การแก้ไขจะยังไม่ถูกบันทึก" : null,
  );

  // No work chosen means the profile has never been filled in, and there is
  // exactly one thing to do.
  const [settingUp, setSettingUp] = useState((initial?.categories.length ?? 0) === 0);
  const [editing, setEditing] = useState<Section | null>(null);

  async function save() {
    setMessage(null);
    setSaving(true);
    try {
      const response = await fetch(PROFILE_URL, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ownedFields(profile)),
      });
      if (response.ok) {
        setProfile(ownedFields((await response.json()) as Profile));
        setMessage("บันทึกโปรไฟล์แล้ว");
        // The questions have been answered; from here the screen is for seeing
        // and correcting them.
        setSettingUp(false);
        setEditing(null);
        return;
      }
      // The server names the field it refused, in Thai, and saying which one
      // beats a generic failure that leaves a vendor guessing at their own
      // data. Anything NOT in Thai is a validator's default — a fault in this
      // code rather than in what was typed — so it is not put in front of them.
      const body = (await response.json().catch(() => null)) as
        | { error?: { issues?: Array<{ message: string }> } }
        | null;
      const stated = (body?.error?.issues ?? [])
        .map((issue) => issue.message)
        .filter((text) => /[฀-๿]/.test(text));
      setMessage(stated.length > 0 ? stated.join(" ") : "ไม่สามารถบันทึกโปรไฟล์ได้");
    } catch {
      setMessage("เชื่อมต่อไม่ได้ในขณะนี้");
    } finally {
      setSaving(false);
    }
  }

  const categoryPicker = (
    <TaxonomyPicker
      value={profile.categories}
      other={profile.otherCategories}
      onChange={(categories) => setProfile((current) => ({ ...current, categories }))}
      onOtherChange={(otherCategories) => setProfile((current) => ({ ...current, otherCategories }))}
    />
  );

  const areaPicker = (
    <ServiceAreaPicker
      value={profile.areas}
      onChange={(areas) => setProfile((current) => ({ ...current, areas }))}
    />
  );

  const budgetValue = profile.budget ?? {
    minThb: BUDGET_PREFERENCE_MIN,
    maxThb: BUDGET_PREFERENCE_MAX,
  };
  const budgetPicker = (
    <BudgetRange
      min={budgetValue.minThb}
      max={budgetValue.maxThb}
      floor={BUDGET_PREFERENCE_MIN}
      ceiling={BUDGET_PREFERENCE_MAX}
      step={BUDGET_PREFERENCE_STEP}
      onChange={(next) =>
        setProfile((current) => ({ ...current, budget: { minThb: next.min, maxThb: next.max } }))
      }
    />
  );

  const saveRow = (
    <div className={styles.saveRow}>
      <button type="button" className={styles.addSkillConfirm} onClick={save} disabled={saving}>
        {saving ? "กำลังบันทึก…" : settingUp ? "บันทึกและเริ่มใช้งาน" : "บันทึกการเปลี่ยนแปลง"}
      </button>
      {message && (
        <span className={styles.profileMessage} role="status">
          {message}
        </span>
      )}
    </div>
  );

  if (settingUp) {
    return (
      <main className={styles.profilePage}>
        <header className={styles.profileHead}>
          <div>
            <h1 className={styles.profileName}>ตั้งค่าโปรไฟล์ครั้งแรก</h1>
            <p className={styles.profileSub}>
              ตอบ 3 ข้อนี้ครั้งเดียว แล้ว TOR ที่ตรงกับคุณจะถูกจับคู่ให้อัตโนมัติ —
              เพิ่มรายละเอียดอื่นภายหลังได้
            </p>
          </div>
        </header>

        <section className={styles.profileCard}>
          <h2 className={styles.profileFactTitle}>หมวดหมู่งาน</h2>
          <p className={styles.profileSub}>เลือกได้ทั้งกลุ่มงานหรือเฉพาะงานย่อย</p>
          {categoryPicker}
        </section>

        <section className={styles.profileCard}>
          <h2 className={styles.profileFactTitle}>พื้นที่ให้บริการ</h2>
          <p className={styles.profileSub}>พื้นที่ที่คุณรับทำงาน ไม่ใช่ที่ตั้งของหน่วยงานที่ประกาศ</p>
          {areaPicker}
        </section>

        <section className={`${styles.profileCard} ${styles.profileCardLast}`}>
          <h2 className={styles.profileFactTitle}>ช่วงงบประมาณที่สนใจ</h2>
          <p className={styles.profileSub}>
            เป็นความต้องการของคุณ ใช้เป็นสัญญาณประกอบการจับคู่ ไม่ใช่เงื่อนไขตัดสิทธิ์
          </p>
          {budgetPicker}
        </section>

        {saveRow}
      </main>
    );
  }

  function section(key: Section, title: string, values: string[], picker: React.ReactNode) {
    const open = editing === key;
    return (
      <section className={styles.profileCard}>
        <div className={styles.profileFactHead}>
          <h2 className={styles.profileFactTitle}>{title}</h2>
          <button
            type="button"
            className={styles.factEdit}
            aria-expanded={open}
            onClick={() => setEditing(open ? null : key)}
          >
            {open ? "ปิด" : "แก้ไข"}
          </button>
        </div>
        {open ? (
          picker
        ) : (
          <div className={styles.summaryRow}>
            {values.map((value) => (
              <span className={styles.summaryChip} key={value}>
                {value}
              </span>
            ))}
          </div>
        )}
      </section>
    );
  }

  return (
    <main className={styles.profilePage}>
      <header className={styles.profileHead}>
        <div>
          <h1 className={styles.profileName}>โปรไฟล์ผู้ประกอบการ</h1>
          <p className={styles.profileSub}>ข้อมูลนี้ถูกใช้จับคู่ TOR ให้คุณ แก้ไขได้ทุกเมื่อ</p>
        </div>
      </header>

      {section("categories", "หมวดหมู่งาน", describeCategories(profile.categories), categoryPicker)}
      {section("areas", "พื้นที่ให้บริการ", describeAreas(profile.areas), areaPicker)}
      {section("budget", "ช่วงงบประมาณที่สนใจ", [describeBudget(profile.budget)], budgetPicker)}

      {profile.otherCategories.length > 0 && (
        <section className={styles.profileCard}>
          <h2 className={styles.profileFactTitle}>อื่นๆ ที่คุณระบุเอง</h2>
          <p className={styles.pickerHint}>
            ยังไม่ถูกใช้ในการจับคู่ แต่เราเก็บไว้เพื่อเพิ่มประเภทงานให้ครอบคลุมขึ้น
          </p>
          <div className={styles.summaryRow}>
            {profile.otherCategories.map((word) => (
              <span className={`${styles.summaryChip} ${styles.otherPill}`} key={word}>
                {word}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Listed, never nagged: neither is required to receive alerts (§7.1), so
          nothing here is marked missing or incomplete. The prompt that asks for
          a credential at the moment it would have changed an alert needs
          matching to know that moment, so it arrives with matching rather than
          standing here as a permanent banner. */}
      <section className={`${styles.profileCard} ${styles.profileCardLast}`}>
        <h2 className={styles.profileFactTitle}>สิ่งที่จะช่วยให้จับคู่แม่นขึ้น</h2>
        <p className={styles.profileSub}>ไม่บังคับ — ไม่กรอกก็ยังได้รับการแจ้งเตือนตามปกติ</p>
        <ul className={styles.laterList}>
          <li>
            <strong>ใบอนุญาตและการรับรอง</strong> — ใช้คัดงานที่ระบุคุณสมบัติบังคับออก
            เพื่อไม่ให้ได้รับแจ้งเตือนที่คุณยื่นไม่ได้
          </li>
          <li>
            <strong>ผลงานที่ผ่านมา</strong> — ใช้เพิ่มน้ำหนักให้งานที่คล้ายกับที่คุณเคยทำ
          </li>
        </ul>
        <p className={styles.pickerHint}>ทั้งสองอย่างจะเปิดให้เพิ่มเมื่อระบบจับคู่เริ่มทำงาน</p>
      </section>

      {saveRow}
    </main>
  );
}
