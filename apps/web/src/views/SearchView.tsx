"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "../features/search/search.module.css";
import icons from "../shared/ui/tor-actions.module.css";
import slider from "../shared/ui/budget-range.module.css";
import { useViewer } from "../shared/lib/viewer";
import {
  BUDGET_FILTER_MAX,
  BUDGET_FILTER_MIN,
  BUDGET_FILTER_STEP,
  SEARCH_AGENCIES,
  SEARCH_CATEGORIES,
  TOR_SAMPLES,
  formatBudgetFull,
  formatBudgetShort,
  type TorSample,
} from "../data/tor-samples";

/**
 * Public/registered TOR search (FR-A/FR-C). Ported from the "Search" screen of
 * mockups/TOR Radar App.dc.html. The mockup's logged-out state (a public
 * banner, hidden match scores, no star/bookmark icons) is not modelled here —
 * this app shell (see AppHeader.tsx) has no sign-out affordance and always
 * renders the signed-in nav/avatar, so this screen always renders as
 * logged-in too.
 */

type Badge = {
  label: string;
  className: string;
};

/**
 * A match score is a vendor's own number, so a signed-out reader sees the
 * document's status instead. The mockup does the same: MATCH % is the reason
 * its public banner invites you to register.
 */
function badgeFor(row: TorSample, signedIn: boolean): Badge {
  if (row.anomaly) return { label: "◆ ความผิดปกติทางสถิติ", className: styles.badgeAnomaly };
  if (row.unverified) return { label: "⚠ ยังไม่ยืนยันการสกัด", className: styles.badgeUnverified };
  if (!row.open) return { label: "ปิดรับแล้ว", className: styles.badgeClosed };
  if (signedIn && row.match != null) return { label: `จับคู่ ${row.match}%`, className: styles.badgeMatch };
  return { label: "เปิดรับข้อเสนอ", className: styles.badgeOpen };
}

function priceClassFor(row: TorSample): string {
  if (row.anomaly) return styles.priceAnomaly;
  if (row.unverified) return styles.priceUnverified;
  return styles.priceNormal;
}

const BUDGET_SPAN = BUDGET_FILTER_MAX - BUDGET_FILTER_MIN;

