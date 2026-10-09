"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./app-shell.module.css";
import { AccountControls } from "./AccountControls";
import { ModeToggle } from "./ModeToggle";
import { useViewer } from "../../shared/lib/viewer";

/** โปรไฟล์ของฉัน is vendor-only: the mockup hides that tab when signed out. */
const PUBLIC_TABS = [
  { href: "/dashboard", label: "แดชบอร์ด" },
  { href: "/search", label: "ค้นหา TOR" },
];
const VENDOR_TABS = [...PUBLIC_TABS, { href: "/profile", label: "โปรไฟล์ของฉัน" }];

/**
 * Inside the staff area the header carries the staff sections instead of the
 * vendor ones. One navigation bar, not a second band under the first — a
 * reviewer is in a different mode, not on a different site.
 */
const ADMIN_TABS = [
  { href: "/admin", label: "ภาพรวม", exact: true },
  { href: "/admin/review", label: "คิวตรวจสอบ" },
  { href: "/admin/tors", label: "TOR ทั้งหมด" },
  { href: "/admin/vendors", label: "ผู้ใช้" },
  { href: "/admin/upload", label: "อัปโหลดเอกสาร" },
  { href: "/admin/log", label: "บันทึกกิจกรรม" },
];

/**
 * Shared chrome for every in-app screen. The active tab follows the route.
 * Ported from the header block of mockups/TOR Radar App.dc.html (above its
 * `data-screen-label="Dashboard"` main). The ADMIN/EMAIL chips are prototype
 * navigation for jumping between demo states and are deliberately absent.
 */
export function AppHeader({ staffSlot }: { staffSlot?: React.ReactNode }) {
  const pathname = usePathname();
  const { signedIn, ready } = useViewer();
  const inAdmin = pathname.startsWith("/admin");
  const tabs = inAdmin ? ADMIN_TABS : signedIn ? VENDOR_TABS : PUBLIC_TABS;

  return (
    <header className={`${styles.header} ${inAdmin ? styles.headerAdmin : ""}`}>
      <Link href="/" className={styles.brand}>
        TOR RADAR
      </Link>
      {inAdmin && <span className={styles.adminBadge}>ผู้ดูแลระบบ</span>}
      <nav className={styles.tabs}>
        {tabs.map((tab) => {
          const active = "exact" in tab && tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`${styles.tab} ${active ? styles.tabActive : ""}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className={styles.headerRight}>
        {/*
          Nothing is rendered until the stored viewer state has been read, so
          the header never flashes the wrong branch on first paint.
        */}
        {/*
          One slot, two states. Inside the staff area it leaves; outside it,
          while the staff session is still alive, it goes back — otherwise
          leaving the area is a one-way door, which is what it was.

          Leaving the VIEW is not ending the SESSION. Ending it lives in the
          account menu, with the other sign-out.
        */}
        {inAdmin && <ModeToggle mode="admin" />}

        {/* Server-rendered and passed in, because the cookie is httpOnly and a
            client component cannot read it. Renders nothing unless a staff
            session is live, so this slot is usually empty. Its wording mirrors
            the exit above — see StaffModeSwitch. */}
        {!inAdmin && staffSlot}

        {ready && !signedIn && !inAdmin && (
          <>
            <Link href="/login" className={styles.signIn}>
              เข้าสู่ระบบ
            </Link>
            <Link href="/login?mode=signup" className={styles.registerCta}>
              ลงทะเบียนผู้ประกอบการ
            </Link>
          </>
        )}

        {ready && signedIn && <AccountControls />}
      </div>
    </header>
  );
}
