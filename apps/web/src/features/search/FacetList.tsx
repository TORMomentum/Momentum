"use client";

import { useState } from "react";
import type { FacetValue } from "../../shared/api/tors.api";
import { thaiDigitsToArabic } from "../../shared/lib/format";
import styles from "./search.module.css";

/** Only a list longer than this scrolls inside itself; a short one (the categories) simply opens. */
const SCROLL_AFTER = 20;

/**
 * A multi-select facet: a checkbox row per value with its count, the busiest
 * few first (Baymard: counts beside every option; truncate long lists).
 *
 * A long list gets a search box instead of an ever-growing "show all": typing
 * finds an agency among hundreds, where scrolling a national list would not.
 * A value already filtering the results always stays on screen, or the reader
 * could not see what narrows the list, let alone switch it off.
 */
export function FacetList({
  label,
  items,
  selected,
  limit,
  onToggle,
  searchPlaceholder,
}: {
  label: string;
  items: FacetValue[];
  selected: string[];
  limit: number;
  onToggle: (value: string) => void;
  /** Set to give the list a search box — for lists too long to scan. */
  searchPlaceholder?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const needle = thaiDigitsToArabic(query.trim()).toLocaleLowerCase("th-TH");
  const matching = needle
    ? items.filter((item) => thaiDigitsToArabic(item.value).toLocaleLowerCase("th-TH").includes(needle))
    : items;
  const visible =
    expanded || needle ? matching : matching.filter((item, index) => index < limit || selected.includes(item.value));
  const hidden = matching.length - visible.length;

  return (
    <>
      {searchPlaceholder && (
        <input
          type="search"
          className={styles.facetSearch}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
      )}
      <div className={`${styles.facetList} ${(needle || expanded) && items.length > SCROLL_AFTER ? styles.facetListScroll : ""}`} role="group" aria-label={label}>
        {visible.map(({ value, count }) => {
          const on = selected.includes(value);
          return (
            <button
              type="button"
              key={value}
              className={`${styles.facetRow} ${on ? styles.facetRowOn : ""}`}
              onClick={() => onToggle(value)}
              aria-pressed={on}
            >
              {on ? "☑" : "☐"} {thaiDigitsToArabic(value)}               <span className={styles.facetCount}>{count}</span>
            </button>
          );
        })}
        {needle && matching.length === 0 && <p className={styles.facetEmpty}>ไม่พบ “{query.trim()}”</p>}
      </div>
      {!needle && (hidden > 0 || expanded) && (
        <button type="button" className={styles.facetMore} onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "แสดงน้อยลง" : `ดูเพิ่มอีก ${hidden} รายการ`}
        </button>
      )}
    </>
  );
}
