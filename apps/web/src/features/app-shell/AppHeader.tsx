"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import styles from "./app.module.css";
import { ALL_NOTIFICATIONS, HEADER_NOTIFICATIONS } from "../../data/notifications";

const TABS = [
  { href: "/dashboard", label: "แดชบอร์ด" },
  { href: "/search", label: "ค้นหา TOR" },
  { href: "/profile", label: "โปรไฟล์ของฉัน" },
];

const DOT_CLASS: Record<string, string> = {
  match: styles.bellItemDotMatch,
  deadline: styles.bellItemDotWarn,
  anomaly: styles.bellItemDotWarn,
};

/**
 * Shared chrome for every signed-in screen. The active tab follows the
 * route. Ported from the header block of mockups/TOR Radar App.dc.html
 * (above its `data-screen-label="Dashboard"` main) — only the bell/badge/
 * dropdown from that header is built here; the ADMIN/EMAIL demo chips and
 * the login/logout + avatar-menu state are prototype-only and out of scope
 * (this app shell has no logged-out state, same as the rest of the ported
 * screens).
 */
export function AppHeader() {
  const pathname = usePathname();
  const [bellOpen, setBellOpen] = useState(false);
  // Local to the header, matching the mockup's own `unread` counter — it is
  // not wired to the Notifications screen's own "mark all read" (that screen
  // is a separate route with no shared client store, same as the rest of
  // this app; see VendorProfileView's starred/bookmarked-list note).
  const [unreadCount, setUnreadCount] = useState(
    ALL_NOTIFICATIONS.filter((n) => n.unread).length,
  );

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
        <div className={styles.bellWrap}>
          <button
            type="button"
            title="การแจ้งเตือน"
            className={`${styles.bellButton} ${bellOpen ? styles.bellButtonOpen : ""}`}
            onClick={() => setBellOpen((v) => !v)}
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              className={styles.bellIcon}
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {unreadCount > 0 && <span className={styles.bellBadge}>{unreadCount}</span>}
          </button>

          {bellOpen && (
            <div className={styles.bellPanel}>
              <div className={styles.bellPanelHead}>
                <span className={styles.bellPanelTitle}>การแจ้งเตือน</span>
                <div className={styles.bellPanelActions}>
                  <button
                    type="button"
                    className={styles.bellMarkRead}
                    onClick={() => setUnreadCount(0)}
                  >
                    อ่านทั้งหมด
                  </button>
                  <Link
                    href="/profile#notif-settings"
                    title="ตั้งค่าการแจ้งเตือน"
                    className={styles.bellSettingsBtn}
                    onClick={() => setBellOpen(false)}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      className={styles.bellSettingsIcon}
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                    </svg>
                  </Link>
                </div>
              </div>

              {HEADER_NOTIFICATIONS.map((n) => (
                <Link
                  key={n.id}
                  href={`/tors/${n.torSlug}`}
                  className={styles.bellItem}
                  onClick={() => setBellOpen(false)}
                >
                  <span className={`${styles.bellItemDot} ${DOT_CLASS[n.kind]}`} />
                  <span>
                    <span className={styles.bellItemTitle}>{n.title}</span>
                    <span className={styles.bellItemMeta}>{n.meta}</span>
                  </span>
                </Link>
              ))}

              <Link
                href="/notifications"
                className={styles.bellFooter}
                onClick={() => setBellOpen(false)}
              >
                ดูการแจ้งเตือนทั้งหมด →
              </Link>
            </div>
          )}
        </div>
        <span className={styles.avatar} aria-hidden="true">
          น
        </span>
      </div>
    </header>
  );
}
