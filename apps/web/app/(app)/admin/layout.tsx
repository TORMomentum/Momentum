import { AdminShell } from "../../../src/features/admin/AdminShell";

/**
 * Staff area (FR-G). Every screen under /admin shares this chrome and this
 * gate. The API refuses an unauthorised request on its own — the gate here is
 * about not showing a reviewer's screen to someone who cannot use it.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
