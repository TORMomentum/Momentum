import { redirect } from "next/navigation";
import { fetchRecentUploadsAction } from "../../../../src/features/admin/admin.actions";
import { isStaff } from "../../../../src/shared/lib/staff-session";
import { UploadView } from "../../../../src/views/UploadView";

/**
 * Manual intake (TOR-148, Slice-1 Task 13): a form over the same
 * `/intake/upload` endpoint the curl-based demo used, so the GCS pipeline can
 * be shown end to end from the browser instead of a terminal.
 */
export default async function AdminUploadPage() {
  // Page checks protect reads; the separate check inside the Server Action
  // protects a direct submission that never rendered this page.
  if (!(await isStaff())) redirect("/admin/login");

  const initialUploads = await fetchRecentUploadsAction().catch(() => []);

  return <UploadView initialUploads={initialUploads} />;
}
