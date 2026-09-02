"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./app.module.css";

const TABS = [
  { href: "/dashboard", label: "แดชบอร์ด" },
  { href: "/search", label: "ค้นหา TOR" },
  { href: "/profile", label: "โปรไฟล์ของฉัน" },
];

/** Shared chrome for every signed-in screen. The active tab follows the route. */
export function AppHeader() {
  const pathname = usePathname();

  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        TOR RADAR
      </Link>
      <nav className={styles.tabs}>
        {TABS.map((tab) => {
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
        <span className={styles.alerts}>● MATCH ALERTS ON</span>
        <span className={styles.avatar} aria-hidden="true">
          น
        </span>
      </div>
    </header>
  );
}
