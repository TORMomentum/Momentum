"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./app-shell.module.css";
import { AccountControls } from "./AccountControls";
import { useViewer } from "../../shared/lib/viewer";

/** โปรไฟล์ของฉัน is vendor-only: the mockup hides that tab when signed out. */
const PUBLIC_TABS = [
  { href: "/dashboard", label: "แดชบอร์ด" },
  { href: "/search", label: "ค้นหา TOR" },
];
const VENDOR_TABS = [...PUBLIC_TABS, { href: "/profile", label: "โปรไฟล์ของฉัน" }];

/**
 * Shared chrome for every in-app screen. The active tab follows the route.
 * Ported from the header block of mockups/TOR Radar App.dc.html (above its
 * `data-screen-label="Dashboard"` main). The ADMIN/EMAIL chips are prototype
 * navigation for jumping between demo states and are deliberately absent.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { signedIn, ready } = useViewer();

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        TOR RADAR
      </Link>
      <nav className={styles.tabs}>
        {(signedIn ? VENDOR_TABS : PUBLIC_TABS).map((tab) => {
          const active = pathname.startsWith(tab.href);
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
        {ready && !signedIn && (
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
