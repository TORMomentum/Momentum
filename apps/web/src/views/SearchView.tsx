"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MATCH_RANGE, matchPercent } from "@tor-radar/shared";
import { AppliedFilters, type AppliedFilter } from "../features/search/AppliedFilters";
import { FacetList } from "../features/search/FacetList";
import { FilterSection } from "../features/search/FilterSection";
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
  DEADLINE_SOON_DAYS,
  daysLeftLabel,
  daysUntil,
  deadlineParts,
  formatBaht,
  formatBudgetShort,
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

/**
 * Where a TOR stands. This is the leading badge and every row has exactly one:
 * it is the thing a vendor decides on. Extraction quality is a separate axis
 * and used to overwrite this one, which hid the state of every unverified
 * record.
 */
function statusBadgeFor(row: TorListItem): Badge {
  if (row.torStatus.value === "cancelled") return { label: "ยกเลิกแล้ว", className: styles.badgeClosed };
  if (row.torStatus.value === "awarded") return { label: "ประกาศผู้ชนะแล้ว", className: styles.badgeClosed };
  if (!row.open) return { label: "ปิดรับแล้ว", className: styles.badgeClosed };
  // Announced with no deadline yet: the draft TOR is out, the invitation to bid is not.
  if (row.deadline.value === null) return { label: "รอประกาศเชิญชวน", className: styles.badgeUpcoming };
  return { label: "เปิดรับข้อเสนอ", className: styles.badgeOpen };
}

/**
 * What we know about the record, beside its state: how well it matches this
 * vendor, and whether its extracted values have been confirmed. Both sit to the
 * right of the status so the state is never displaced by them.
 */
