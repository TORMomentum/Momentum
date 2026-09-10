import { AppHeader } from "../../src/features/app-shell/AppHeader";
import styles from "../../src/features/app-shell/app-shell.module.css";
import { isStaff } from "../../src/shared/lib/staff-session";

/**
 * The staff session is decided here, on the server, because the cookie that
 * carries it is `httpOnly` — the header cannot read it and must be told.
 *
 * That a privileged session is active is shown wherever it is active, not only
 * inside /admin: it is how a reviewer gets back, and it is how they know they
 * are still holding staff rights while reading the public site.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await isStaff();

  return (
    <div className={styles.shell}>
      <AppHeader staff={staff} />
      {children}
    </div>
  );
}
