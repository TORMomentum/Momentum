import { redirect } from "next/navigation";
import styles from "../../../../src/features/admin/admin.module.css";
import { AdminApiUnavailable, fetchOtherTerms, type AdminOtherTerms } from "../../../../src/shared/lib/admin-api";
import { isStaff } from "../../../../src/shared/lib/staff-session";

export const dynamic = "force-dynamic";

/**
 * What vendors typed under "อื่นๆ" because no listed option fitted — the
 * evidence for which work categories and certifications to add next. Counts
 * only: nothing here says who typed what.
 */
export default async function AdminTermsPage() {
  if (!(await isStaff())) redirect("/admin/login");

  let terms: AdminOtherTerms | null = null;
  let offline: string | null = null;
  try {
    terms = await fetchOtherTerms();
  } catch (error) {
    console.error("[admin/terms] load failed", error);
    offline =
      error instanceof AdminApiUnavailable
        ? "ยังไม่ได้เชื่อมต่อกับบริการข้อมูล — รายงานจะปรากฏเมื่อบริการทำงาน"
        : "โหลดรายงานไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }

  return (
    <main className={styles.logPage}>
      <h1 className={styles.overviewTitle}>คำที่ผู้ใช้เพิ่มเอง</h1>
      <p className={styles.overviewLede}>
        สิ่งที่ผู้ประกอบการพิมพ์ในช่อง “อื่นๆ” เพราะไม่มีตัวเลือกที่ตรง — ใช้ตัดสินใจว่าจะเพิ่มหมวดงานหรือใบอนุญาตใดในรายการ
        แสดงเฉพาะจำนวนผู้ใช้ ไม่ระบุว่าใครพิมพ์
      </p>

      {offline && <div className={styles.overviewOffline}>{offline}</div>}

      {terms && (
        <>
          <TermsTable title="งานที่ไม่มีในหมวดหมู่" rows={terms.work} />
          <TermsTable title="ใบอนุญาตและการรับรองอื่น" rows={terms.certifications} />
        </>
      )}
    </main>
  );
}

function TermsTable({ title, rows }: { title: string; rows: Array<{ text: string; vendors: number }> }) {
  return (
    <section className={styles.termsSection}>
      <h2 className={styles.termsTitle}>{title}</h2>
      {rows.length === 0 ? (
        <div className={styles.logEmpty}>ยังไม่มีผู้ใช้พิมพ์เพิ่มในส่วนนี้</div>
      ) : (
        <table className={styles.logTable}>
          <thead>
            <tr>
              <th>คำที่พิมพ์</th>
              <th className={styles.termsCount}>จำนวนผู้ใช้</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.text}>
                <td>{row.text}</td>
                <td className={styles.termsCount}>{row.vendors.toLocaleString("th-TH")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
