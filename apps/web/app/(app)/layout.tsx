import { Suspense } from "react";
import { AppHeader } from "../../src/features/app-shell/AppHeader";
import { StaffModeSwitch } from "../../src/features/app-shell/StaffModeSwitch";
import styles from "../../src/features/app-shell/app-shell.module.css";

/**
 * The shell does NOT await the staff session.
 *
 * It used to. Reading the `httpOnly` cookie here made every route under the
 * shell dynamic and started the response before a page could finish deciding
 * what it was — so a page calling `notFound()` rendered the right screen with
 * an HTTP 200, and a crawler was told a missing TOR exists.
 *
 * The session-dependent piece is passed in as a slot instead: it resolves on
 * the server inside its own `<Suspense>` boundary, and the pages above it keep
 * their status codes. This is what the rendering spec §7 asks for — the public
 * shell stays static, the personal part streams into its own hole.
 *
 * The fallback is `null` rather than a placeholder: this control only exists
 * for a reviewer who already has a session, and a shape flashing in the header
 * for everyone else would advertise a door most readers cannot open.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.shell}>
      <AppHeader
        staffSlot={
          <Suspense fallback={null}>
            <StaffModeSwitch />
          </Suspense>
        }
      />
      {children}
    </div>
  );
}
