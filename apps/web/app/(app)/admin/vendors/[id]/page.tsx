import { notFound, redirect } from "next/navigation";
import { AdminVendorView } from "../../../../../src/views/AdminVendorView";
import { AdminRecordNotFound, fetchAccount } from "../../../../../src/shared/lib/admin-api";
import { isStaff } from "../../../../../src/shared/lib/staff-session";

export const dynamic = "force-dynamic";

/** One vendor account. The API records this read in the account's audit log. */
export default async function AdminVendorPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isStaff())) redirect("/admin/login");
  const { id } = await params;
  try {
    return <AdminVendorView opened={await fetchAccount(id)} />;
  } catch (error) {
    if (error instanceof AdminRecordNotFound) notFound();
    throw error;
  }
}
