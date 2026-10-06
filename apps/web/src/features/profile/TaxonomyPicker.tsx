"use client";

import { WORK_CATEGORIES } from "@tor-radar/seeds";
import styles from "./profile.module.css";

/**
 * What a vendor does, chosen from the seeded taxonomy and nothing else.
 *
 * A group and its leaves are both selectable: a vendor may say "all
 * construction" or "roads specifically", and matching scores the coarse choice
 * lower against a TOR that resolves to a leaf beneath it. Picking the group
 * does NOT tick its leaves — they are different statements, and collapsing them
 * would lose the distinction the score depends on.
 *
 * The whole taxonomy stays visible. A vendor has to scan it to find their own
 * work, and that is exactly the case where collapsing sections costs more than
 * it saves (NN/g: avoid accordions when users need access to most content).
 * Hierarchy is carried by type instead — a group is a heading, its work is a
 * pill. Every selection is removable by pressing it again.
 */
export function TaxonomyPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const selected = new Set(value);

  function toggle(id: string) {
    onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]);
  }

  return (
    <div>
      <div className={styles.pickerSummary}>
        <span className={styles.pickerCount} role="status">
          เลือกแล้ว {value.length} รายการ
        </span>
        <span className={styles.pickerHint}>กดอีกครั้งเพื่อนำออก</span>
      </div>

      {WORK_CATEGORIES.map((group) => {
        const groupOn = selected.has(group.id);
        const chosen = group.children.filter((leaf) => selected.has(leaf.id)).length;
        return (
          <section className={styles.taxonomyGroup} key={group.id}>
            <div className={styles.groupHead}>
              <h3 className={styles.groupName}>{group.th}</h3>
              <button
                type="button"
                className={styles.groupAll}
                aria-pressed={groupOn}
                onClick={() => toggle(group.id)}
              >
                {groupOn ? "✓ รับทั้งกลุ่ม" : "รับทั้งกลุ่ม"}
              </button>
              {chosen > 0 && <span className={styles.groupChosen}>เลือก {chosen}</span>}
            </div>
            <div className={styles.skillRow}>
              {group.children.map((leaf) => (
                <button
                  type="button"
                  key={leaf.id}
                  className={`${styles.skillPill} ${selected.has(leaf.id) ? styles.skillPillOn : ""}`}
                  aria-pressed={selected.has(leaf.id)}
                  onClick={() => toggle(leaf.id)}
                >
                  {leaf.th}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
