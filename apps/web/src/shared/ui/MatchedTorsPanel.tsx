import Link from "next/link";
import { MATCH_RANGE, matchPercent as percentOf } from "@tor-radar/shared";
import type { MatchRow, OwnMatches } from "../api/matches.api";
import { DEADLINE_SOON_DAYS, daysLeftLabel, daysUntil, formatBaht, thaiDigitsToArabic } from "../lib/format";
import styles from "./matched-tors.module.css";

/** Enough to act on at a glance; the rest are a search away. */
const SHOWN = 5;

/** The reason that says what kind of work it is — the one a vendor checks first. */
function isWorkReason(code: string): boolean {
  return code.startsWith("category") || code === "free-text";
}

/** Every match the scorer returned, as the search lists them: its own filter at the lowest step. */
export const ALL_MATCHES_HREF = `/search?minMatch=${MATCH_RANGE.step}`;

/**
 * The vendor's best matches, at the top of the dashboard they land on after
 * signing in and of the search page before they search (TOR-217) — the
 * question they arrive with is "is there anything for me".
 *
 * Every row says WHY it matched, in the scorer's own Thai sentences (NFR-F6:
 * AI-assisted output is explainable). The score is shown as the scorer's own
 * figure, never rounded into a promise; matching ranks, it does not certify.
 */
export function MatchedTorsPanel({
  matches,
  title = "TOR ที่ตรงกับคุณ",
  headingId = "matched-heading",
}: {
  matches: OwnMatches;
  title?: string;
  headingId?: string;
}) {
  const rows = matches.items.slice(0, SHOWN);

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          {title}
        </h2>
        <Link href="/profile" className={styles.edit}>
          ปรับโปรไฟล์การจับคู่
        </Link>
      </div>

      {matches.reason ? (
        <p className={styles.empty}>
          {matches.reason} — <Link href="/profile">ไปที่โปรไฟล์</Link>
        </p>
      ) : rows.length === 0 ? (
        <p className={styles.empty}>
          ยังไม่มี TOR ที่เปิดรับและตรงกับโปรไฟล์ของคุณในขณะนี้ — เราจะแสดงที่นี่เมื่อมี
        </p>
      ) : (
        <ol className={styles.list}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row}>
              {/* Score and time left together on the left: the two things that
                  decide which card to open first. */}
              <div className={styles.lead}>
                <span className={styles.score} aria-label={`ความเกี่ยวข้อง ${percentOf(row.score)}%`}>
                  {percentOf(row.score)}%
                </span>
                <DaysLeft row={row} />
              </div>
              <div className={styles.body}>
                <Link href={`/tors/${row.id}`} className={styles.rowTitle}>
                  {row.title || "ไม่พบชื่อโครงการในเอกสาร"}
                </Link>
                <div className={styles.agency}>
                  {row.agency ? thaiDigitsToArabic(row.agency) : "ไม่ระบุหน่วยงาน"}
                  {row.unverified && <span> · ยังไม่ยืนยันการสกัด</span>}
                </div>
                {/* One reason, the one that differs card to card: what kind of
                    work it is. The budget reason read the same on nearly every
                    card, and the budget itself is already on the right. */}
                <WorkReason row={row} />
              </div>
              <Budget row={row} />
            </li>
          ))}
        </ol>
      )}

      {matches.items.length > SHOWN && (
        <p className={styles.more}>
          และอีก {matches.items.length - SHOWN} รายการที่ตรงกับคุณ — <Link href={ALL_MATCHES_HREF}>ดูทั้งหมด</Link>
        </p>
      )}
    </section>
  );
}

/** Under the score; "รอประกาศเชิญชวน" while no deadline has been announced. */
function DaysLeft({ row }: { row: MatchRow }) {
  const days = daysUntil(row.deadline.value);
  const left = daysLeftLabel(days);
  if (!left) return <div className={styles.waiting}>รอประกาศเชิญชวน</div>;
  return <div className={`${styles.days} ${days !== null && days <= DEADLINE_SOON_DAYS ? styles.daysSoon : ""}`}>{left}</div>;
}

/** The budget on the right, starred while the extraction is unconfirmed. */
function Budget({ row }: { row: MatchRow }) {
  return (
    <div className={styles.budget} title={row.budget.verified ? undefined : "ค่าที่สกัดยังไม่ได้รับการยืนยัน"}>
      {typeof row.budget.value === "number" ? formatBaht(row.budget.value) : row.budget.raw || "ไม่ระบุงบประมาณ"}
      {row.budget.raw && !row.budget.verified && "*"}
    </div>
  );
}

function WorkReason({ row }: { row: MatchRow }) {
  const reason = row.reasons.find((item) => isWorkReason(item.code));
  return reason ? <div className={styles.reasonWork}>{reason.th}</div> : null;
}
