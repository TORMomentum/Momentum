import Link from "next/link";
import { AdminTorsTable } from "../features/admin/AdminTorsTable";
import styles from "../features/admin/admin.module.css";
import type { AdminTorKind, AdminTorPage, AdminTorRow, AdminTorStatus } from "../shared/lib/admin-api";

const STATUS_OPTIONS: Array<{ value: AdminTorStatus; label: string }> = [
  { value: "all", label: "ทุกสถานะ" },
  { value: "public", label: "เผยแพร่อยู่" },
  { value: "unverified", label: "ยังไม่ยืนยันการสกัด" },
  { value: "restricted", label: "ถอดจากหน้าสาธารณะ" },
  { value: "processing", label: "กำลังสกัด" },
  { value: "stuck", label: "ค้างในการสกัด" },
  { value: "failed", label: "สกัดไม่สำเร็จ" },
];

const KIND_OPTIONS: Array<{ value: AdminTorKind; label: string }> = [
  { value: "tor", label: "TOR" },
  { value: "invitation", label: "ประกาศเชิญชวน" },
  { value: "all", label: "ทั้งหมด" },
];

/** One status a reviewer can read at a glance; a takedown outranks everything else. */
function statusOf(row: AdminTorRow): { label: string; tone: string } {
  if (row.restricted) return { label: "ถอดจากหน้าสาธารณะ", tone: styles.torsStatusRestricted ?? "" };
  if (row.state === "failed") return { label: "สกัดไม่สำเร็จ", tone: styles.torsStatusFailed ?? "" };
  if (row.state === "queued" || row.state === "extracting")
    return { label: "กำลังสกัด", tone: styles.torsStatusMuted ?? "" };
  if (row.unverified) return { label: "ยังไม่ยืนยันการสกัด", tone: styles.torsStatusMuted ?? "" };
  return { label: "เผยแพร่อยู่", tone: styles.torsStatusPublic ?? "" };
}

/** The list's filters, carried into a record page so "back" returns to the same list. */
function linkSuffix(query: { q?: string; status: AdminTorStatus; kind: AdminTorKind; page: number }): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status !== "all") params.set("status", query.status);
  if (query.kind !== "tor") params.set("kind", query.kind);
  if (query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return search ? `?${search}` : "";
}

function pageHref(query: { q?: string; status: AdminTorStatus; kind: AdminTorKind }, page: number): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status !== "all") params.set("status", query.status);
  if (query.kind !== "tor") params.set("kind", query.kind);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return `/admin/tors${search ? `?${search}` : ""}`;
}

/**
 * The all-records list: search, filter, and open any record in its management screen, where it can be
 * corrected, re-extracted, taken down or restored. A plain GET form, so a filtered list is a link
 * a reviewer can share.
 */
export function AdminTorsView({
  result,
  offline,
  query,
}: {
  result: AdminTorPage | null;
  offline: string | null;
  query: { q?: string; status: AdminTorStatus; kind: AdminTorKind; page: number };
}) {
  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;
  return (
    <main className={styles.logPage}>
      <h1 className={styles.overviewTitle}>TOR ทั้งหมด</h1>
      <p className={styles.overviewLede}>
        ทุกระเบียนในระบบ รวมที่เผยแพร่แล้วและที่ถอดออกจากหน้าสาธารณะ — เปิดเพื่อแก้ไข สกัดใหม่ ถอดออก
        หรือคืนสู่หน้าสาธารณะ
      </p>

      <form className={styles.torsFilters} action="/admin/tors" method="get" role="search">
        <input
          className={styles.torsSearch}
          type="search"
          name="q"
          defaultValue={query.q ?? ""}
          placeholder="ค้นหาชื่อโครงการ หน่วยงาน หรือเลขที่โครงการ"
          aria-label="ค้นหา"
          maxLength={200}
        />
        <select name="status" defaultValue={query.status} aria-label="สถานะ" className={styles.torsSelect}>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <select name="kind" defaultValue={query.kind} aria-label="ชนิดเอกสาร" className={styles.torsSelect}>
          {KIND_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" className={styles.adminSecondaryBtn}>
          ค้นหา
        </button>
      </form>

      {offline && <div className={styles.overviewOffline}>{offline}</div>}

      {result && (
        <p className={styles.torsCount}>
          พบ {result.total.toLocaleString("th-TH")} รายการ
          {pages > 1 ? ` · หน้า ${query.page} จาก ${pages}` : ""}
        </p>
      )}

      {result && result.rows.length === 0 && (
        <div className={styles.logEmpty}>ไม่พบระเบียนที่ตรงกับเงื่อนไขนี้</div>
      )}

      {result && result.rows.length > 0 && (
        <AdminTorsTable
          linkSuffix={linkSuffix(query)}
          query={{ ...(query.q ? { q: query.q } : {}), status: query.status, kind: query.kind }}
          total={result.total}
          rows={result.rows.map((row) => ({
            id: row.id,
            title: row.title,
            invitation: row.documentType === "invitation",
            agency: row.agency,
            projectNumber: row.projectNumber,
            status: statusOf(row),
            createdAt: row.createdAt,
          }))}
        />
      )}

      {result && pages > 1 && (
        <nav className={styles.torsPager} aria-label="หน้า">
          {query.page > 1 ? <Link href={pageHref(query, query.page - 1)}>← ก่อนหน้า</Link> : <span />}
          {query.page < pages ? <Link href={pageHref(query, query.page + 1)}>ถัดไป →</Link> : <span />}
        </nav>
      )}
    </main>
  );
}