export function SearchView() {
  const router = useRouter();
  const { signedIn, ready } = useViewer();
  const gooId = useId().replace(/[:]/g, "");

  const [agencySel, setAgencySel] = useState<Record<string, boolean>>({});
  const [catSel, setCatSel] = useState<Record<string, boolean>>({});
  const [minBudget, setMinBudget] = useState(BUDGET_FILTER_MIN);
  const [maxBudget, setMaxBudget] = useState(BUDGET_FILTER_MAX);
  const [statusOpen, setStatusOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [hoverMin, setHoverMin] = useState(false);
  const [hoverMax, setHoverMax] = useState(false);
  const [starSel, setStarSel] = useState<Record<string, boolean>>({});
  const [bookSel, setBookSel] = useState<Record<string, boolean>>({});

  const agOn = Object.keys(agencySel).filter((k) => agencySel[k]);
  const catOn = Object.keys(catSel).filter((k) => catSel[k]);
  const q = query.trim();

  const results = TOR_SAMPLES.filter(
    (row) =>
      (agOn.length === 0 || agOn.includes(row.agency)) &&
      (catOn.length === 0 || catOn.includes(row.catKey)) &&
      row.budget <= maxBudget &&
      row.budget >= minBudget &&
      (!statusOpen || row.open) &&
      (!q || row.title.includes(q) || row.agency.includes(q)),
  );

  function openRow(slug: string) {
    router.push(`/tors/${slug}`);
  }

  function toggleStar(e: React.SyntheticEvent, id: string) {
    e.stopPropagation();
    setStarSel((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function toggleBook(e: React.SyntheticEvent, id: string) {
    e.stopPropagation();
    setBookSel((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function clearFilters() {
    setQuery("");
    setMinBudget(BUDGET_FILTER_MIN);
    setMaxBudget(BUDGET_FILTER_MAX);
    // Matches the mockup's clearFilters exactly — it resets status to "ทั้งหมด"
    // (statusOpen: false), not back to the screen's own "ยังเปิดรับ" default.
    setStatusOpen(false);
    setAgencySel({});
    setCatSel({});
  }

  const minPct = ((minBudget - BUDGET_FILTER_MIN) / BUDGET_SPAN) * 100;
  const maxPct = 100 - ((maxBudget - BUDGET_FILTER_MIN) / BUDGET_SPAN) * 100;
  const minBallSize = hoverMin ? 28 : 15;
  const maxBallSize = hoverMax ? 28 : 15;
  const minHoleSize = hoverMin ? 13 : 0;
  const maxHoleSize = hoverMax ? 13 : 0;

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
          <div className={styles.filterGroupTitle}>หน่วยงาน</div>
          <div className={styles.toggleList}>
            {SEARCH_AGENCIES.map((name) => (
              <button
                type="button"
                key={name}
                className={`${styles.toggleItem} ${agencySel[name] ? styles.toggleItemOn : ""}`}
                onClick={() => setAgencySel((prev) => ({ ...prev, [name]: !prev[name] }))}
              >
                {agencySel[name] ? "☑" : "☐"} {name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <div className={styles.filterGroupTitle}>งบประมาณ (฿)</div>
          <div className={slider.sliderWrap}>
            <svg width="0" height="0" style={{ position: "absolute" }}>
              <defs>
                <filter id={gooId}>
                  <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="b" />
                  <feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="g" />
                  <feComposite in="SourceGraphic" in2="g" operator="atop" />
                </filter>
              </defs>
            </svg>
            <div className={slider.sliderTrackBg} />
            <div className={slider.sliderGoo} style={{ filter: `url(#${gooId})` }}>
              <div className={slider.sliderFill} style={{ left: `${minPct}%`, right: `${maxPct}%` }} />
              <div
                className={slider.sliderBall}
                style={{ left: `${minPct}%`, width: minBallSize, height: minBallSize }}
              />
              <div
                className={`${slider.sliderBall} ${slider.sliderBallMax}`}
                style={{ right: `${maxPct}%`, width: maxBallSize, height: maxBallSize }}
              />
            </div>
            <div
              className={slider.sliderHole}
              style={{ left: `${minPct}%`, width: minHoleSize, height: minHoleSize }}
            />
            <div
              className={`${slider.sliderHole} ${slider.sliderHoleMax}`}
              style={{ right: `${maxPct}%`, width: maxHoleSize, height: maxHoleSize }}
            />
            <input
              type="range"
              className={slider.rangeInput}
              min={BUDGET_FILTER_MIN}
              max={BUDGET_FILTER_MAX}
              step={BUDGET_FILTER_STEP}
              value={minBudget}
              onChange={(e) => setMinBudget(Math.min(Number(e.target.value), maxBudget))}
              onMouseEnter={() => setHoverMin(true)}
              onMouseLeave={() => setHoverMin(false)}
              onTouchStart={() => setHoverMin(true)}
              onTouchEnd={() => setHoverMin(false)}
              aria-label="งบประมาณขั้นต่ำ"
            />
            <input
              type="range"
              className={slider.rangeInput}
              min={BUDGET_FILTER_MIN}
              max={BUDGET_FILTER_MAX}
              step={BUDGET_FILTER_STEP}
              value={maxBudget}
              onChange={(e) => setMaxBudget(Math.max(Number(e.target.value), minBudget))}
              onMouseEnter={() => setHoverMax(true)}
              onMouseLeave={() => setHoverMax(false)}
              onTouchStart={() => setHoverMax(true)}
              onTouchEnd={() => setHoverMax(false)}
              aria-label="งบประมาณสูงสุด"
            />
          </div>
          <div className={slider.sliderLabels}>
            <span>฿500K</span>
            <span className={slider.sliderLabelActive}>
              {formatBudgetShort(minBudget)} — {formatBudgetShort(maxBudget)}
            </span>
            <span>฿9.4M</span>
          </div>
        </div>

        <div className={styles.filterGroup}>
          <div className={styles.filterGroupTitle}>หมวดหมู่</div>
          <div className={styles.pillList}>
            {SEARCH_CATEGORIES.map((name) => (
              <button
                type="button"
                key={name}
                className={`${styles.pill} ${catSel[name] ? styles.pillOn : ""}`}
                onClick={() => setCatSel((prev) => ({ ...prev, [name]: !prev[name] }))}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.filterGroup}>
          <div className={styles.filterGroupTitle}>สถานะ</div>
          <div className={styles.toggleList}>
            <button
              type="button"
              className={`${styles.toggleItem} ${statusOpen ? styles.toggleItemOn : ""}`}
              onClick={() => setStatusOpen(true)}
            >
              {statusOpen ? "◉" : "○"} ยังเปิดรับ
            </button>
            <button
              type="button"
              className={`${styles.toggleItem} ${!statusOpen ? styles.toggleItemOn : ""}`}
              onClick={() => setStatusOpen(false)}
            >
              {statusOpen ? "○" : "◉"} ทั้งหมด (รวมปิดแล้ว)
            </button>
          </div>
        </div>

        <div className={styles.sidebarFoot}>ผลลัพธ์ &lt; 2 วินาที · คลังข้อมูลตัวอย่าง</div>
      </div>

      <div className={styles.results}>
        <div className={styles.searchBar}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="⌕ ค้นหา เช่น ระบบสารสนเทศ, ปรับปรุงถนน…"
          />
          <span className={styles.resultCount}>{results.length} ผลลัพธ์</span>
        </div>

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

        <div className={styles.resultList}>
          {results.map((row) => {
            const badge = badgeFor(row, signedIn);
            return (
              <div
                key={row.slug}
                className={`${styles.resultRow} ${!row.open ? styles.resultRowClosed : ""}`}
                role="link"
                tabIndex={0}
                onClick={() => openRow(row.slug)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openRow(row.slug);
                  }
                }}
              >
                <div className={styles.resultLead}>
                  <div className={styles.badgeRow}>
                    <span className={`${styles.badge} ${badge.className}`}>{badge.label}</span>
                    <span className={styles.resultId}>{row.id}</span>
                  </div>
                  <div className={styles.resultTitle}>{row.title}</div>
                  <div className={styles.resultMeta}>
                    {row.agency} · ประกาศ {row.posted} · คุณภาพ {row.quality}/10
                  </div>
                </div>
                <div className={`${styles.resultPrice} ${priceClassFor(row)}`}>
                  {formatBudgetFull(row.budget)}
                  {row.unverified ? "*" : ""}
                </div>
                <div className={styles.resultDeadline}>
                  {row.open ? "ยื่นภายใน" : "ปิดรับ"}
                  <span className={styles.resultDeadlineValue}>{row.deadline}</span>
                </div>
                {signedIn && (
                <div className={styles.resultActions}>
                  <span
                    className={`${styles.actionBtn} ${styles.starBtn} ${starSel[row.id] ? styles.starBtnOn : ""}`}
                    role="button"
                    tabIndex={0}
                    title="เคยทำงานลักษณะนี้ (ส่วนตัว — ช่วยให้ AI จับคู่แม่นขึ้น ไม่มีผลต่อการค้นหา)"
                    onClick={(e) => toggleStar(e, row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleStar(e, row.id);
                      }
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      className={`${icons.starIcon} ${starSel[row.id] ? icons.starIconOn : ""}`}
                      strokeWidth="2"
                      strokeLinejoin="round"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  </span>
                  <span
                    className={`${styles.actionBtn} ${styles.bookBtn} ${bookSel[row.id] ? styles.bookBtnOn : ""}`}
                    role="button"
                    tabIndex={0}
                    title="บุ๊กมาร์ก — เก็บไว้ดูภายหลัง"
                    onClick={(e) => toggleBook(e, row.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleBook(e, row.id);
                      }
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
              </div>
            );
          })}

          {results.length === 0 && (
            <div className={styles.emptyState}>
              ไม่พบ TOR ที่ตรงกับตัวกรอง —{" "}
              <button type="button" className={styles.emptyClear} onClick={clearFilters}>
                ล้างตัวกรอง
              </button>
            </div>
          )}

          <div className={styles.resultsFootHint}>คลิกรายการเพื่อดูรายละเอียด</div>
        </div>
      </div>
    </main>
  );
}
