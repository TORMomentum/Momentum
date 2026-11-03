"use client";

import { useId, useState, type ReactNode } from "react";
import styles from "./search.module.css";

/**
 * One collapsible group of the search sidebar. Groups open by default — a
 * filter a reader cannot see is a filter they will not use — and collapse to
 * a single line that still says how many of its values are on.
 */
export function FilterSection({
  title,
  active = 0,
  children,
}: {
  title: string;
  /** How many values of this group are filtering the results. */
  active?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const body = useId();
  return (
    <section className={styles.filterSection}>
      <button
        type="button"
        className={styles.filterSectionHead}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={body}
      >
        <span className={styles.filterSectionTitle}>{title}</span>
        {active > 0 && <span className={styles.facetSelected}>{active}</span>}
        <svg className={`${styles.filterChevron} ${open ? styles.filterChevronOpen : ""}`} viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
          <path d="M3 4.5 6 7.5l3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div id={body} className={styles.filterSectionBody}>
          {children}
        </div>
      )}
    </section>
  );
}
