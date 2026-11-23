import { redirect } from "next/navigation";
import { AdminSourcesView } from "../../../../src/views/AdminSourcesView";
import { AdminApiUnavailable, fetchSources, type AdminSources } from "../../../../src/shared/lib/admin-api";
import { isStaff } from "../../../../src/shared/lib/staff-session";

export const dynamic = "force-dynamic";

/** Ingestion-source health (TOR-293). */
export default async function AdminSourcesPage() {
  if (!(await isStaff())) redirect("/admin/login");

  let data: AdminSources | null = null;
  let offline: string | null = null;
  try {
    data = await fetchSources();
  } catch (error) {
    console.error("[admin/sources] load failed", error);
    offline =
      error instanceof AdminApiUnavailable
        ? "ยังไม่ได้เชื่อมต่อกับบริการข้อมูล — สถานะจะปรากฏเมื่อบริการทำงาน"
        : "โหลดสถานะแหล่งข้อมูลไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }
  return <AdminSourcesView data={data} offline={offline} />;
}
