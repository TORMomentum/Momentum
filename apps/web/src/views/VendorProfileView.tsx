"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../features/app-shell/screens.module.css";
import styles2 from "../features/app-shell/screens-2.module.css";
import { TOR_SAMPLES, type TorSample } from "../data/tor-samples";
import { useViewer } from "../shared/lib/viewer";

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

/**
 * Notification presets — matches the mockup's `presets` array. Picking one
 * sets the minimum-match slider below to that preset's threshold, which the
 * "การตั้งค่าขั้นสูง" disclosure then lets the vendor fine-tune further.
 */
const NOTIFY_PRESETS = [
  {
    key: "all" as const,
    title: "ทุกงานที่เกี่ยวข้อง",
    desc: "อีเมลทันทีทุกครั้งที่มี TOR ตรงกับทักษะ (≥ 50%)",
    minMatch: 50,
  },
  {
    key: "balanced" as const,
    title: "สรุปรายวัน (แนะนำ)",
    desc: "อีเมลวันละครั้ง รวมงานที่ตรง ≥ 70% + เตือนก่อนหมดเขต",
    minMatch: 70,
  },
  {
    key: "few" as const,
    title: "เฉพาะงานที่ตรงมาก",
    desc: "อีเมลเฉพาะงานที่ตรง ≥ 85% เท่านั้น",
    minMatch: 85,
  },
];

const LEAD_OPTIONS = [3, 7, 14];

const EXTRA_OPTIONS = [
  {
    key: "deadline" as const,
    label: "เตือน TOR ที่บุ๊กมาร์กใกล้หมดเขต",
    note: "ตามจำนวนวันที่เลือกด้านบน",
  },
  {
    key: "anomaly" as const,
    label: "เตือนเมื่อพบความผิดปกติทางสถิติ",
    note: "เหมาะกับนักข่าว/นักวิจัย — ไม่ใช่ข้อกล่าวหา",
  },
];

function statusFor(tor: TorSample) {
  return tor.open
    ? { text: `เปิดรับ · ${tor.deadlineNote.replace("เหลืออีก ", "")}`, className: styles.trackStatusOpen }
    : { text: "ปิดรับแล้ว", className: styles.trackStatusClosed };
}

export function VendorProfileView() {
  const { account } = useViewer();
  const [skillOn, setSkillOn] = useState<Record<string, boolean>>(DEFAULT_SKILLS);
  const [addingSkill, setAddingSkill] = useState(false);
  const [newSkill, setNewSkill] = useState("");
  const [preset, setPreset] = useState<"all" | "balanced" | "few">("balanced");
  const [minMatch, setMinMatch] = useState(70);
  const [advanced, setAdvanced] = useState(false);
  const [lead, setLead] = useState(7);
  const [extras, setExtras] = useState({ deadline: true, anomaly: false });

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
      {/* Name and email are the signed-in account's own; everything below is
          still sample data until slice 4 stores a real vendor profile. */}
      <div className={styles.profileHead}>
        <span className={styles.profileAvatar} aria-hidden="true">
          {account?.name.trim().charAt(0) || "ผ"}
        </span>
        <div>
          <h1 className={styles.profileName}>{account?.name}</h1>
          <div className={styles.profileSub}>
            {account?.email} ·{" "}
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
        <div id="notif-settings" className={`${styles.blockLabel} ${styles.blockLabelWide}`}>
          [ การแจ้งเตือน ]
        </div>
        <div className={styles2.notifyIntro}>เลือกรูปแบบที่ใกล้เคียงที่สุด — ปรับละเอียดได้ภายหลัง</div>

        <div className={styles2.presetList}>
          {NOTIFY_PRESETS.map((p) => (
            <button
              type="button"
              key={p.key}
              className={`${styles2.presetCard} ${preset === p.key ? styles2.presetCardOn : ""}`}
              onClick={() => {
                setPreset(p.key);
                setMinMatch(p.minMatch);
              }}
            >
              <span className={`${styles2.presetDot} ${preset === p.key ? styles2.presetDotOn : ""}`} />
              <span>
                <div className={styles2.presetTitle}>{p.title}</div>
                <div className={styles2.presetDesc}>{p.desc}</div>
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className={styles2.advancedToggle}
          onClick={() => setAdvanced((v) => !v)}
        >
          <span className={`${styles2.advancedArrow} ${advanced ? styles2.advancedArrowOpen : ""}`}>▾</span>
          <span className={styles2.advancedLabel}>
            {advanced ? "ซ่อนการตั้งค่าขั้นสูง" : "การตั้งค่าขั้นสูง"}
          </span>
        </button>

        {advanced && (
          <div className={styles2.advancedPanel}>
            <div>
              <div className={styles2.advancedRow}>
                <span className={styles2.advancedRowTitle}>คะแนนจับคู่ขั้นต่ำ</span>
                <span className={styles2.advancedRowValue}>{minMatch}%</span>
              </div>
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
              <div className={styles2.advancedSliderLabels}>
                <span>50% (กว้าง)</span>
                <span>95% (เฉพาะที่ตรงมาก)</span>
              </div>
            </div>

            <div>
              <div className={styles2.leadGroupTitle}>เตือนก่อนกำหนดยื่นซอง</div>
              <div className={styles2.leadGroup}>
                {LEAD_OPTIONS.map((n) => (
                  <button
                    type="button"
                    key={n}
                    className={`${styles2.leadOption} ${lead === n ? styles2.leadOptionOn : ""}`}
                    onClick={() => setLead(n)}
                  >
                    {n} วัน
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className={styles2.extraGroupTitle}>แจ้งเตือนเพิ่มเติม</div>
              <div className={styles2.extraList}>
                {EXTRA_OPTIONS.map((x) => (
                  <button
                    type="button"
                    key={x.key}
                    className={styles2.extraRow}
                    onClick={() => setExtras((prev) => ({ ...prev, [x.key]: !prev[x.key] }))}
                  >
                    <span>
                      <div className={styles2.extraLabel}>{x.label}</div>
                      <div className={styles2.extraNote}>{x.note}</div>
                    </span>
                    <span className={`${styles2.switchTrack} ${extras[x.key] ? styles2.switchTrackOn : ""}`}>
                      <span className={`${styles2.switchKnob} ${extras[x.key] ? styles2.switchKnobOn : ""}`} />
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className={styles2.advancedFoot}>
              อีเมลส่งภายใน 5 นาทีหลัง TOR เผยแพร่ · ยกเลิกการรับได้ทุกอีเมล (PDPA)
            </div>
          </div>
        )}
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
