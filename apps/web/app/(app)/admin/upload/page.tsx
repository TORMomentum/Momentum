import { redirect } from "next/navigation";
import styles from "../../../../src/features/admin/admin.module.css";
import { isStaff } from "../../../../src/shared/lib/staff-session";
import { UploadForm } from "../../../../src/features/admin/UploadForm";

/**
 * Manual intake (TOR-148): a form over the same `/intake/upload` endpoint the
 * curl-based demo used, so the GCS pipeline can be shown end to end from the
 * browser instead of a terminal.
 */
export default async function AdminUploadPage() {
  // Page checks protect reads; the separate check inside the Server Action
  // protects a direct submission that never rendered this page.
  if (!(await isStaff())) redirect("/admin/login");

  return (
    <main className={styles.uploadPage}>
      <div className={styles.uploadPageInner}>
        <h1 className={styles.overviewTitle}>อัปโหลดเอกสาร TOR</h1>
        <p className={styles.overviewLede}>
          นำเข้าเอกสารโดยตรง — ไฟล์จะถูกเก็บอย่างถาวรและเข้าสู่คิวประมวลผลอัตโนมัติ
        </p>

        <UploadForm />
      </div>
    </main>
  );
}
