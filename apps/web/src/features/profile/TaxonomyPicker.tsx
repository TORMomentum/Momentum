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
 * Every selection is removable by pressing it again. The screen this replaced
 * could add a skill and never take one away.
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
      {WORK_CATEGORIES.map((group) => (
        <section className={styles.taxonomyGroup} key={group.id}>
          <button
            type="button"
            className={`${styles.skillPill} ${selected.has(group.id) ? styles.skillPillOn : ""}`}
            aria-pressed={selected.has(group.id)}
            onClick={() => toggle(group.id)}
          >
            {group.th} ทั้งหมด
          </button>
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
      ))}

      {/* Announced after the list, so a change is read out without the whole
          set of buttons being re-announced with it. */}
      <p className={styles.skillCount} role="status">
        เลือกแล้ว {value.length} รายการ — กดอีกครั้งเพื่อนำออก
      </p>
    </div>
  );
}
