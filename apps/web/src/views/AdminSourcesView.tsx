import { SourceHealthTable } from "../features/admin/SourceHealthTable";
import styles from "../features/admin/admin.module.css";
import type { AdminSources } from "../shared/lib/admin-api";

/** `/admin/sources` (TOR-293): the health of every source TORs are collected from. */
export function AdminSourcesView({ data, offline }: { data: AdminSources | null; offline: string | null }) {
  return (
    <main className={styles.logPage}>
      <h1 className={styles.overviewTitle}>แหล่งข้อมูล</h1>
      <p className={styles.overviewLede}>
        สถานะของแต่ละแหล่งที่ระบบดึงประกาศและเอกสาร TOR มา — ดึงสำเร็จล่าสุดเมื่อไร ล้มเหลวเพราะอะไร และได้ระเบียนมาเท่าไร
      </p>
      {offline && <div className={styles.overviewOffline}>{offline}</div>}
      {data && <SourceHealthTable data={data} />}
    </main>
  );
}
