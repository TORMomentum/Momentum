import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../../src/features/admin/admin.module.css";
import { AdminApiUnavailable, fetchAccounts, type AdminAccountPage } from "../../../../src/shared/lib/admin-api";
import { isStaff } from "../../../../src/shared/lib/staff-session";

export const dynamic = "force-dynamic";

/** Vendor accounts, newest first. Opening one is recorded in its audit log (NFR-S2). */
export default async function AdminVendorsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  if (!(await isStaff())) redirect("/admin/login");

  const params = await searchParams;
  const q = params.q?.trim().slice(0, 200) || undefined;
  const page = Math.max(1, Math.floor(Number(params.page) || 1));

  let result: AdminAccountPage | null = null;
  let offline: string | null = null;
  try {
    result = await fetchAccounts({ ...(q ? { q } : {}), page });
  } catch (error) {
    console.error("[admin/vendors] load failed", error);
    offline = error instanceof AdminApiUnavailable
      ? "ยังไม่ได้เชื่อมต่อกับบริการข้อมูล — รายการจะปรากฏเมื่อบริการทำงาน"
      : "โหลดรายการไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  const href = (to: number) => `/admin/vendors?${new URLSearchParams({ ...(q ? { q } : {}), ...(to > 1 ? { page: String(to) } : {}) })}`;

  return (
    <main className={styles.logPage}>
      <h1 className={styles.overviewTitle}>ผู้ใช้</h1>
      <p className={styles.overviewLede}>
        บัญชีผู้ประกอบการทั้งหมด — การเปิดดูและทุกการแก้ไขจะถูกบันทึกพร้อมชื่อผู้ดูแล เพราะเป็นข้อมูลส่วนบุคคล
      </p>

      <form className={styles.torsFilters} action="/admin/vendors" method="get" role="search">
        <input className={styles.torsSearch} type="search" name="q" defaultValue={q ?? ""} placeholder="ค้นหาอีเมลหรือชื่อ" aria-label="ค้นหา" maxLength={200} />
        <button type="submit" className={styles.adminSecondaryBtn}>ค้นหา</button>
      </form>

      {offline && <div className={styles.overviewOffline}>{offline}</div>}
      {result && <p className={styles.torsCount}>พบ {result.total.toLocaleString("th-TH")} บัญชี{pages > 1 ? ` · หน้า ${page} จาก ${pages}` : ""}</p>}
      {result && result.rows.length === 0 && <div className={styles.logEmpty}>ไม่พบบัญชีที่ตรงกับเงื่อนไขนี้</div>}

      {result && result.rows.length > 0 && (
        <table className={styles.logTable}>
          <thead>
            <tr><th>อีเมล</th><th>ชื่อ</th><th>สิทธิ์</th><th>สถานะ</th><th>สมัครเมื่อ</th></tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={row.id}>
                <td><Link href={`/admin/vendors/${row.id}`}>{row.email}</Link></td>
                <td>{row.displayName || "—"}</td>
                <td>{row.role === "admin" ? "ผู้ดูแล" : "ผู้ประกอบการ"}</td>
                <td>
                  <span className={`${styles.torsStatus} ${row.disabled ? styles.torsStatusRestricted : row.verified ? styles.torsStatusPublic : styles.torsStatusMuted}`}>
                    {row.disabled ? "ถูกระงับ" : row.verified ? "ใช้งานอยู่" : "ยังไม่ยืนยันอีเมล"}
                  </span>
                </td>
                <td className={styles.logWhen}>{new Date(row.createdAt).toLocaleDateString("th-TH", { dateStyle: "medium" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {result && pages > 1 && (
        <nav className={styles.torsPager} aria-label="หน้า">
          {page > 1 ? <Link href={href(page - 1)}>← ก่อนหน้า</Link> : <span />}
          {page < pages ? <Link href={href(page + 1)}>ถัดไป →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
