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
import styles from "../features/profile/profile.module.css";

/**
 * The vendor's own answer to three questions, and nothing else (profile and
 * matching design §7.1): what they do, where they will do it, and what size of
 * work they want. Certifications and past projects are asked for later, from
 * the dashboard, at the moment each one would have changed an alert.
 *
 * Everything here is loaded from and saved to the account's profile. The screen
 * this replaced held every value in component state on a hardcoded default and
 * persisted nothing, including a "90% complete" that was a literal.
 */

interface Profile {
  categories: string[];
  areas: string[];
  /** Work the taxonomy has no node for. Kept, but not matched against. */
  otherCategories: string[];
  budget: { minThb: number; maxThb: number } | null;
}

/** A vendor who has answered nothing yet still has a profile to edit. */
const EMPTY: Profile = { categories: [], areas: [WHOLE_COUNTRY_AREA], otherCategories: [], budget: null };

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

/** The account's own routes, reached through the handler that holds the cookie. */
const PROFILE_URL = "/api/auth/me/profile";

export function VendorProfileView({ initial }: { initial: Profile | null }) {
  // Read on the server from the session cookie and handed in, so the vendor's
  // own answers are in the first paint rather than a round trip later.
  const [profile, setProfile] = useState<Profile>(initial ? ownedFields(initial) : EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(
    initial === null ? "ไม่สามารถโหลดโปรไฟล์ได้ในขณะนี้ การแก้ไขจะยังไม่ถูกบันทึก" : null,
  );

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
        .filter((message) => /[฀-๿]/.test(message));
      setMessage(stated.length > 0 ? stated.join(" ") : "ไม่สามารถบันทึกโปรไฟล์ได้");
    } catch {
      setMessage("เชื่อมต่อไม่ได้ในขณะนี้");
    } finally {
      setSaving(false);
    }
  }

  // Computed from what is actually filled in. A number here that did not follow
  // from the data would be telling the vendor something untrue about their own
  // matching.
  const ready = profile.categories.length > 0 && profile.areas.length > 0;
  const budget = profile.budget ?? { minThb: BUDGET_PREFERENCE_MIN, maxThb: BUDGET_PREFERENCE_MAX };

  return (
    <main className={styles.profilePage}>
      <header className={styles.profileHead}>
        <div>
          <h1 className={styles.profileName}>โปรไฟล์ผู้ประกอบการ</h1>
          <p className={styles.profileSub}>
            {ready
              ? "ข้อมูลพร้อมสำหรับใช้ประกอบการจับคู่"
              : "เลือกหมวดหมู่งานและพื้นที่ให้บริการ เพื่อให้การจับคู่เริ่มทำงานได้"}
          </p>
        </div>
      </header>

      <section className={styles.profileCard}>
        <h2 className={styles.profileFactTitle}>หมวดหมู่งาน</h2>
        <p className={styles.profileSub}>เลือกได้ทั้งกลุ่มงานหรือเฉพาะงานย่อย</p>
        <TaxonomyPicker
          value={profile.categories}
          other={profile.otherCategories}
          onChange={(categories) => setProfile((current) => ({ ...current, categories }))}
          onOtherChange={(otherCategories) => setProfile((current) => ({ ...current, otherCategories }))}
        />
      </section>

      <section className={styles.profileCard}>
        <h2 className={styles.profileFactTitle}>พื้นที่ให้บริการ</h2>
        <p className={styles.profileSub}>พื้นที่ที่คุณรับทำงาน ไม่ใช่ที่ตั้งของหน่วยงานที่ประกาศ</p>
        <ServiceAreaPicker
          value={profile.areas}
          onChange={(areas) => setProfile((current) => ({ ...current, areas }))}
        />
      </section>

      <section className={`${styles.profileCard} ${styles.profileCardLast}`}>
        <h2 className={styles.profileFactTitle}>ช่วงงบประมาณที่สนใจ</h2>
        <p className={styles.profileSub}>
          เป็นความต้องการของคุณ ใช้เป็นสัญญาณประกอบการจับคู่ ไม่ใช่เงื่อนไขตัดสิทธิ์
        </p>
        <BudgetRange
          min={budget.minThb}
          max={budget.maxThb}
          floor={BUDGET_PREFERENCE_MIN}
          ceiling={BUDGET_PREFERENCE_MAX}
          step={BUDGET_PREFERENCE_STEP}
          onChange={(next) =>
            setProfile((current) => ({ ...current, budget: { minThb: next.min, maxThb: next.max } }))
          }
        />
      </section>

      <div className={styles.saveRow}>
        <button type="button" className={styles.addSkillConfirm} onClick={save} disabled={saving}>
          {saving ? "กำลังบันทึก…" : "บันทึกโปรไฟล์"}
        </button>
        {message && (
          <span className={styles.profileMessage} role="status">
            {message}
          </span>
        )}
      </div>
    </main>
  );
}
