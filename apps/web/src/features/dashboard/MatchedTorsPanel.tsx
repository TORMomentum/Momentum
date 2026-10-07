import { matchPercent } from "@tor-radar/shared";
import Link from "next/link";
import type { OwnMatches } from "../../shared/api/matches.api";
import styles from "./matched-tors.module.css";

/** Enough to act on at a glance; the rest are a search away. */
const SHOWN = 5;

/** Each match carries several reasons; two say why without crowding the row. */
const REASONS_SHOWN = 2;

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
                <ul className={styles.reasons}>
                  {row.reasons.slice(0, REASONS_SHOWN).map((reason) => (
                    <li key={reason.code}>{reason.th}</li>
                  ))}
                </ul>
              </div>
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
