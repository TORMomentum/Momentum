import { MATCH_RANGE, matchPercent } from "@tor-radar/shared";
import Link from "next/link";
import type { OwnMatches } from "../../shared/api/matches.api";
import { DEADLINE_SOON_DAYS, daysLeftLabel, daysUntil, formatBaht, thaiDigitsToArabic } from "../../shared/lib/format";
import styles from "./dashboard.module.css";

/** Matches listed on the dashboard; the rest stay a profile edit or a search away. */
const MATCHES_SHOWN = 5;

/**
 * The signed-in vendor's part of the dashboard (TOR-154): open TORs that may be
 * relevant to the work, area and budget in their profile, best first.
 *
 * "May be relevant", never "matches you": the weights are not yet calibrated
 * against a labelled benchmark (matching design §7.8). The score is still
 * shown, as the same badge search shows, because search filters on it — a
 * vendor who sees 72% here must find that TOR under a 70% filter there. It
 * ranks; the reason beside it is what a vendor can check for themselves.
 */
export function MatchesPanel({ matches }: { matches: OwnMatches | null }) {
  return (
    <section className={styles.matches} aria-labelledby="dashboard-matches-title">
      <div className={styles.panelHead}>
        <h2 id="dashboard-matches-title" className={styles.panelTitle}>TOR ที่อาจเกี่ยวข้องกับคุณ</h2>
        <Link href="/profile" className={styles.panelClear}>แก้ไขโปรไฟล์</Link>
      </div>

      {matches === null ? (
        <p className={styles.matchesNote}>ยังโหลดรายการที่เกี่ยวข้องไม่ได้ โปรดลองใหม่อีกครั้ง</p>
      ) : matches.reason ? (
        <p className={styles.matchesNote}>
          {matches.reason} — <Link href="/profile">ตั้งค่าโปรไฟล์</Link>
        </p>
      ) : matches.items.length === 0 ? (
        <p className={styles.matchesNote}>ยังไม่มี TOR ที่เปิดรับข้อเสนอซึ่งเกี่ยวข้องกับโปรไฟล์ของคุณ</p>
      ) : (
        <>
          <p className={styles.panelHint}>เรียงตามหมวดงานและช่วงงบประมาณในโปรไฟล์ของคุณ · เฉพาะ TOR ที่ยังเปิดรับข้อเสนอ</p>
          <ul className={styles.matchesList}>
            {matches.items.slice(0, MATCHES_SHOWN).map((row) => {
              const days = daysUntil(row.deadline.value);
              const left = daysLeftLabel(days);
              const why = row.reasons.find((reason) => reason.code.startsWith("category") || reason.code === "free-text");
              return (
                <li key={row.id} className={styles.matchRow}>
                  <div className={styles.matchMain}>
                    <Link href={`/tors/${row.id}`} className={styles.matchTitle}>
                      {row.title || "ไม่พบชื่อโครงการในเอกสาร"}
                    </Link>
                    <div className={styles.matchMeta}>
                      {row.agency ? thaiDigitsToArabic(row.agency) : "ไม่ระบุหน่วยงาน"}
                      {row.unverified && <span className={styles.matchUnverified}> · ยังไม่ยืนยันการสกัด</span>}
                    </div>
                    {why && <div className={styles.matchWhy}>{why.th}</div>}
                  </div>
                  <div className={styles.matchSide}>
                    <div className={styles.matchScore} aria-label={`ความเกี่ยวข้อง ${matchPercent(row.score)}%`}>
                      {matchPercent(row.score)}%
                    </div>
                    <div className={styles.matchBudget} title={row.budget.verified ? undefined : "ค่าที่สกัดยังไม่ได้รับการยืนยัน"}>
                      {typeof row.budget.value === "number" ? formatBaht(row.budget.value) : row.budget.raw || "ไม่ระบุงบประมาณ"}
                      {row.budget.raw && !row.budget.verified && "*"}
                    </div>
                    {left ? (
                      <div className={`${styles.matchDays} ${days !== null && days <= DEADLINE_SOON_DAYS ? styles.matchDaysSoon : ""}`}>
                        {left}
                      </div>
                    ) : (
                      <div className={styles.matchMeta}>รอประกาศเชิญชวน</div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {matches.items.length > MATCHES_SHOWN && (
            <p className={styles.panelHint}>
              และอีก {matches.items.length - MATCHES_SHOWN} รายการ —{" "}
              {/* Any score above the floor is "one of my matches"; search pages
                  through all of them with the same filter the slider sets. */}
              <Link href={`/search?minMatch=${MATCH_RANGE.floor + 1}&state=open`}>ดูทั้งหมดในหน้าค้นหา</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
