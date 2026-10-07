import { matchPercent } from "@tor-radar/shared";
import Link from "next/link";
import type { MatchRow, OwnMatches } from "../../shared/api/matches.api";
import { DEADLINE_SOON_DAYS, daysLeftLabel, daysUntil, formatBaht, thaiDigitsToArabic } from "../../shared/lib/format";
import styles from "./matched-tors.module.css";

/** Enough to act on at a glance; the rest are a search away. */
const SHOWN = 5;

/** The reason that says what kind of work it is — the one a vendor checks first. */
function isWorkReason(code: string): boolean {
  return code.startsWith("category") || code === "free-text";
}

/**
 * The vendor's best matches, at the top of the dashboard they land on after
 * signing in — the question they arrive with is "is there anything for me".
 *
 * Every row says WHY it matched, in the scorer's own Thai sentences (NFR-F6:
 * AI-assisted output is explainable). The score is shown as the scorer's own
 * figure, never rounded into a promise; matching ranks, it does not certify.
 */
export function MatchedTorsPanel({ matches }: { matches: OwnMatches }) {
  const rows = matches.items.slice(0, SHOWN);

  return (
    <section className={styles.panel} aria-labelledby="matched-heading">
      <div className={styles.head}>
        <h2 id="matched-heading" className={styles.title}>
          TOR ที่ตรงกับคุณ
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
              <span className={styles.score} aria-label={`ความเกี่ยวข้อง ${matchPercent(row.score)}%`}>
                {matchPercent(row.score)}%
              </span>
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
              <RowSide row={row} />
            </li>
          ))}
        </ol>
      )}

      {matches.items.length > SHOWN && (
        <p className={styles.more}>และอีก {matches.items.length - SHOWN} รายการที่ตรงกับคุณ — ดูได้ในหน้าค้นหา</p>
      )}
    </section>
  );
}

/** Budget and time left: the two facts that decide whether to open the TOR. */
function RowSide({ row }: { row: MatchRow }) {
  const days = daysUntil(row.deadline.value);
  const left = daysLeftLabel(days);
  return (
    <div className={styles.side}>
      <div className={styles.budget} title={row.budget.verified ? undefined : "ค่าที่สกัดยังไม่ได้รับการยืนยัน"}>
        {typeof row.budget.value === "number" ? formatBaht(row.budget.value) : row.budget.raw || "ไม่ระบุงบประมาณ"}
        {row.budget.raw && !row.budget.verified && "*"}
      </div>
      {left ? (
        <div className={`${styles.days} ${days !== null && days <= DEADLINE_SOON_DAYS ? styles.daysSoon : ""}`}>{left}</div>
      ) : (
        <div className={styles.waiting}>รอประกาศเชิญชวน</div>
      )}
    </div>
  );
}

function WorkReason({ row }: { row: MatchRow }) {
  const reason = row.reasons.find((item) => isWorkReason(item.code));
  return reason ? <div className={styles.reasonWork}>{reason.th}</div> : null;
}
