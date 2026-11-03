import { redirect } from "next/navigation";
import { AdminTorRecordView } from "../../../../../src/views/AdminTorRecordView";
import {
  AdminRecordNotFound,
  fetchRecord,
  type AdminTorKind,
  type AdminTorStatus,
} from "../../../../../src/shared/lib/admin-api";
import { isStaff } from "../../../../../src/shared/lib/staff-session";

export const dynamic = "force-dynamic";

const STATUSES: AdminTorStatus[] = ["all", "public", "restricted", "unverified", "processing", "failed"];
const KINDS: AdminTorKind[] = ["tor", "invitation", "all"];

/** Server-only routing and fetching: the admin API key never enters the client bundle. */
export default async function AdminTorRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; status?: string; kind?: string; page?: string }>;
}) {
  if (!(await isStaff())) redirect("/admin/login");
  const [{ id }, requested] = await Promise.all([params, searchParams]);
  const q = requested.q?.trim().slice(0, 200) || undefined;
  const status = STATUSES.find((value) => value === requested.status) ?? "all";
  const kind = KINDS.find((value) => value === requested.kind) ?? "tor";
  const page = Math.max(1, Math.floor(Number(requested.page) || 1));
  let record = null;
  try {
    record = await fetchRecord(id);
  } catch (error) {
    if (!(error instanceof AdminRecordNotFound)) {
      console.error("[admin/tors] record load failed", error);
    }
  }
  return (
    <AdminTorRecordView
      record={record}
      documentHref={record ? `/admin/tors/${record.id}/document` : null}
      query={{ ...(q ? { q } : {}), status, kind, page }}
    />
  );
}
