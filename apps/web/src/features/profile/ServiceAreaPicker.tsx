"use client";

import { useState } from "react";
import { PROVINCES, REGIONS, WHOLE_COUNTRY_AREA } from "@tor-radar/seeds";
import styles from "./profile.module.css";

/**
 * Where a vendor is willing to work — which is NOT where the issuing agency
 * sits, and the copy says so, because an agency procures work far from its own
 * address all the time.
 *
 * Unlike the work taxonomy, this one DOES collapse: most vendors answer with
 * the whole country or a region and never need a province, and a region's name
 * tells them exactly what is inside it. That predictability is the condition
 * under which collapsing is worth its interaction cost (NN/g on filter
 * categories); seventy-seven provinces in one flat row is the wall this screen
 * exists to avoid.
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

  /** Naming anywhere specific means the answer is no longer "everywhere". */
  function withoutWholeCountry(ids: string[]): string[] {
    return ids.filter((id) => id !== WHOLE_COUNTRY_AREA);
  }

  function toggleProvince(id: string) {
    onChange(
      selected.has(id) ? value.filter((area) => area !== id) : [...withoutWholeCountry(value), id],
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

  const chosenCount = PROVINCES.filter((province) => selected.has(province.id)).length;

  return (
    <div>
      <button
        type="button"
        className={`${styles.areaPrimary} ${wholeCountry ? styles.areaPrimaryOn : ""}`}
        aria-pressed={wholeCountry}
        onClick={() => onChange([WHOLE_COUNTRY_AREA])}
      >
        {wholeCountry ? "✓ " : ""}รับงานทั่วประเทศ
      </button>

      {REGIONS.map((region) => {
        const provinces = PROVINCES.filter((province) => province.region === region.id);
        const chosen = provinces.filter((province) => selected.has(province.id)).length;
        const whole = chosen === provinces.length;
        const isOpen = opened === region.id;
        return (
          <div key={region.id}>
            <div className={styles.regionRow}>
              <button
                type="button"
                className={`${styles.skillPill} ${whole ? styles.skillPillOn : ""}`}
                aria-pressed={whole}
                onClick={() => toggleRegion(region.id)}
              >
                {region.th}
              </button>
              {chosen > 0 && (
                <span className={styles.regionChosen}>
                  {whole ? "ทั้งภาค" : `${chosen} จาก ${provinces.length} จังหวัด`}
                </span>
              )}
              <button
                type="button"
                className={styles.regionExpand}
                aria-expanded={isOpen}
                onClick={() => setOpened(isOpen ? null : region.id)}
              >
                {isOpen ? "ย่อ" : "เลือกรายจังหวัด"}
              </button>
            </div>
            {isOpen && (
              <div className={styles.regionProvinces}>
                {provinces.map((province) => (
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
        {wholeCountry ? "รับงานทั่วประเทศ" : `เลือกแล้ว ${chosenCount} จังหวัด`}
      </p>
    </div>
  );
}
