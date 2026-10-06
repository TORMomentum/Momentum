"use client";

import { useState } from "react";
import { PROVINCES, REGIONS, WHOLE_COUNTRY_AREA } from "@tor-radar/seeds";
import styles from "./profile.module.css";

/**
 * Where a vendor is willing to work — which is NOT where the issuing agency
 * sits, and the copy says so, because an agency procures work far from its own
 * address all the time.
 *
 * Seventy-seven provinces as one flat row of buttons is a wall, and the whole
 * point of this screen is that it can be finished in a few taps. So the country
 * is the default, a region is one tap, and the provinces inside a region appear
 * only if someone opens it.
 */
export function ServiceAreaPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [opened, setOpened] = useState<string | null>(null);
  const selected = new Set(value);
  const wholeCountry = selected.has(WHOLE_COUNTRY_AREA);

  /** Selecting anywhere specific means the answer is no longer "everywhere". */
  function withoutWholeCountry(ids: string[]): string[] {
    return ids.filter((id) => id !== WHOLE_COUNTRY_AREA);
  }

  function toggleProvince(id: string) {
    onChange(
      selected.has(id)
        ? value.filter((area) => area !== id)
        : [...withoutWholeCountry(value), id],
    );
  }

  function toggleRegion(regionId: string) {
    const ids = PROVINCES.filter((province) => province.region === regionId).map((p) => p.id);
    const allOn = ids.every((id) => selected.has(id));
    onChange(
      allOn
        ? value.filter((area) => !ids.includes(area))
        : [...new Set([...withoutWholeCountry(value), ...ids])],
    );
  }

  const chosenProvinces = PROVINCES.filter((province) => selected.has(province.id));

  return (
    <div>
      <div className={styles.areaGrid}>
        <button
          type="button"
          className={`${styles.skillPill} ${wholeCountry ? styles.skillPillOn : ""}`}
          aria-pressed={wholeCountry}
          onClick={() => onChange([WHOLE_COUNTRY_AREA])}
        >
          ทั่วประเทศ
        </button>
      </div>

      {REGIONS.map((region) => {
        const ids = PROVINCES.filter((province) => province.region === region.id);
        const chosen = ids.filter((province) => selected.has(province.id)).length;
        const isOpen = opened === region.id;
        return (
          <div className={styles.taxonomyGroup} key={region.id}>
            <div className={styles.areaGrid}>
              <button
                type="button"
                className={`${styles.skillPill} ${chosen === ids.length ? styles.skillPillOn : ""}`}
                aria-pressed={chosen === ids.length}
                onClick={() => toggleRegion(region.id)}
              >
                {region.th}
                {chosen > 0 && chosen < ids.length ? ` (${chosen}/${ids.length})` : ""}
              </button>
              <button
                type="button"
                className={styles.addSkillPill}
                aria-expanded={isOpen}
                onClick={() => setOpened(isOpen ? null : region.id)}
              >
                {isOpen ? "ย่อจังหวัด" : "เลือกรายจังหวัด"}
              </button>
            </div>
            {isOpen && (
              <div className={styles.areaGrid}>
                {ids.map((province) => (
                  <button
                    type="button"
                    key={province.id}
                    className={`${styles.skillPill} ${selected.has(province.id) ? styles.skillPillOn : ""}`}
                    aria-pressed={selected.has(province.id)}
                    onClick={() => toggleProvince(province.id)}
                  >
                    {province.th}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <p className={styles.skillCount} role="status">
        {wholeCountry
          ? "รับงานทั่วประเทศ"
          : `เลือกแล้ว ${chosenProvinces.length} จังหวัด — กดอีกครั้งเพื่อนำออก`}
      </p>
    </div>
  );
}
