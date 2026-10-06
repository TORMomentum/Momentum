"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../features/search/search.module.css";
import {
  EMPTY_FILTERS,
  hasActiveFilters,
  SEARCH_STATES,
  toSearchQuery,
  type SearchFilters,
  type SearchState,
} from "../features/search/search.params";
import type { TorFacets, TorListItem, TorSearchResult } from "../shared/api/tors.api";
import {
  deadlineParts,
  formatBaht,
  formatThaiDate,
  formatThaiDateTime,
  thaiDigitsToArabic,
} from "../shared/lib/format";
import { useViewer } from "../shared/lib/viewer";
import { BudgetRange } from "../shared/ui/BudgetRange";
import icons from "../shared/ui/tor-actions.module.css";

/**
 * Public TOR search (FR-E-3). The page renders this from the URL on the server;
 * this component owns no results, only the controls. Every filter change
 * pushes a URL, inside a transition, so the previous list stays on screen
 * while the next one loads (rendering spec §3.1).
 *
 * Nothing on a row is a number this system has not computed: the quality
 * score, match percentage and anomaly flag from the mockup return when their
 * slices compute them (NFR-F6).
 */

/** How long the budget slider rests before its value becomes a search. */
const BUDGET_COMMIT_DELAY_MS = 450;
/** How long typing pauses before the keyword becomes a search, as the mockup filters while you type. */
const QUERY_COMMIT_DELAY_MS = 450;

/** One vocabulary for the five states, shared with the dashboard's chips. */
const STATE_LABELS: Record<SearchState, string> = {
  open: "เปิดรับข้อเสนอ",
  "awaiting-invitation": "รอประกาศเชิญชวน",
  closed: "ปิดรับแล้ว",
  awarded: "ประกาศผู้ชนะแล้ว",
  cancelled: "ยกเลิกแล้ว",
};

/** How many agencies the panel shows before it asks to be expanded. */
const AGENCY_LIMIT = 6;

type Badge = { label: string; className: string };

function badgeFor(row: TorListItem): Badge {
  if (row.unverified) return { label: "⚠ ยังไม่ยืนยันการสกัด", className: styles.badgeUnverified };
  if (row.torStatus.value === "cancelled") return { label: "ยกเลิกแล้ว", className: styles.badgeClosed };
  if (row.torStatus.value === "awarded") return { label: "ประกาศผู้ชนะแล้ว", className: styles.badgeClosed };
  if (!row.open) return { label: "ปิดรับแล้ว", className: styles.badgeClosed };
  // Announced with no deadline yet: the draft TOR is out, the invitation to bid is not.
  if (row.deadline.value === null) return { label: "รอประกาศเชิญชวน", className: styles.badgeUpcoming };
  return { label: "เปิดรับข้อเสนอ", className: styles.badgeOpen };
}

