import styles from "./search.module.css";

export interface AppliedFilter {
  key: string;
  label: string;
  onRemove: () => void;
}

/**
 * What is narrowing the list, above the list: one chip per filter, each with
 * its own way out (Baymard: keep applied filters visible while browsing).
 * Nothing renders when nothing is applied.
 */
export function AppliedFilters({ filters, onClearAll }: { filters: AppliedFilter[]; onClearAll: () => void }) {
  if (filters.length === 0) return null;
  return (
    <div className={styles.applied} aria-label="ตัวกรองที่ใช้อยู่">
      {filters.map((filter) => (
        <button type="button" key={filter.key} className={styles.appliedChip} onClick={filter.onRemove} aria-label={`เอาตัวกรอง ${filter.label} ออก`}>
          <span>{filter.label}</span>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ))}
      {filters.length > 1 && (
        <button type="button" className={styles.appliedClear} onClick={onClearAll}>
          ล้างทั้งหมด
        </button>
      )}
    </div>
  );
}
