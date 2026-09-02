"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../features/app-shell/screens.module.css";
import { TOR_SAMPLES, type TorSample } from "../data/tor-samples";

/**
 * Vendor profile (FR-D). Ported from the "Vendor Profile" screen of
 * mockups/TOR Radar App.dc.html.
 *
 * The mockup's "starred" and "bookmarked" lists mirror star/bookmark toggles
 * made on the Search screen — but that is single-page mockup state, and this
 * app has Search and Profile as separate routes with no shared client store
 * (nothing in the established pattern, e.g. DashboardView, wires cross-route
 * state). So, consistent with the rest of this app treating its numbers as
 * placeholder sample data, the two lists below are seeded with representative
 * sample TORs rather than live state carried over from /search.
 */

const DEFAULT_SKILLS: Record<string, boolean> = {
  "Next.js": true,
  "GIS / แผนที่ดิจิทัล": true,
  "พัฒนาเว็บแอปพลิเคชัน": true,
  "Node.js / API": true,
  "ความปลอดภัยไซเบอร์": false,
};

const SAMPLE_STARRED_SLUGS = ["TOR-2569-0812-041", "TOR-2569-0810-029"];
const SAMPLE_BOOKED_SLUGS = ["demo-anomaly", "TOR-2569-0811-038"];

function statusFor(tor: TorSample) {
  return tor.open
    ? { text: `เปิดรับ · ${tor.deadlineNote.replace("เหลืออีก ", "")}`, className: styles.trackStatusOpen }
    : { text: "ปิดรับแล้ว", className: styles.trackStatusClosed };
}

