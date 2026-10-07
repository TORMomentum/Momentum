"use client";

import { useMemo, useState } from "react";
import { WORK_CATEGORIES } from "@tor-radar/seeds";
import styles from "./profile.module.css";

/**
 * What a vendor does, chosen from the seeded taxonomy — and, separately, what
 * the taxonomy has no word for.
 *
 * A group and its leaves are both selectable: a vendor may say "all
 * construction" or "roads specifically", and matching scores the coarse choice
 * lower against a TOR that resolves to a leaf beneath it. Picking the group
 * does NOT tick its leaves — they are different statements.
 *
 * The whole taxonomy stays visible rather than collapsing, because a vendor has
 * to scan it to find their own work, which is the case where hiding sections
 * costs more than it saves (NN/g: avoid accordions when users need most of the
 * content). With sixty-odd kinds of work that scan needs help, so a filter
 * narrows the list by name or by the words an announcement would use.
 */

/** Below this many options a filter box is noise rather than help. */
const FILTER_APPEARS_ABOVE = 24;

export function TaxonomyPicker({
  value,
  other,
  onChange,
  onOtherChange,
}: {
  value: string[];
  other: string[];
  onChange: (value: string[]) => void;
  onOtherChange: (other: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const selected = new Set(value);

  const totalLeaves = WORK_CATEGORIES.reduce((n, group) => n + group.children.length, 0);

  // What the vendor has actually covered, not how many ids are stored: accepting
  // a group of eight is eight kinds of work, and counting it as one made the
  // tally disagree with the screen.
  const coveredCount = WORK_CATEGORIES.reduce((total, group) => {
    if (selected.has(group.id)) return total + group.children.length;
    return total + group.children.filter((leaf) => selected.has(leaf.id)).length;
  }, 0);

  // A leaf matches on its own name OR on the words an announcement uses for it,
  // so searching "ถนน" finds งานทาง even though the label does not say it.
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return WORK_CATEGORIES;
    return WORK_CATEGORIES.map((group) => ({
      ...group,
      children: group.th.toLowerCase().includes(needle)
        ? group.children
        : group.children.filter(
            (leaf) =>
              leaf.th.toLowerCase().includes(needle) ||
              leaf.synonyms.some((word) => word.toLowerCase().includes(needle)),
          ),
    })).filter((group) => group.children.length > 0 || group.th.toLowerCase().includes(needle));
  }, [query]);

  function toggle(id: string) {
    onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  /**
   * Pressing a single kind of work while the whole group is accepted means the
   * vendor is narrowing: the group opens out into its own items so that one can
   * be dropped, which is what "all construction except irrigation" has to mean.
   */
  function toggleLeaf(groupId: string, leafIds: string[], leafId: string) {
    if (!selected.has(groupId)) {
      toggle(leafId);
      return;
    }
    const expanded = [...value.filter((item) => item !== groupId), ...leafIds];
    onChange([...new Set(expanded)].filter((item) => item !== leafId));
  }

  /** Everything this group covers, whether taken wholesale or one at a time. */
  function clearGroup(groupId: string, leafIds: string[]) {
    const gone = new Set([groupId, ...leafIds]);
    onChange(value.filter((item) => !gone.has(item)));
  }

  function addOther() {
    const word = draft.trim();
    if (!word || other.includes(word)) {
      setDraft("");
      return;
    }
    onOtherChange([...other, word]);
    setDraft("");
  }

  return (
    <div>
      <div className={styles.pickerSummary}>
        <span className={styles.pickerCount} role="status">
          เลือกแล้ว {coveredCount} รายการ
        </span>
        <span className={styles.pickerHint}>กดอีกครั้งเพื่อนำออก</span>
      </div>

      {totalLeaves > FILTER_APPEARS_ABOVE && (
        <input
          type="search"
          className={styles.pickerFilter}
          placeholder="ค้นหาประเภทงาน เช่น ถนน คอมพิวเตอร์ ที่ปรึกษา"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="ค้นหาประเภทงาน"
        />
      )}

      {groups.length === 0 && (
        <p className={styles.pickerEmpty}>
          ไม่พบประเภทงานที่ตรงกับคำค้น — หากงานของคุณไม่มีในรายการ เพิ่มได้ที่ช่องด้านล่าง
        </p>
      )}

      {groups.map((group) => {
        const groupOn = selected.has(group.id);
        const leafIds = group.children.map((leaf) => leaf.id);
        const chosen = groupOn
          ? group.children.length
          : group.children.filter((leaf) => selected.has(leaf.id)).length;
        const anything = chosen > 0;
        return (
          <section className={styles.taxonomyGroup} key={group.id}>
            <div className={styles.groupHead}>
              <h3 className={styles.groupName}>{group.th}</h3>
              {/* One control that says what it will do. Offering "accept the
                  whole group" to someone who has already chosen within it asks
                  a question they have answered. */}
              <button
                type="button"
                className={styles.groupAll}
                onClick={() => (anything ? clearGroup(group.id, leafIds) : toggle(group.id))}
              >
                {anything ? "ล้าง" : "รับทั้งกลุ่ม"}
              </button>
              {anything && (
                <span className={styles.groupChosen}>
                  {groupOn ? "ทั้งกลุ่ม" : `เลือก ${chosen}`}
                </span>
              )}
            </div>
            <div className={styles.skillRow}>
              {group.children.map((leaf) => {
                const on = selected.has(leaf.id);
                return (
                  <button
                    type="button"
                    key={leaf.id}
                    className={`${styles.skillPill} ${on ? styles.skillPillOn : groupOn ? styles.skillPillCovered : ""}`}
                    aria-pressed={on || groupOn}
                    onClick={() => toggleLeaf(group.id, leafIds, leaf.id)}
                  >
                    {leaf.th}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      <section className={styles.otherSection}>
        <div className={styles.groupHead}>
          <h3 className={styles.groupName}>อื่นๆ ที่ไม่มีในรายการ</h3>
        </div>
        {/* Said plainly rather than implied. Free text is precisely what the
            taxonomy replaces, so scoring against it would bring back the
            problem that put a procurement method in a category field. */}
        <p className={styles.pickerHint}>
          ยังไม่ถูกใช้ในการจับคู่ แต่เราเก็บไว้เพื่อเพิ่มประเภทงานให้ครอบคลุมขึ้น
        </p>
        <div className={styles.skillRow}>
          {other.map((word) => (
            <button
              type="button"
              key={word}
              className={`${styles.skillPill} ${styles.otherPill}`}
              onClick={() => onOtherChange(other.filter((item) => item !== word))}
              aria-label={`นำ ${word} ออก`}
            >
              {word} ✕
            </button>
          ))}
        </div>
        <div className={styles.addSkillRow}>
          <input
            type="text"
            className={styles.addSkillInput}
            placeholder="เช่น ติดตั้งระบบเสียงในหอประชุม"
            value={draft}
            maxLength={80}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addOther();
              }
            }}
            aria-label="เพิ่มประเภทงานที่ไม่มีในรายการ"
          />
          <button type="button" className={styles.addSkillConfirm} onClick={addOther}>
            เพิ่ม
          </button>
        </div>
      </section>
    </div>
  );
}
