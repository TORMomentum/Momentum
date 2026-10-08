import Link from "next/link";
import { RecordPanel } from "../features/admin/RecordPanel";
import styles from "../features/admin/admin.module.css";
import type { AdminTorKind, AdminTorStatus, ReviewRecord } from "../shared/lib/admin-api";

function listHref(query: { q?: string; status: AdminTorStatus; kind: AdminTorKind; page: number }) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status !== "all") params.set("status", query.status);
  if (query.kind !== "tor") params.set("kind", query.kind);
  if (query.page > 1) params.set("page", String(query.page));
  const search = params.toString();
  return `/admin/tors${search ? `?${search}` : ""}`;
}

export function AdminTorRecordView({
  record,
  documentHref,
  query,
}: {
  record: ReviewRecord | null;
  documentHref: string | null;
  query: { q?: string; status: AdminTorStatus; kind: AdminTorKind; page: number };
}) {
  const back = listHref(query);
  return (
    <main className={styles.adminPage}>
      <div className={styles.adminBar}>
        <Link href={back} className={styles.adminExitLink}>
          ← กลับไป TOR ทั้งหมด
        </Link>
        <h1 className={styles.adminTitle}>จัดการระเบียน TOR</h1>
      </div>
      {record ? (
        <div className={styles.adminRecordBody}>
          {/* The key resets drafts, dialogs and document state when a different record is opened. */}
          <RecordPanel key={record.id} record={record} documentHref={documentHref} mode="manage" />
        </div>
      ) : (
        <div className={styles.adminRecordNotFound}>
          <p>ไม่พบระเบียน TOR นี้ในระบบ</p>
          <Link href={back}>กลับไป TOR ทั้งหมด</Link>
        </div>
      )}
    </main>
  );
}
