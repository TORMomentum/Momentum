import { redirect } from "next/navigation";
import { AdminSignInNotice } from "../../../../src/features/admin/AdminSignInNotice";
import { readViewerSession } from "../../../../src/shared/api/viewer-session";

// Reads the session on every request: who is asking decides what this page says.
export const dynamic = "force-dynamic";

export default async function AdminSignInPage() {
  const { account } = await readViewerSession();
  if (account?.role === "admin") redirect("/admin");
  return <AdminSignInNotice signedInAs={account?.email ?? null} />;
}
