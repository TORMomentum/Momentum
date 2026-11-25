import type { CompetitionPayload } from "../../shared/api/stats.api";
import { formatThaiDateTime } from "../../shared/lib/format";
import styles from "./dashboard.module.css";

const count = (value: number) => value.toLocaleString("th-TH");
const percent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * TOR-281: how the announced winners are spread across categories, from the winner announcements the system has
 * read (TOR-221). Per category: the projects awarded, how many different winners, and the share of those projects
 * the few most frequent winners took. Lowest share first, so the categories where wins are spread widest lead.
 *
 * It states counts and a share and says nothing about whether a category is good or bad to bid in (NFR-F5). It
 * covers only the collected corpus and only winners the AI read and the pipeline confirmed (FR-E-6, NFR-F6), and it
 * names no winner. The number of bidders is not here: bidders are not collected (FR-B-2).
 */
export function CompetitionPanel({ competition }: { competition: CompetitionPayload }) {
  const { categories, rule, meta } = competition;
  if (categories.length === 0) return null;
  const ranked = categories.filter((row) => row.eligible).sort((left, right) => left.topShare - right.topShare || right.awarded - left.awarded);
  const thin = categories.filter((row) => !row.eligible);
  return (
    <section className={styles.competition} aria-labelledby="dashboard-competition-title">
      <div className={styles.panelHead}>
        <h2 id="dashboard-competition-title" className={styles.panelTitle}>ผู้ชนะตามหมวดหมู่</h2>
        <span className={styles.panelHint}>ทั้งระบบ ไม่เปลี่ยนตามตัวกรอง · จากประกาศผู้ชนะ {count(meta.awardedProjects)} โครงการ</span>
      </div>
      {ranked.length > 0 ? (
        // Two columns: the category with its counts beneath it, then the share as a bar across the rest of the panel
        // with its figure at the end. Four columns across the page left each name far from its numbers.
        <table className={styles.competitionTable}>
          <colgroup>
            <col />
            <col className={styles.competitionShare} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">หมวดหมู่</th>
              <th scope="col">สัดส่วนโครงการที่ผู้ชนะ {rule.topWinners} รายแรกได้</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => (
              <tr key={row.category}>
                <th scope="row">
                  <span className={styles.competitionName}>{row.category}</span>
                  <span className={styles.competitionMeta}>
                    ประกาศผล {count(row.awarded)} โครงการ · ผู้ชนะ {count(row.winners)} ราย
                  </span>
                </th>
                <td>
                  <span className={styles.competitionBar}>
                    <span className={styles.competitionTrack} aria-hidden="true">
                      <span className={styles.barFill} style={{ width: percent(row.topShare) }} />
                    </span>
                    <span className={styles.competitionValue}>{percent(row.topShare)}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.method}>ยังไม่มีหมวดหมู่ที่มีประกาศผลถึง {count(rule.minAwarded)} โครงการ จึงยังเทียบกันไม่ได้</p>
      )}
      {thin.length > 0 && (
        <p className={styles.method}>
          ยังเทียบไม่ได้ เพราะมีประกาศผลไม่ถึง {count(rule.minAwarded)} โครงการ: {thin.map((row) => `${row.category} (${count(row.awarded)})`).join(", ")}
        </p>
      )}
      <p className={styles.method}>
        นับจากประกาศผู้ชนะที่ AI อ่านและยืนยันแล้ว ครอบคลุมเฉพาะโครงการที่ระบบรวบรวมได้ ไม่รวมจำนวนผู้ยื่นซอง ตัวเลขนี้บอกการกระจายของผู้ชนะ ไม่ได้บอกว่าหมวดใดควรหรือไม่ควรเข้าแข่ง
        {meta.lastAwardAt && <> · อ่านประกาศล่าสุด {formatThaiDateTime(meta.lastAwardAt)}</>}
      </p>
    </section>
  );
}
