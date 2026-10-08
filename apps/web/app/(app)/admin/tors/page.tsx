import { redirect } from "next/navigation";
import { AdminTorsView } from "../../../../src/views/AdminTorsView";
import {
  AdminApiUnavailable,
  fetchAllTors,
  type AdminTorKind,
  type AdminTorPage,
  type AdminTorStatus,
} from "../../../../src/shared/lib/admin-api";
import { isStaff } from "../../../../src/shared/lib/staff-session";

export const dynamic = "force-dynamic";

const STATUSES: AdminTorStatus[] = ["all", "public", "restricted", "unverified", "processing", "stuck", "failed"];
const KINDS: AdminTorKind[] = ["tor", "invitation", "all"];

/**
 * Every record, not only the ones the review queue holds — a published TOR that turns out wrong,
 * or one taken down, is reached from here. Fetched on the server so the admin key stays there.
 */
export default async function AdminTorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; kind?: string; page?: string }>;
}) {
  if (!(await isStaff())) redirect("/admin/login");

  const params = await searchParams;
  const q = params.q?.trim().slice(0, 200) || undefined;
  const status = STATUSES.find((value) => value === params.status) ?? "all";
  const kind = KINDS.find((value) => value === params.kind) ?? "tor";
  const page = Math.max(1, Math.floor(Number(params.page) || 1));

  let result: AdminTorPage | null = null;
  let offline: string | null = null;
  try {
    result = await fetchAllTors({ ...(q ? { q } : {}), status, kind, page });
  } catch (error) {
    console.error("[admin/tors] load failed", error);
    offline =
      error instanceof AdminApiUnavailable
        ? "ยังไม่ได้เชื่อมต่อกับบริการข้อมูล — รายการจะปรากฏเมื่อบริการทำงาน"
        : "โหลดรายการไม่สำเร็จ — ลองใหม่อีกครั้ง";
  }

  return <AdminTorsView result={result} offline={offline} query={{ ...(q ? { q } : {}), status, kind, page }} />;
}