/** A slider step that gives roughly a hundred positions across the corpus's range. */
function sliderStep(span: number): number {
  const rough = Math.max(span / 100, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  return Math.ceil(rough / magnitude) * magnitude;
}

export function SearchView({
  filters,
  facets,
  results,
  queryMaxChars,
}: {
  filters: SearchFilters;
  facets: TorFacets;
  /** null when the API could not answer — search fails closed (rendering spec §8). */
  results: TorSearchResult | null;
  queryMaxChars: number;
}) {
  const router = useRouter();
  const { signedIn, ready } = useViewer();
  const [pending, startTransition] = useTransition();
  const [allAgencies, setAllAgencies] = useState(false);
  // An agency already filtering the list must stay on screen even when it falls
  // outside the shown few, or the reader cannot see what is narrowing their
  // results, let alone switch it off.
  const visibleAgencies = allAgencies
    ? facets.agencies
    : facets.agencies.filter((agency, index) => index < AGENCY_LIMIT || filters.agencies.includes(agency.value));

  const [draftQuery, setDraftQuery] = useState(filters.q);
  const lastCommittedQuery = useRef(filters.q);
  const [bookSel, setBookSel] = useState<Record<string, boolean>>({});

  // Only a change that arrives from outside — clear all, the back button —
  // resets the field. The field's own search returning must not overwrite
  // what the reader has typed since.
  useEffect(() => {
    if (filters.q !== lastCommittedQuery.current) {
      lastCommittedQuery.current = filters.q;
      setDraftQuery(filters.q);
    }
  }, [filters.q]);

  const budgetFacet = facets.budget;
  const step = budgetFacet ? sliderStep(budgetFacet.max - budgetFacet.min) : 1;
  const floor = budgetFacet ? Math.floor(budgetFacet.min / step) * step : 0;
  const ceiling = budgetFacet ? Math.ceil(budgetFacet.max / step) * step : 0;
  const committedMin = filters.minBudget ?? floor;
  const committedMax = filters.maxBudget ?? ceiling;
  const [draftBudget, setDraftBudget] = useState({ min: committedMin, max: committedMax });
  const lastCommittedBudget = useRef({ min: committedMin, max: committedMax });

  useEffect(() => {
    // Only an outside change resets the slider. The slider's own commit
    // returning must not snap a handle the reader is still dragging.
    const last = lastCommittedBudget.current;
    if (last.min !== committedMin || last.max !== committedMax) {
      lastCommittedBudget.current = { min: committedMin, max: committedMax };
      setDraftBudget({ min: committedMin, max: committedMax });
    }
  }, [committedMin, committedMax]);

  /**
   * Pushed, not replaced: every call is a committed choice — a click, Enter, a
   * slider come to rest — so Back undoes the last filter instead of leaving
   * the page (rendering spec §3.1).
   */
  function navigate(next: SearchFilters) {
    const query = toSearchQuery(next);
    startTransition(() => {
      router.push(query ? `/search?${query}` : "/search", { scroll: false });
    });
  }

  /** Any filter change starts again from the first page. */
  function update(change: Partial<SearchFilters>) {
    navigate({ ...filters, ...change, cursor: null });
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  useEffect(() => {
    const { min, max } = draftBudget;
    const last = lastCommittedBudget.current;
    if (min === last.min && max === last.max) return;

    const timer = setTimeout(() => {
      lastCommittedBudget.current = { min, max };
      // A handle resting at the end of the range is no bound at all, so the URL omits it.
      update({ minBudget: min <= floor ? null : min, maxBudget: max >= ceiling ? null : max });
    }, BUDGET_COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
    // Re-armed on the draft alone: `update` reads the filters of the render
    // that scheduled it, which are the ones this change applies to.
  }, [draftBudget]);

  function commitQuery(value: string) {
    const q = value.normalize("NFC").trim();
    if (q === lastCommittedQuery.current) return;
    lastCommittedQuery.current = q;
    update({ q });
  }

  useEffect(() => {
    const timer = setTimeout(() => commitQuery(draftQuery), QUERY_COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
    // Re-armed on the draft alone, as the budget slider is.
  }, [draftQuery]);

  function clearFilters() {
    lastCommittedQuery.current = "";
    lastCommittedBudget.current = { min: floor, max: ceiling };
    setDraftBudget({ min: floor, max: ceiling });
    setDraftQuery("");
    navigate(EMPTY_FILTERS);
  }


  function toggleBook(e: React.SyntheticEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    setBookSel((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  const filtered = hasActiveFilters(filters);
  const firstPageQuery = toSearchQuery({ ...filters, cursor: null });

  /** Names the filters that emptied the list (rendering spec §8). */
  const activeNames = [
    filters.q && `คำค้น “${thaiDigitsToArabic(filters.q)}”`,
    filters.agencies.length > 0 && "หน่วยงาน",
    filters.categories.length > 0 && "หมวดหมู่",
    (filters.minBudget !== null || filters.maxBudget !== null) && "งบประมาณ",
    (filters.deadlineFrom || filters.deadlineTo) && "กำหนดยื่นข้อเสนอ",
    filters.open && "ยังเปิดรับ",
  ].filter(Boolean);

  return (
    <main className={styles.searchPage}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <span className={styles.sidebarLabel}>ตัวกรอง</span>
          <button type="button" className={styles.clearLink} onClick={clearFilters}>
            ล้างทั้งหมด
          </button>
        </div>

        <div className={styles.filterGroup}>
          <div className={styles.filterGroupTitle}>สถานะ</div>
          {/* The same five states the dashboard counts, so a reader who clicked
              a chip there finds the same words here. "open" was two options
              before, which could not say "waiting for its invitation to bid". */}
          <div className={styles.toggleList}>
            <button
              type="button"
              className={`${styles.toggleItem} ${!filters.state ? styles.toggleItemOn : ""}`}
              onClick={() => update({ state: null })}
              aria-pressed={!filters.state}
            >
              {!filters.state ? "◉" : "○"} ทั้งหมด
            </button>
            {SEARCH_STATES.map((state) => (
              <button
                type="button"
                key={state}
                className={`${styles.toggleItem} ${filters.state === state ? styles.toggleItemOn : ""}`}
                onClick={() => update({ state })}
                aria-pressed={filters.state === state}
              >
                {filters.state === state ? "◉" : "○"} {STATE_LABELS[state]}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <div className={styles.filterGroupTitle}>กำหนดยื่นข้อเสนอ</div>
          <div className={styles.dateRange}>
            <label className={styles.dateField}>
              <span className={styles.dateLabel}>ตั้งแต่</span>
              <input
                type="date"
                className={styles.dateInput}
                value={filters.deadlineFrom ?? ""}
                max={filters.deadlineTo ?? undefined}
                onChange={(e) => update({ deadlineFrom: e.target.value || null })}
              />
            </label>
            <label className={styles.dateField}>
              <span className={styles.dateLabel}>ถึง</span>
              <input
                type="date"
                className={styles.dateInput}
                value={filters.deadlineTo ?? ""}
                min={filters.deadlineFrom ?? undefined}
                onChange={(e) => update({ deadlineTo: e.target.value || null })}
              />
            </label>
          </div>
        </div>
        {facets.categories.length > 0 && (
          <div className={styles.filterGroup}>
            <div className={styles.filterGroupTitle}>หมวดหมู่</div>
            <div className={styles.pillList}>
              {facets.categories.map(({ value }) => {
                const on = filters.categories.includes(value);
                return (
                  <button
                    type="button"
                    key={value}
                    className={`${styles.pill} ${on ? styles.pillOn : ""}`}
                    onClick={() => update({ categories: toggle(filters.categories, value) })}
                    aria-pressed={on}
                  >
                    {thaiDigitsToArabic(value)}
                  </button>
                );
              })}
              {facets.agencies.length > AGENCY_LIMIT && (
                <button type="button" className={styles.moreAgencies} onClick={() => setAllAgencies(!allAgencies)}>
                  {allAgencies ? "แสดงน้อยลง" : `ดูทั้งหมด (${facets.agencies.length})`}
                </button>
              )}
            </div>
          </div>
        )}
        {budgetFacet && ceiling > floor && (
          <div className={styles.filterGroup}>
            <div className={styles.filterGroupTitle}>งบประมาณ (฿)</div>
            <BudgetRange
              min={draftBudget.min}
              max={draftBudget.max}
              floor={floor}
              ceiling={ceiling}
              step={step}
              onChange={setDraftBudget}
            />
          </div>
        )}

        {facets.agencies.length > 0 && (
          <div className={styles.filterGroup}>
            <div className={styles.filterGroupTitle}>หน่วยงาน</div>
            {/* The one list with no ceiling: a national corpus has hundreds of
                agencies, and all of them would push every other filter off the
                screen. The busiest few are shown, anything already chosen stays
                visible, and the rest are one click away. */}
            <div className={styles.toggleList}>
              {visibleAgencies.map(({ value, count }) => {
                const on = filters.agencies.includes(value);
                return (
                  <button
                    type="button"
                    key={value}
                    className={`${styles.toggleItem} ${on ? styles.toggleItemOn : ""}`}
                    onClick={() => update({ agencies: toggle(filters.agencies, value) })}
                    aria-pressed={on}
                  >
                    {on ? "☑" : "☐"} {thaiDigitsToArabic(value)} <span className={styles.facetCount}>{count}</span>
                  </button>
                );
              })}
              {facets.agencies.length > AGENCY_LIMIT && (
                <button type="button" className={styles.moreAgencies} onClick={() => setAllAgencies(!allAgencies)}>
                  {allAgencies ? "แสดงน้อยลง" : `ดูทั้งหมด (${facets.agencies.length})`}
                </button>
              )}
            </div>
          </div>
        )}

        <div className={styles.sidebarFoot}>
          {results?.coverage.lastUpdatedAt && (
            <>
              อัปเดตข้อมูลล่าสุด {formatThaiDateTime(results.coverage.lastUpdatedAt)}
              <br />
            </>
          )}
          ครอบคลุมเฉพาะเอกสารที่ระบบรวบรวมได้ ไม่ใช่ประกาศจัดซื้อจัดจ้างทั้งหมดในประเทศ
        </div>
      </div>

      <div className={styles.results}>
        <form
          className={styles.searchBar}
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            commitQuery(draftQuery);
          }}
        >
          <input
            className={styles.searchInput}
            type="search"
            value={draftQuery}
            maxLength={queryMaxChars}
            onChange={(e) => setDraftQuery(e.target.value)}
            placeholder="⌕ ค้นหา เช่น ระบบสารสนเทศ, ปรับปรุงถนน…"
            aria-label="ค้นหา TOR"
          />
          {results && <span className={styles.resultCount}>{results.total} ผลลัพธ์</span>}
        </form>

        {ready && !signedIn && (
          <div className={styles.publicBanner}>
            <div className={styles.publicBannerText}>
              คุณกำลังดูแบบสาธารณะ — ลงทะเบียนเพื่อรับคะแนนจับคู่ และแจ้งเตือนอีเมลภายใน 5
              นาที
            </div>
            <Link href="/login?mode=signup" className={styles.publicBannerCta}>
              ลงทะเบียนฟรี
            </Link>
          </div>
        )}

        {!results ? (
          <div className={styles.emptyState} role="alert">
            ค้นหาไม่ได้ในขณะนี้ — ยังเชื่อมต่อกับบริการข้อมูลไม่ได้ จึงไม่แสดงผลที่อาจไม่ครบถ้วน
            ลองใหม่อีกครั้งภายหลัง
          </div>
        ) : (
          <div
            className={`${styles.resultList} ${pending ? styles.resultListPending : ""}`}
            aria-busy={pending}
          >
            {results.items.map((row) => {
              const badge = badgeFor(row);
              return (
                <Link
                  key={row.id}
                  href={`/tors/${row.id}`}
                  className={`${styles.resultRow} ${!row.open ? styles.resultRowClosed : ""}`}
                >
                  <div className={styles.resultLead}>
                    <div className={styles.badgeRow}>
                      <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                      {row.referenceNo?.raw && <span className={styles.resultId}>{row.referenceNo.raw}</span>}
                    </div>
                    <div className={styles.resultTitle}>{row.title.raw || "ไม่พบชื่อโครงการในเอกสาร"}</div>
                    <div className={styles.resultMeta}>
                      {row.agency.raw || "ไม่ระบุหน่วยงาน"}
                      {row.announcedAt && ` · ประกาศ ${formatThaiDate(row.announcedAt)}`}
                    </div>
                  </div>
                  <div
                    className={`${styles.resultPrice} ${
                      row.budget.verified ? styles.priceNormal : styles.priceUnverified
                    }`}
                    title={row.budget.verified ? undefined : "ค่าที่สกัดยังไม่ได้รับการยืนยัน"}
                  >
                    {row.budget.raw ? (
                      <>
                        {typeof row.budget.value === "number" ? formatBaht(row.budget.value) : row.budget.raw}
                        {!row.budget.verified && "*"}
                      </>
                    ) : (
                      <span className={styles.valueMissing}>ไม่ระบุงบประมาณ</span>
                    )}
                  </div>
                  <div className={styles.resultDeadline}>
                    {row.deadline.value === null ? "กำหนดยื่น" : row.open ? "ยื่นภายใน" : "ปิดรับ"}
                    {/* A date the TOR itself does not state must say so here too,
                        not only on the detail page: a bare date in a list reads
                        as the TOR's own. */}
                    {row.deadline.fromDocument && <span className={styles.resultDeadlineSource}>จากประกาศเชิญชวน</span>}
                    {/* Formatted in Arabic numerals; the document's own wording is the
                        tooltip here and is shown in full on the detail page (NFR-F7). */}
                    <span className={styles.resultDeadlineValue} title={row.deadline.raw || undefined}>
                      {(() => {
                        const mark = row.deadline.raw && !row.deadline.verified ? "*" : "";
                        const parts = deadlineParts(row.deadline.value, row.deadline.raw);
                        if (!parts) return `${row.deadline.raw || "ยังไม่ประกาศเชิญชวน"}${mark}`;
                        return (
                          <>
                            {parts.date}
                            {mark}
                            {parts.window && <span className={styles.resultDeadlineWindow}>{parts.window}</span>}
                          </>
                        );
                      })()}
                    </span>
                  </div>
                  {signedIn && (
                    <div className={styles.resultActions}>
                      <span
                        className={`${styles.actionBtn} ${styles.bookBtn} ${bookSel[row.id] ? styles.bookBtnOn : ""}`}
                        role="button"
                        tabIndex={0}
                        title="บุ๊กมาร์ก — เก็บไว้ดูภายหลัง"
                        onClick={(e) => toggleBook(e, row.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") toggleBook(e, row.id);
                        }}
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          className={`${icons.bookIcon} ${bookSel[row.id] ? icons.bookIconOn : ""}`}
                          strokeWidth="2"
                          strokeLinejoin="round"
                        >
                          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                        </svg>
                      </span>
                    </div>
                  )}
                </Link>
              );
            })}

            {results.total === 0 &&
              (filtered ? (
                <div className={styles.emptyState}>
                  ไม่พบ TOR ที่ตรงกับตัวกรอง ({activeNames.join(" · ")}) —{" "}
                  <button type="button" className={styles.emptyClear} onClick={clearFilters}>
                    ล้างตัวกรอง
                  </button>
                </div>
              ) : (
                <div className={styles.emptyState}>
                  ยังไม่มี TOR ที่เผยแพร่ในระบบ — เมื่อมีเอกสารที่สกัดข้อมูลแล้ว รายการจะปรากฏที่นี่
                </div>
              ))}

            {results.total > 0 && (
              <div className={styles.resultsFootHint}>
                <span>คลิกรายการเพื่อดูรายละเอียด</span>
                <span className={styles.pager}>
                  {filters.cursor && (
                    <Link
                      href={firstPageQuery ? `/search?${firstPageQuery}` : "/search"}
                      className={styles.pagerLink}
                    >
                      ← หน้าแรก
                    </Link>
                  )}
                  {results.nextCursor && (
                    <Link
                      href={`/search?${toSearchQuery({ ...filters, cursor: results.nextCursor })}`}
                      className={styles.pagerLink}
                    >
                      หน้าถัดไป →
                    </Link>
                  )}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
