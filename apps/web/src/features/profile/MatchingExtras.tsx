"use client";

import { CERTIFICATIONS, CGD_BRANCHES, PERSONAL_CERTIFICATION_IDS } from "@tor-radar/seeds";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PastProject, PersonnelMember, VendorCertifications } from "../../shared/api/profile.api";
import { formatBaht, thaiDigitsToArabic } from "../../shared/lib/format";
import { parseBaht } from "../../shared/ui/BudgetRange";
import profile from "./profile.module.css";
import styles from "./matching-extras.module.css";

const EXTRAS_URL = "/api/auth/me/profile/extras";

const NONE_STATED: VendorCertifications = { cgd: [], tags: [], other: [] };

type Draft = { title: string; year: string; value: string };
const EMPTY_DRAFT: Draft = { title: "", year: "", value: "" };

/**
 * Past work and certifications: optional, saved on their own (the main form
 * never sends them), and both read by matching — a past project lifts TORs
 * like it, and a missing กรมบัญชีกลาง registration lowers a large construction
 * TOR in that branch with the reason stated (ว642).
 *
 * Typed rather than uploaded for now. Reading a past-work certificate with AI
 * is the next step; the drop zone says so instead of pretending to work.
 */
export function MatchingExtras({
  initialProjects,
  initialCertifications,
  initialPersonnel = [],
}: {
  initialProjects: PastProject[];
  initialCertifications: VendorCertifications | null;
  initialPersonnel?: PersonnelMember[];
}) {
  const router = useRouter();
  const [projects, setProjects] = useState(initialProjects);
  const [certs, setCerts] = useState(initialCertifications ?? NONE_STATED);
  // "Not stated" is not "holds nothing" (the scorer lowers a score only for a stated answer), so the company's
  // certificates are sent only once the vendor has stated them here or already had.
  const [certsStated, setCertsStated] = useState(initialCertifications !== null);
  const [staff, setStaff] = useState(initialPersonnel);
  const [roleDraft, setRoleDraft] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [otherDraft, setOtherDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function change<T>(setter: (value: T) => void, value: T) {
    setter(value);
    setDirty(true);
    setMessage(null);
  }

  function stateCerts(value: VendorCertifications) {
    setCerts(value);
    setCertsStated(true);
  }

  function addProject() {
    const title = draft.title.trim();
    if (!title) return;
    const yearDigits = thaiDigitsToArabic(draft.year).replace(/[^0-9]/g, "");
    change(setProjects, [
      ...projects,
      { id: "", title, year: yearDigits ? Number(yearDigits) : null, valueThb: parseBaht(draft.value) },
    ]);
    setDraft(EMPTY_DRAFT);
  }

  const heldBranch = (branch: string) => certs.cgd.find((entry) => entry.branch === branch);

  function toggleBranch(branch: string) {
    change(stateCerts, {
      ...certs,
      cgd: heldBranch(branch) ? certs.cgd.filter((entry) => entry.branch !== branch) : [...certs.cgd, { branch }],
    });
  }

  function addOther() {
    const value = otherDraft.trim();
    if (!value || certs.other.includes(value)) return;
    change(stateCerts, { ...certs, other: [...certs.other, value] });
    setOtherDraft("");
  }

  function addPerson() {
    const role = roleDraft.trim();
    if (!role) return;
    change(setStaff, [...staff, { id: "", role, certifications: [], other: [] }]);
    setRoleDraft("");
  }

  function toggleStaffCertification(index: number, certification: string) {
    change(
      setStaff,
      staff.map((member, i) =>
        i !== index
          ? member
          : {
              ...member,
              certifications: member.certifications.includes(certification)
                ? member.certifications.filter((id) => id !== certification)
                : [...member.certifications, certification],
            },
      ),
    );
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(EXTRAS_URL, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          // A row added on this screen has no id yet; the server gives it one.
          pastProjects: projects.map(({ id, ...rest }) => (id ? { id, ...rest } : rest)),
          ...(certsStated ? { certifications: certs } : {}),
          personnel: staff.map(({ id, ...rest }) => (id ? { id, ...rest } : rest)),
        }),
      });
      if (response.status === 401) {
        setMessage("เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้งแล้วบันทึกใหม่");
        router.refresh();
        return;
      }
      if (!response.ok) {
        setMessage("บันทึกไม่สำเร็จ — ตรวจชื่อผลงานและปี (พ.ศ.) แล้วลองอีกครั้ง");
        return;
      }
      const saved = (await response.json()) as { pastProjects: PastProject[]; certifications: VendorCertifications | null; personnel?: PersonnelMember[] };
      setProjects(saved.pastProjects);
      setCerts(saved.certifications ?? NONE_STATED);
      setCertsStated(saved.certifications !== null);
      setStaff(saved.personnel ?? []);
      setDirty(false);
      setMessage("บันทึกแล้ว — ใช้ในการจับคู่ครั้งถัดไป");
    } catch {
      setMessage("เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`${profile.profileCard} ${profile.profileCardLast}`} aria-labelledby="extras-title">
      <h2 id="extras-title" className={profile.profileFactTitle}>สิ่งที่จะช่วยให้จับคู่แม่นขึ้น</h2>
      <p className={profile.profileSub}>ไม่บังคับ — ไม่กรอกก็ยังได้รับการจับคู่ตามปกติ</p>

      <h3 className={styles.heading}>ผลงานที่ผ่านมา</h3>
      <p className={profile.pickerHint}>งานที่คล้ายกับที่คุณเคยทำจะได้คะแนนเพิ่ม</p>

      <div className={styles.dropzone} aria-disabled="true">
        <span className={styles.dropIcon} aria-hidden="true">⬆</span>
        <span>
          อัปโหลดหนังสือรับรองผลงานให้ระบบอ่านให้
          <span className={styles.soon}>เร็วๆ นี้</span>
        </span>
      </div>

      {projects.length > 0 && (
        <ul className={styles.projectList}>
          {projects.map((project, index) => (
            <li key={project.id || `new-${index}`} className={styles.projectRow}>
              <span className={styles.projectTitle}>{project.title}</span>
              <span className={styles.projectMeta}>{project.year ?? "—"}</span>
              <span className={styles.projectMeta}>{project.valueThb !== null ? formatBaht(project.valueThb) : "—"}</span>
              <button
                type="button"
                className={styles.remove}
                aria-label={`ลบ ${project.title}`}
                onClick={() => change(setProjects, projects.filter((_, i) => i !== index))}
              >
                ลบ
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.addRow}>
        <input
          className={styles.input}
          placeholder="ชื่อผลงาน เช่น ก่อสร้างถนน คสล. หมู่ 5"
          aria-label="ชื่อผลงาน"
          value={draft.title}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          onKeyDown={(event) => event.key === "Enter" && addProject()}
        />
        <input
          className={`${styles.input} ${styles.inputYear}`}
          placeholder="ปี พ.ศ."
          aria-label="ปี พ.ศ."
          inputMode="numeric"
          value={draft.year}
          onChange={(event) => setDraft({ ...draft, year: event.target.value })}
        />
        <input
          className={`${styles.input} ${styles.inputValue}`}
          placeholder="มูลค่า (บาท)"
          aria-label="มูลค่าสัญญา (บาท)"
          inputMode="numeric"
          value={draft.value}
          onChange={(event) => setDraft({ ...draft, value: event.target.value })}
        />
        <button type="button" className={profile.addSkillPill} onClick={addProject} disabled={!draft.title.trim()}>
          + เพิ่มผลงาน
        </button>
      </div>

      <h3 className={styles.heading}>ใบอนุญาตและการรับรอง</h3>
      <p className={profile.pickerHint}>
        งานก่อสร้างตั้งแต่ ฿5 ล้านต้องขึ้นทะเบียนกรมบัญชีกลางในสาขาที่ตรงกัน (ว642) — ถ้ายังไม่ได้ขึ้นทะเบียน
        งานนั้นจะยังแสดง แต่คะแนนจะลดลงพร้อมบอกเหตุผล
      </p>

      {/* Pills, like every other choice on this profile. The registration class
          (ชั้น 1-5) is not asked: matching does not use it yet, and a question
          that changes nothing is friction. */}
      <p className={styles.subheading}>ขึ้นทะเบียนกรมบัญชีกลาง — งานก่อสร้างสาขา</p>
      <div className={profile.skillRow} role="group" aria-label="ขึ้นทะเบียนกรมบัญชีกลาง">
        {CGD_BRANCHES.map((branch) => {
          const on = Boolean(heldBranch(branch.id));
          return (
            <button
              type="button"
              key={branch.id}
              aria-pressed={on}
              className={`${profile.skillPill} ${on ? profile.skillPillOn : ""}`}
              onClick={() => toggleBranch(branch.id)}
            >
              {branch.th.replace(/^งานก่อสร้าง/, "")}
            </button>
          );
        })}
      </div>

      <p className={styles.subheading}>การรับรองอื่น</p>
      <p className={profile.pickerHint}>
        TOR ที่ระบุใบรับรองที่คุณมีจะได้คะแนนเพิ่ม ส่วนที่คุณยังไม่มีจะได้คะแนนลดลงพร้อมบอกเหตุผล — ไม่ซ่อนงาน
      </p>
      <div className={profile.skillRow} role="group" aria-label="การรับรองอื่น">
        {CERTIFICATIONS.map((item) => {
          const on = certs.tags.includes(item.id);
          return (
            <button
              type="button"
              key={item.id}
              aria-pressed={on}
              className={`${profile.skillPill} ${on ? profile.skillPillOn : ""}`}
              onClick={() => change(stateCerts, { ...certs, tags: on ? certs.tags.filter((tag) => tag !== item.id) : [...certs.tags, item.id] })}
            >
              {item.th}
            </button>
          );
        })}
        {certs.other.map((value) => (
          <button
            type="button"
            key={value}
            aria-pressed="true"
            className={`${profile.skillPill} ${profile.skillPillOn}`}
            title="คลิกเพื่อลบ"
            onClick={() => change(stateCerts, { ...certs, other: certs.other.filter((item) => item !== value) })}
          >
            {value} ×
          </button>
        ))}
      </div>
      <div className={styles.addRow}>
        <input
          className={styles.input}
          placeholder="อื่นๆ เช่น ใบอนุญาตประกอบกิจการ"
          aria-label="การรับรองอื่น"
          value={otherDraft}
          onChange={(event) => setOtherDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addOther()}
        />
        <button type="button" className={profile.addSkillPill} onClick={addOther} disabled={!otherDraft.trim()}>
          + เพิ่ม
        </button>
      </div>

      <h3 className={styles.heading}>บุคลากร</h3>
      <p className={profile.pickerHint}>
        TOR ส่วนใหญ่ขอบุคลากรที่ถือใบอนุญาต ไม่ใช่แค่ใบรับรองของบริษัท — ระบุตำแหน่งและใบอนุญาตที่มี
        ไม่ต้องใส่ชื่อ ข้อมูลนี้รวมอยู่ในการส่งออกและลบพร้อมบัญชี
      </p>
      {staff.length > 0 && (
        <ul className={styles.projectList}>
          {staff.map((member, index) => (
            <li key={member.id || `new-${index}`} className={styles.personRow}>
              <div className={styles.personHead}>
                <span className={styles.projectTitle}>{member.role}</span>
                <button
                  type="button"
                  className={styles.remove}
                  aria-label={`ลบ ${member.role}`}
                  onClick={() => change(setStaff, staff.filter((_, i) => i !== index))}
                >
                  ลบ
                </button>
              </div>
              <div className={profile.skillRow} role="group" aria-label={`ใบอนุญาตของ ${member.role}`}>
                {CERTIFICATIONS.filter((item) => (PERSONAL_CERTIFICATION_IDS as readonly string[]).includes(item.id)).map((item) => {
                  const on = member.certifications.includes(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={on}
                      className={`${profile.skillPill} ${on ? profile.skillPillOn : ""}`}
                      onClick={() => toggleStaffCertification(index, item.id)}
                    >
                      {item.th}
                    </button>
                  );
                })}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.addRow}>
        <input
          className={styles.input}
          placeholder="ตำแหน่ง เช่น วิศวกรโยธา"
          aria-label="ตำแหน่งบุคลากร"
          value={roleDraft}
          onChange={(event) => setRoleDraft(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addPerson()}
        />
        <button type="button" className={profile.addSkillPill} onClick={addPerson} disabled={!roleDraft.trim()}>
          + เพิ่มบุคลากร
        </button>
      </div>

      <div className={styles.saveRow}>
        <button type="button" className={profile.addSkillConfirm} onClick={save} disabled={!dirty || saving}>
          {saving ? "กำลังบันทึก…" : "บันทึกผลงานและใบอนุญาต"}
        </button>
        {message && <span className={profile.profileMessage} role="status">{message}</span>}
      </div>
    </section>
  );
}