function markerBadgesFor(row: TorListItem): Badge[] {
  const markers: Badge[] = [];
  if (typeof row.matchScore === "number") {
    markers.push({ label: `ตรงกับคุณ ${matchPercent(row.matchScore)}%`, className: styles.badgeMatch });
  }
  if (row.unverified) {
    markers.push({ label: "⚠ ยังไม่ยืนยันการสกัด", className: styles.badgeUnverified });
  }
  return markers;
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
  savedIds,
}: {
  filters: SearchFilters;
  facets: TorFacets;
  /** null when the API could not answer — search fails closed (rendering spec §8). */
  results: TorSearchResult | null;
  queryMaxChars: number;
  savedIds: string[];
}) {
  const router = useRouter();
  const { signedIn, ready } = useViewer();
  // Any signed-in account with a profile has matches — the API scores from
  // the profile, not the role, and the dashboard shows them to the same
  // people. Gating on role alone hid the filter from an admin testing their
  // own profile while the dashboard beside it listed their matches.
  const matchFilterShown = signedIn;
  const [pending, startTransition] = useTransition();

  const [draftQuery, setDraftQuery] = useState(filters.q);
  const lastCommittedQuery = useRef(filters.q);
  const [bookSel, setBookSel] = useState<Record<string, boolean>>(() => Object.fromEntries(savedIds.map((id) => [id, true])));

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

  const committedMatchMin = filters.minMatch ?? MATCH_RANGE.floor;
  const committedMatchMax = filters.maxMatch ?? MATCH_RANGE.ceiling;
  const [draftMatch, setDraftMatch] = useState({ min: committedMatchMin, max: committedMatchMax });
  const lastCommittedMatch = useRef({ min: committedMatchMin, max: committedMatchMax });

  useEffect(() => {
    // As with the budget: only an outside change (clear all, Back) moves it.
    const last = lastCommittedMatch.current;
    if (last.min !== committedMatchMin || last.max !== committedMatchMax) {
      lastCommittedMatch.current = { min: committedMatchMin, max: committedMatchMax };
      setDraftMatch({ min: committedMatchMin, max: committedMatchMax });
    }
  }, [committedMatchMin, committedMatchMax]);

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

  useEffect(() => {
    const { min, max } = draftMatch;
    const last = lastCommittedMatch.current;
    if (min === last.min && max === last.max) return;
    const timer = setTimeout(() => {
      lastCommittedMatch.current = { min, max };
      // Ends of the range are no bound, as for the budget.
      update({
        minMatch: min <= MATCH_RANGE.floor ? null : min,
        maxMatch: max >= MATCH_RANGE.ceiling ? null : max,
      });
    }, BUDGET_COMMIT_DELAY_MS);
    return () => clearTimeout(timer);
    // Re-armed on the draft alone, as the budget slider is.
  }, [draftMatch]);

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
    lastCommittedMatch.current = { min: MATCH_RANGE.floor, max: MATCH_RANGE.ceiling };
    setDraftMatch({ min: MATCH_RANGE.floor, max: MATCH_RANGE.ceiling });
    setDraftQuery("");
    navigate(EMPTY_FILTERS);
  }

  async function toggleBook(e: React.SyntheticEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    const previous = Boolean(bookSel[id]);
    const next = !previous;
    setBookSel((current) => ({ ...current, [id]: next }));
    try {
      const response = await fetch(`/api/auth/me/bookmarks/${encodeURIComponent(id)}`, { method: next ? "PUT" : "DELETE" });
      if (!response.ok) throw new Error("bookmark request failed");
    } catch {
      // A failed write must not leave an icon claiming a state the server lacks.
      setBookSel((current) => ({ ...current, [id]: previous }));
    }
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

  const dateLabel = (iso: string) => formatThaiDate(`${iso}T00:00:00Z`) || iso;
  const applied: AppliedFilter[] = [
    ...(filters.q ? [{ key: "q", label: `“${thaiDigitsToArabic(filters.q)}”`, onRemove: () => { setDraftQuery(""); commitQuery(""); } }] : []),
    ...(filters.state ? [{ key: "state", label: STATE_LABELS[filters.state], onRemove: () => update({ state: null }) }] : []),
    ...(filters.minMatch !== null || filters.maxMatch !== null
      ? [{ key: "match", label: `ตรงกับคุณ ${filters.minMatch ?? MATCH_RANGE.floor}–${filters.maxMatch ?? MATCH_RANGE.ceiling}%`, onRemove: () => update({ minMatch: null, maxMatch: null }) }]
      : []),
    ...filters.categories.map((value) => ({ key: `c:${value}`, label: thaiDigitsToArabic(value), onRemove: () => update({ categories: toggle(filters.categories, value) }) })),
    ...filters.agencies.map((value) => ({ key: `a:${value}`, label: thaiDigitsToArabic(value), onRemove: () => update({ agencies: toggle(filters.agencies, value) }) })),
    ...(filters.minBudget !== null || filters.maxBudget !== null
      ? [{ key: "budget", label: `งบ ${formatBudgetShort(filters.minBudget ?? floor)} – ${formatBudgetShort(filters.maxBudget ?? ceiling)}`, onRemove: () => update({ minBudget: null, maxBudget: null }) }]
      : []),
    ...(filters.deadlineFrom || filters.deadlineTo
      ? [{ key: "deadline", label: `ยื่นภายใน ${filters.deadlineFrom ? dateLabel(filters.deadlineFrom) : "…"} – ${filters.deadlineTo ? dateLabel(filters.deadlineTo) : "…"}`, onRemove: () => update({ deadlineFrom: null, deadlineTo: null }) }]
      : []),
  ];

  return (
    <main className={styles.searchPage}>
      <div className={styles.sidebar}>
        <div className={styles.sidebarHead}>
          <span className={styles.sidebarLabel}>ตัวกรอง</span>
          <button type="button" className={styles.clearLink} onClick={clearFilters}>
            ล้างทั้งหมด
          </button>
        </div>

        <FilterSection title="สถานะ" active={filters.state ? 1 : 0}>
          {/* The same five states the dashboard counts, so a reader who clicked
              a chip there finds the same words here. */}
          <div className={styles.facetList} role="radiogroup" aria-label="สถานะ">
            {[null, ...SEARCH_STATES].map((state) => {
              const on = (filters.state ?? null) === state;
              return (
                <button
                  type="button"
                  key={state ?? "all"}
                  role="radio"
                  aria-checked={on}
                  className={`${styles.facetRow} ${on ? styles.facetRowOn : ""}`}
                  onClick={() => update({ state })}
                >
                  {on ? "◉" : "○"} {state ? STATE_LABELS[state] : "ทั้งหมด"}
                </button>
              );
            })}
          </div>
        </FilterSection>

        {matchFilterShown && (
          <FilterSection title="ตรงกับคุณ" active={filters.minMatch !== null || filters.maxMatch !== null ? 1 : 0}>
            {/* In the URL, so paging stays an API query rather than a filter
                over one page in the browser. */}
            <BudgetRange
              min={draftMatch.min}
              max={draftMatch.max}
              floor={MATCH_RANGE.floor}
              ceiling={MATCH_RANGE.ceiling}
              step={MATCH_RANGE.step}
              onChange={setDraftMatch}
              unit="percent"
              tone="match"
              minLabel="ความตรงขั้นต่ำ"
              maxLabel="ความตรงสูงสุด"
            />
          </FilterSection>
        )}

        {budgetFacet && ceiling > floor && (
          <FilterSection title="งบประมาณ (฿)" active={filters.minBudget !== null || filters.maxBudget !== null ? 1 : 0}>
            <BudgetRange
              min={draftBudget.min}
              max={draftBudget.max}
              floor={floor}
              ceiling={ceiling}
              step={step}
              onChange={setDraftBudget}
              stacked
            />
          </FilterSection>
        )}

        <FilterSection title="กำหนดยื่นข้อเสนอ" active={filters.deadlineFrom || filters.deadlineTo ? 1 : 0}>
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
        </FilterSection>

        {facets.categories.length > 0 && (
          <FilterSection title="หมวดหมู่" active={filters.categories.length}>
            <FacetList
              label="หมวดหมู่"
              items={facets.categories}
              selected={filters.categories}
              limit={facets.categories.length}
              onToggle={(value) => update({ categories: toggle(filters.categories, value) })}
            />
          </FilterSection>
        )}

        {/* Last, because it is the longest: the short, decisive filters come
            first. A national corpus has hundreds of agencies, so the busiest
            few are shown and the rest are found by typing, not scrolling. */}
        {facets.agencies.length > 0 && (
          <FilterSection title="หน่วยงาน" active={filters.agencies.length}>
            <FacetList
              label="หน่วยงาน"
              items={facets.agencies}
              selected={filters.agencies}
              limit={AGENCY_LIMIT}
              searchPlaceholder={`ค้นหาใน ${facets.agencies.length} หน่วยงาน`}
              onToggle={(value) => update({ agencies: toggle(filters.agencies, value) })}
            />
          </FilterSection>
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

        <AppliedFilters filters={applied} onClearAll={clearFilters} />

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
              const status = statusBadgeFor(row);
              const markers = markerBadgesFor(row);
              return (
                <Link
                  key={row.id}
                  href={`/tors/${row.id}`}
                  className={`${styles.resultRow} ${!row.open ? styles.resultRowClosed : ""}`}
                >
                  <div className={styles.resultLead}>
                    <div className={styles.badgeRow}>
                      <span className={`${styles.badge} ${status.className}`}>{status.label}</span>
                      {markers.map((marker) => (
                        <span className={`${styles.badge} ${marker.className}`} key={marker.label}>
                          {marker.label}
                        </span>
                      ))}
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
                    {row.open &&
                      (() => {
                        const days = daysUntil(row.deadline.value);
                        const label = daysLeftLabel(days);
                        if (!label) return null;
                        const soon = days !== null && days <= DEADLINE_SOON_DAYS;
                        return (
                          <span className={`${styles.resultDaysLeft} ${soon ? styles.resultDaysLeftSoon : ""}`}>
                            {label}
                          </span>
                        );
                      })()}
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
