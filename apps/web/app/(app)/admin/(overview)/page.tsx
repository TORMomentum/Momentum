import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "../../../../src/features/admin/admin.module.css";
import { fetchOverview, AdminApiUnavailable } from "../../../../src/shared/lib/admin-api";
import { isStaff } from "../../../../src/shared/lib/staff-session";

/**
 * The staff landing page: what needs doing, and where the rest of the area is.
 *
 * A server component, so the admin key stays on this side and the page arrives
 * rendered. Nothing here is cached — a reviewer opening this page wants the
 * queue as it is now, not as it was when someone else loaded it.
 */
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  // Page checks protect reads; the separate checks inside Server Actions
  // protect direct mutation requests that never render this page.
  if (!(await isStaff())) redirect("/admin/login");

  let overview = null;
  let offline: string | null = null;

  try {
    overview = await fetchOverview();
  } catch (error) {
    // The API not running is the normal case on a laptop, so it is reported
    // plainly instead of throwing a stack trace at a reviewer.
    console.error("[admin/overview] load failed", error);
    offline =
      error instanceof AdminApiUnavailable
        ? "ยังไม่ได้เชื่อมต่อกับบริการข้อมูล — ตัวเลขจะปรากฏเมื่อบริการทำงาน"
        : "โหลดภาพรวมไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }

  return (
    <main className={styles.overviewPage}>
      <h1 className={styles.overviewTitle}>ภาพรวมงานผู้ดูแล</h1>
      <p className={styles.overviewLede}>
        คุณภาพข้อมูลที่เผยแพร่ขึ้นอยู่กับคิวนี้ — เอกสารที่ AI สกัดได้ไม่ครบหรือไม่ผ่านการตรวจความสมเหตุสมผล
        จะรออยู่ที่นี่จนกว่าจะมีคนตรวจ
      </p>

      {offline && <div className={styles.overviewOffline}>{offline}</div>}

      {overview && (
        <div className={styles.overviewGrid}>
          {/* Every count opens the records behind it: a number you cannot click
              into is a number you cannot act on. */}
          <Link href="/admin/review" className={`${styles.overviewCard} ${overview.needsReview > 0 ? styles.overviewCardAction : ""}`}>
            <div className={styles.overviewCardKey}>รอตรวจสอบ</div>
            <div
              className={`${styles.overviewCardValue} ${overview.needsReview > 0 ? styles.overviewCardActionValue : ""}`}
            >
              {overview.needsReview}
            </div>
            <div className={styles.overviewCardNote}>ความเชื่อมั่นต่ำกว่าเกณฑ์ หรือไม่ผ่านการตรวจ</div>
          </Link>

          <Link href="/admin/tors?status=unverified" className={styles.overviewCard}>
            <div className={styles.overviewCardKey}>ยังไม่ยืนยัน · ไม่เข้าคิว</div>
            <div className={styles.overviewCardValue}>{overview.unverifiedNotQueued}</div>
            <div className={styles.overviewCardNote}>เผยแพร่พร้อมป้ายกำกับ ไม่ต้องรอคนตรวจ</div>
          </Link>

          <Link href="/admin/tors?status=public" className={styles.overviewCard}>
            <div className={styles.overviewCardKey}>เผยแพร่แล้ว</div>
            <div className={styles.overviewCardValue}>{overview.published}</div>
            <div className={styles.overviewCardNote}>จากทั้งหมด {overview.stored} ฉบับที่นำเข้า</div>
          </Link>

          <Link href="/admin/tors?status=stuck" className={`${styles.overviewCard} ${overview.stuck > 0 ? styles.overviewCardAction : ""}`}>
            <div className={styles.overviewCardKey}>ค้างในการสกัด</div>
            <div className={`${styles.overviewCardValue} ${overview.stuck > 0 ? styles.overviewCardActionValue : ""}`}>{overview.stuck}</div>
            <div className={styles.overviewCardNote}>อยู่ในคิวหรือกำลังสกัดนานเกินกว่าที่ควร · เลือกแล้วสั่งสกัดใหม่ได้</div>
          </Link>

          <Link href="/admin/tors?status=failed" className={styles.overviewCard}>
            <div className={styles.overviewCardKey}>สกัดไม่สำเร็จ</div>
            <div className={styles.overviewCardValue}>{overview.failed}</div>
            <div className={styles.overviewCardNote}>ต้นฉบับยังเก็บไว้ครบ · สั่งสกัดใหม่ได้</div>
          </Link>

          <div className={styles.overviewCard}>
            <div className={styles.overviewCardKey}>การแก้ไขที่บันทึกไว้</div>
            <div className={styles.overviewCardValue}>{overview.corrections}</div>
            <div className={styles.overviewCardNote}>ใช้เป็นตัวอย่างสอน extractor</div>
          </div>
        </div>
      )}

      <div className={styles.overviewSections}>
        <Link href="/admin/review" className={styles.overviewLink}>
          <div className={styles.overviewLinkTitle}>คิวตรวจสอบการสกัดข้อมูล →</div>
          <div className={styles.overviewLinkBody}>
            เทียบเอกสารต้นฉบับกับฟิลด์ที่สกัดได้ แก้ไข อนุมัติ สั่งสกัดใหม่ หรือปฏิเสธ
          </div>
        </Link>

        <Link href="/admin/upload" className={styles.overviewLink}>
          <div className={styles.overviewLinkTitle}>อัปโหลดเอกสาร →</div>
          <div className={styles.overviewLinkBody}>
            นำเข้าเอกสาร TOR โดยตรงจากเครื่อง เข้าสู่คิวประมวลผลเช่นเดียวกับช่องทางอื่น
          </div>
        </Link>

        <Link href="/admin/log" className={styles.overviewLink}>
          <div className={styles.overviewLinkTitle}>บันทึกกิจกรรม →</div>
          <div className={styles.overviewLinkBody}>
            ทุกการเปลี่ยนสถานะของทุกระเบียน พร้อมผู้กระทำและเหตุผล
          </div>
        </Link>
      </div>
    </main>
  );
}
