import Link from "next/link";
import { redirect } from "next/navigation";
import { MatchLabelSheet } from "../../../../../../src/features/admin/MatchLabelSheet";
import { MatchQualityFigures } from "../../../../../../src/features/admin/MatchQualityFigures";
import styles from "../../../../../../src/features/admin/admin.module.css";
import {
  AdminApiFailed,
  AdminApiUnavailable,
  fetchMatchQuality,
  fetchMatchWorksheet,
  type MatchQualityFigures as Figures,
  type MatchWorksheetItem,
} from "../../../../../../src/shared/lib/admin-api";
import { isStaff } from "../../../../../../src/shared/lib/staff-session";

export const dynamic = "force-dynamic";

/**
 * Labelling one vendor's matches for the match-quality benchmark (design §7.8):
 * the evidence that has to exist before match emails are switched on.
 */
export default async function AdminVendorLabelsPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isStaff())) redirect("/admin/login");
  const { id } = await params;

  let items: MatchWorksheetItem[] | null = null;
  let figures: Figures | null = null;
  let notice: string | null = null;
  try {
    [items, figures] = await Promise.all([fetchMatchWorksheet(id).then((sheet) => sheet.items), fetchMatchQuality()]);
  } catch (error) {
    console.error("[admin/labels] load failed", error);
    notice =
      error instanceof AdminApiFailed && error.reason
        ? error.reason
        : error instanceof AdminApiUnavailable
          ? "ยังไม่ได้เชื่อมต่อกับบริการข้อมูล — ลองใหม่เมื่อบริการทำงาน"
          : "โหลดรายการไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }

  return (
    <main className={styles.logPage}>
      <p className={styles.torsCount}><Link href={`/admin/vendors/${id}`}>← กลับไปที่บัญชี</Link></p>
      <h1 className={styles.overviewTitle}>ตรวจคุณภาพการจับคู่</h1>
      <p className={styles.overviewLede}>
        ตัดสินว่า TOR แต่ละรายการเกี่ยวข้องกับงานของผู้ใช้นี้จริงไหม ผลรวมจากทุกผู้ใช้คือหลักฐานที่ต้องมีก่อนเปิดส่งอีเมลจับคู่อัตโนมัติ
        — กลุ่มแรกคือที่อีเมลจะส่ง กลุ่มที่สองคือตัวอย่างที่อีเมลจะไม่ส่ง
      </p>
      {notice && <div className={styles.overviewOffline}>{notice}</div>}
      {figures && <MatchQualityFigures figures={figures} />}
      {items && <MatchLabelSheet accountId={id} items={items} />}
    </main>
  );
}
