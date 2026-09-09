"use client";

import { useEffect, useRef } from "react";
import styles from "./app.module.css";

export interface DropOption {
  value: string;
  label: string;
  /** Right-hand count, blank when the dimension has no count to show. */
  meta?: string;
}

/**
 * One dashboard filter chip and its option list. Ported from the `dashDrops`
 * block of mockups/TOR Radar App.dc.html — a pill that opens a panel, not a
 * native select, because the mockup shows a count beside every option and a
 * caret that rotates.
 *
 * Which chip is open is the CALLER's state: the mockup keeps a single
 * `openDrop`, so opening one closes the others.
 */
export function FilterDrop({
  label,
  value,
  options,
  open,
  onToggle,
  onPick,
  /** Period is a dimension with no "all" state, so it never reads as filtered. */
  highlightWhenSet = true,
}: {
  label: string;
  value: string;
  options: DropOption[];
  open: boolean;
  onToggle: () => void;
  onPick: (value: string) => void;
  highlightWhenSet?: boolean;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value);
  const filtered = highlightWhenSet && value !== "all";

  // A click anywhere else, or Escape, closes it — otherwise the panel would
  // stay over the stat strip after the reader moved on.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) onToggle();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onToggle();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onToggle]);

  return (
    <div className={styles.dropWrap} ref={wrap}>
      <button
        type="button"
        className={`${styles.chip} ${filtered ? styles.chipFiltered : ""} ${open ? styles.chipOpen : ""}`}
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={styles.chipLabel}>{label}:</span>
        <span className={styles.chipValue}>{current ? current.label : options[0]?.label}</span>
        <span className={`${styles.chipCaret} ${open ? styles.chipCaretOpen : ""}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className={styles.dropPanel} role="listbox" aria-label={label}>
          {options.map((option) => {
            const on = option.value === value;
            return (
              <button
                type="button"
                key={option.value}
                role="option"
                aria-selected={on}
                className={`${styles.dropOption} ${on ? styles.dropOptionOn : ""}`}
                onClick={() => onPick(option.value)}
              >
                <span>{option.label}</span>
                <span className={styles.dropMeta}>{option.meta}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
