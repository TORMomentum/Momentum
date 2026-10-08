"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useViewer } from "../shared/lib/viewer";
import { WHOLE_COUNTRY_AREA } from "@tor-radar/seeds";
import {
  BUDGET_PREFERENCE_MAX,
  BUDGET_PREFERENCE_MIN,
  BUDGET_PREFERENCE_STEP,
} from "../shared/lib/budget-preference";
import { BudgetRange } from "../shared/ui/BudgetRange";
import { NotifyPreferences, type Notify } from "../features/profile/NotifyPreferences";
import { ServiceAreaPicker } from "../features/profile/ServiceAreaPicker";
import { TaxonomyPicker } from "../features/profile/TaxonomyPicker";
import { MatchingExtras } from "../features/profile/MatchingExtras";
import { SavedTorsSection } from "../features/profile/SavedTorList";
import type { BookmarkRow } from "../shared/api/bookmarks.api";
import type { PastProject, VendorCertifications } from "../shared/api/profile.api";
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
  notify: Notify;
}

/** A vendor who has answered nothing yet still has a profile to edit. */
const EMPTY: Profile = {
  categories: [],
  areas: [WHOLE_COUNTRY_AREA],
  otherCategories: [],
  budget: null,
  notify: { preset: "daily", minMatch: 70, leadDays: 7, deadlineReminder: true, anomalyAlert: false },
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
    notify: profile.notify ?? EMPTY.notify,
  };
}

/** What the page reads: the form's fields plus the section the form does not own. */
type ProfileWithExtras = Profile & { pastProjects?: PastProject[]; certifications?: VendorCertifications | null };

export function VendorProfileView({ initial, bookmarks = null }: { initial: ProfileWithExtras | null; bookmarks?: BookmarkRow[] | null }) {
  const [profile, setProfile] = useState<Profile>(initial ? ownedFields(initial) : EMPTY);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(
    initial === null ? "ไม่สามารถโหลดโปรไฟล์ได้ในขณะนี้ การแก้ไขจะยังไม่ถูกบันทึก" : null,
  );

  // No work chosen means the profile has never been filled in, and there is
  // exactly one thing to do.
  const [settingUp, setSettingUp] = useState((initial?.categories.length ?? 0) === 0);
  const { account } = useViewer();
  const router = useRouter();
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
      // A session that has expired or been withdrawn is not a problem with what
      // was typed, and telling a vendor their profile "could not be saved" sends
      // them back to edit answers that were never the issue.
      if (response.status === 401) {
        setMessage("เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้งแล้วบันทึกใหม่");
        // The header and the rest of the page were rendered for someone signed
        // in; this makes the whole screen agree that they are not.
        router.refresh();
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
    <>
      <p className={styles.pickerHint}>
        {profile.budget
          ? "เลื่อนเพื่อปรับช่วง หรือกดล้างเพื่อกลับไปรับทุกช่วง"
          : "ยังไม่ได้ระบุ = รับทุกช่วงงบประมาณ เลื่อนด้านล่างเพื่อจำกัดช่วง"}
      </p>
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
      {profile.budget && (
        <button
          type="button"
          className={styles.factEdit}
          onClick={() => setProfile((current) => ({ ...current, budget: null }))}
        >
          ล้างช่วงงบประมาณ (รับทุกช่วง)
        </button>
      )}
    </>
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

  /** A label, what it is set to, and the way in to change it. */
  function settingRow(
    key: Section,
    title: string,
    note: string,
    values: string[],
    picker: React.ReactNode,
  ) {
    const open = editing === key;
    const empty = values.length === 0;
    return (
      <div className={styles.settingRow} key={key}>
        <div className={styles.settingLabel}>
          {title}
          <span className={styles.settingNote}>{note}</span>
        </div>
        {empty ? (
          <p className={styles.summaryEmpty}>ยังไม่ได้เลือก</p>
        ) : (
          <div className={styles.summaryRow}>
            {values.map((value) => (
              <span className={styles.summaryChip} key={value}>
                {value}
              </span>
            ))}
          </div>
        )}
        <button
          type="button"
          className={styles.factEdit}
          aria-expanded={open}
          onClick={() => setEditing(open ? null : key)}
        >
          {open ? "ปิด" : "แก้ไข"}
        </button>
        {open && <div className={styles.settingEditor}>{picker}</div>}
      </div>
    );
  }

  return (
    <main className={styles.profilePage}>
      <div className={styles.identity}>
        <div className={styles.identityAvatar} aria-hidden="true">
          {(account?.name ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className={styles.profileName}>{account?.name ?? "โปรไฟล์ผู้ประกอบการ"}</h1>
          {account && <div className={styles.identityEmail}>{account.email}</div>}
        </div>
      </div>

      <section className={styles.profileCard}>
        <h2 className={styles.profileFactTitle}>ข้อมูลที่ใช้จับคู่ TOR</h2>
        <p className={styles.profileSub}>แก้ไขได้ทุกเมื่อ มีผลกับการจับคู่ครั้งถัดไป</p>
        {settingRow(
          "categories",
          "หมวดหมู่งาน",
          "งานที่คุณรับทำ",
          describeCategories(profile.categories),
          categoryPicker,
        )}
        {settingRow(
          "areas",
          "พื้นที่ให้บริการ",
          "พื้นที่ที่คุณรับงาน ไม่ใช่ที่ตั้งหน่วยงาน",
          describeAreas(profile.areas),
          areaPicker,
        )}
        {settingRow(
          "budget",
          "ช่วงงบประมาณ",
          "เป็นความต้องการ ไม่ใช่เงื่อนไขตัดสิทธิ์",
          [describeBudget(profile.budget)],
          budgetPicker,
        )}
        {profile.otherCategories.length > 0 && (
          <div className={styles.settingRow}>
            <div className={styles.settingLabel}>
              อื่นๆ ที่คุณระบุเอง
              <span className={styles.settingNote}>ยังไม่ถูกใช้ในการจับคู่</span>
            </div>
            <div className={styles.summaryRow}>
              {profile.otherCategories.map((word) => (
                <span className={`${styles.summaryChip} ${styles.otherPill}`} key={word}>
                  {word}
                </span>
              ))}
            </div>
            <span />
          </div>
        )}
      </section>

      <section className={styles.profileCard}>
        <h2 className={styles.profileFactTitle}>การแจ้งเตือนทางอีเมล</h2>
        <p className={styles.profileSub}>
          เลือกความถี่และความใกล้เคียงที่ต้องการ — จะเริ่มส่งเมื่อระบบจับคู่พร้อมใช้งาน
        </p>
        <NotifyPreferences
          value={profile.notify}
          onChange={(notify) => setProfile((current) => ({ ...current, notify }))}
        />
      </section>

      <SavedTorsSection initial={bookmarks} />

      {/* Optional, and listed rather than nagged (§7.1): nothing here is marked
          missing. Saved on its own, so the form above never overwrites it. */}
      <MatchingExtras
        initialProjects={initial?.pastProjects ?? []}
        initialCertifications={initial?.certifications ?? null}
      />

      {saveRow}
    </main>
  );
}