export function VendorProfileView() {
  const [skillOn, setSkillOn] = useState<Record<string, boolean>>(DEFAULT_SKILLS);
  const [addingSkill, setAddingSkill] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const [freq, setFreq] = useState<"immediate" | "digest">("immediate");
  const [minMatch, setMinMatch] = useState(70);

  const skillNames = Object.keys(skillOn);
  const skillCount = skillNames.filter((name) => skillOn[name]).length;

  function toggleSkill(name: string) {
    setSkillOn((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  function addSkill() {
    const name = newSkill.trim();
    if (!name) return;
    setSkillOn((prev) => ({ ...prev, [name]: true }));
    setNewSkill("");
    setAddingSkill(false);
  }

  const starredList = SAMPLE_STARRED_SLUGS.map((slug) => TOR_SAMPLES.find((t) => t.slug === slug)).filter(
    (t): t is TorSample => Boolean(t),
  );
  const bookedList = SAMPLE_BOOKED_SLUGS.map((slug) => TOR_SAMPLES.find((t) => t.slug === slug)).filter(
    (t): t is TorSample => Boolean(t),
  );

  return (
    <main className={styles.profilePage}>
      <div className={styles.profileHead}>
        <span className={styles.profileAvatar} aria-hidden="true">
          น
        </span>
        <div>
          <h1 className={styles.profileName}>คุณนก วิภาดา</h1>
          <div className={styles.profileSub}>
            FREELANCE FULL-STACK · สมาชิกตั้งแต่ มี.ค. 2569 ·{" "}
            <span className={styles.profileComplete}>PROFILE 90% COMPLETE</span>
          </div>
        </div>
      </div>

      <div className={styles.profileCard}>
        <div className={`${styles.blockLabel} ${styles.blockLabelWide}`}>
          [ ทักษะ — จาก TAXONOMY กลาง · คลิกเพื่อเปิด/ปิด ]
        </div>
        <div className={styles.skillRow}>
          {skillNames.map((name) => (
            <button
              type="button"
              key={name}
              className={`${styles.skillPill} ${skillOn[name] ? styles.skillPillOn : ""}`}
              onClick={() => toggleSkill(name)}
            >
              {skillOn[name] ? name : `+ ${name}`}
            </button>
          ))}
          <button type="button" className={styles.addSkillPill} onClick={() => setAddingSkill((v) => !v)}>
            + เพิ่มทักษะ
          </button>
        </div>

        {addingSkill && (
          <div className={styles.addSkillRow}>
            <input
              className={styles.addSkillInput}
              value={newSkill}
              onChange={(e) => setNewSkill(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addSkill();
              }}
              placeholder="พิมพ์ชื่อทักษะ เช่น React Native…"
            />
            <button type="button" className={styles.addSkillConfirm} onClick={addSkill}>
              เพิ่ม
            </button>
            <button type="button" className={styles.addSkillCancel} onClick={() => setAddingSkill(false)}>
              ยกเลิก
            </button>
          </div>
        )}

        <div className={styles.skillCount}>ทักษะที่เปิดใช้: {skillCount} · มีผลต่อการจับคู่ทันที</div>

        <div className={styles.profileFactGrid}>
          <div>
            <div className={styles.profileFactTitle}>ช่วงงบประมาณที่สนใจ</div>
            <div className={styles.profileFactValue}>฿500K — ฿5M</div>
          </div>
          <div>
            <div className={styles.profileFactTitle}>ผลงานภาครัฐ</div>
            <div className={styles.profileFactText}>ระบบจองคิวออนไลน์ เทศบาลนครขอนแก่น (2568)</div>
          </div>
        </div>
      </div>

      <div className={styles.profileCard}>
        <div className={`${styles.blockLabel} ${styles.blockLabelWide}`}>[ การแจ้งเตือน ]</div>
        <div className={styles.notifyRow}>
          <div>
            <div className={styles.notifyTitle}>ความถี่อีเมล</div>
            <div className={styles.notifySub}>คะแนนจับคู่ขั้นต่ำ {minMatch}% · เฉพาะหมวดที่เลือก</div>
          </div>
          <div className={styles.notifyToggle}>
            <button
              type="button"
              className={`${styles.notifyToggleBtn} ${freq === "immediate" ? styles.notifyToggleBtnOn : ""}`}
              onClick={() => setFreq("immediate")}
            >
              ทันที
            </button>
            <button
              type="button"
              className={`${styles.notifyToggleBtn} ${freq === "digest" ? styles.notifyToggleBtnOn : ""}`}
              onClick={() => setFreq("digest")}
            >
              สรุปรายวัน
            </button>
          </div>
        </div>
        <div className={styles.matchSlider}>
          <input
            type="range"
            className={styles.matchRangeInput}
            min={50}
            max={95}
            step={5}
            value={minMatch}
            onChange={(e) => setMinMatch(Number(e.target.value))}
            aria-label="คะแนนจับคู่ขั้นต่ำ"
          />
          <div className={styles.matchSliderLabels}>
            <span>50%</span>
            <span className={styles.matchSliderActive}>ขั้นต่ำ {minMatch}%</span>
            <span>95%</span>
          </div>
        </div>
      </div>

      <div className={styles.profileCard}>
        <div className={styles.trackLabelRow}>
          <svg width="13" height="13" viewBox="0 0 24 24" className={styles.starIcon + " " + styles.starIconOn}>
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span className={`${styles.blockLabel} ${styles.blockLabelInline}`}>
            [ เคยทำงานลักษณะนี้ — ส่วนตัว ]
          </span>
        </div>
        {starredList.length > 0 ? (
          <div className={styles.trackList}>
            {starredList.map((tor) => (
              <Link key={tor.slug} href={`/tors/${tor.slug}`} className={styles.trackRow}>
                <div>
                  <div className={styles.trackTitle}>{tor.title}</div>
                  <div className={styles.trackAgency}>{tor.agency}</div>
                </div>
                <svg width="15" height="15" viewBox="0 0 24 24" className={styles.starIcon + " " + styles.starIconOn}>
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
              </Link>
            ))}
          </div>
        ) : (
          <div className={styles.trackEmpty}>ยังไม่มี — กดไอคอนดาวในหน้าค้นหาเพื่อบอกว่าเคยทำงานลักษณะนี้</div>
        )}
        <div className={styles.trackFoot}>ข้อมูลส่วนตัว — ใช้ปรับปรุงการจับคู่ของ AI เท่านั้น ไม่แสดงต่อสาธารณะ</div>
      </div>

      <div className={`${styles.profileCard} ${styles.profileCardLast}`}>
        <div className={styles.trackLabelRow}>
          <svg width="12" height="12" viewBox="0 0 24 24" className={styles.bookIcon + " " + styles.bookIconOn}>
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
          </svg>
          <span className={`${styles.blockLabel} ${styles.blockLabelInline}`}>
            [ บุ๊กมาร์ก — TOR ที่กำลังดู ]
          </span>
        </div>
        {bookedList.length > 0 ? (
          <div className={styles.trackList}>
            {bookedList.map((tor) => {
              const status = statusFor(tor);
              return (
                <Link key={tor.slug} href={`/tors/${tor.slug}`} className={styles.trackRow}>
                  <div>
                    <div className={styles.trackTitle}>{tor.title}</div>
                    <div className={styles.trackAgency}>{tor.agency}</div>
                  </div>
                  <span className={status.className}>{status.text}</span>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className={styles.trackEmpty}>ยังไม่มี — กดไอคอนบุ๊กมาร์กในหน้าค้นหาเพื่อเก็บ TOR ไว้ดูภายหลัง</div>
        )}
        <div className={styles.trackFoot}>บุ๊กมาร์กเป็นข้อมูลส่วนตัว — ไม่แสดงต่อสาธารณะ</div>
      </div>

      <div className={styles.pdpaLine}>
        PDPA: <a href="#">ส่งออกข้อมูลของฉัน</a> · <a href="#">ลบบัญชี</a> · ความยินยอมให้ไว้เมื่อ 12 มี.ค. 2569
      </div>
    </main>
  );
}
