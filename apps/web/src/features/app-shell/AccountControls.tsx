"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./app-shell.module.css";
import { HEADER_NOTIFICATIONS } from "../../data/notifications";
import { useNotifications } from "../../shared/lib/notifications";
import { useViewer } from "../../shared/lib/viewer";
import { endStaffSessionAction } from "./session.actions";

const DOT_CLASS: Record<string, string> = {
  match: styles.bellItemDotMatch,
  deadline: styles.bellItemDotWarn,
  anomaly: styles.bellItemDotWarn,
};

/**
 * The bell and the account menu — everything in the header that only exists
 * for a signed-in vendor. Ported from the header block of
 * mockups/TOR Radar App.dc.html.
 *
 * It lives on its own because BOTH headers need it: the app shell and the
 * public landing page's fixed nav, which swaps its เข้าสู่ระบบ / ลงทะเบียน
 * pair for these controls once someone is signed in.
 */
export function AccountControls() {
  const router = useRouter();
  const { account, signOut } = useViewer();
  const { items, unreadCount, markRead, markAllRead } = useNotifications();
  const [bellOpen, setBellOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Clicking elsewhere, or Escape, closes whichever panel is open — otherwise
  // it follows the reader down the page.
  useEffect(() => {
    if (!bellOpen && !menuOpen) return;

    function close() {
      setBellOpen(false);
      setMenuOpen(false);
    }
    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [bellOpen, menuOpen]);

  const unreadById = new Map(items.map((item) => [item.id, item.unread]));
  const initial = (account?.name ?? "").trim().charAt(0) || "ผ";

  return (
    <div className={styles.accountControls} ref={wrap}>
      <div className={styles.bellWrap}>
        <button
          type="button"
          title="การแจ้งเตือน"
          className={`${styles.bellButton} ${bellOpen ? styles.bellButtonOpen : ""}`}
          onClick={() => {
            setBellOpen((open) => !open);
            setMenuOpen(false);
          }}
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
                  onClick={markAllRead}
                  disabled={unreadCount === 0}
                >
                  {unreadCount === 0 ? "อ่านแล้วทั้งหมด" : "อ่านทั้งหมด"}
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

            {HEADER_NOTIFICATIONS.map((n) => {
              // An item stays marked unread until it is read, here or on the
              // Notifications screen — the dot is the only thing that says so.
              const unread = unreadById.get(n.id) ?? false;
              return (
                <Link
                  key={n.id}
                  href={`/tors/${n.torSlug}`}
                  className={`${styles.bellItem} ${unread ? "" : styles.bellItemRead}`}
                  onClick={() => {
                    markRead(n.id);
                    setBellOpen(false);
                  }}
                >
                  <span
                    className={`${styles.bellItemDot} ${unread ? DOT_CLASS[n.kind] : styles.bellItemDotRead}`}
                  />
                  <span>
                    <span className={styles.bellItemTitle}>{n.title}</span>
                    <span className={styles.bellItemMeta}>{n.meta}</span>
                  </span>
                </Link>
              );
            })}

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

      <div className={styles.menuWrap}>
        <button
          type="button"
          className={styles.avatar}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="เมนูบัญชี"
          onClick={() => {
            setMenuOpen((open) => !open);
            setBellOpen(false);
          }}
        >
          {initial}
        </button>

        {menuOpen && (
          <div className={styles.menuPanel} role="menu">
            <div className={styles.menuIdentity}>
              <div className={styles.menuName}>{account?.name}</div>
              <div className={styles.menuRole}>{account?.email}</div>
            </div>

            <Link
              href="/profile"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => setMenuOpen(false)}
            >
              โปรไฟล์และทักษะ
            </Link>
            <Link
              href="/profile#notif-settings"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => setMenuOpen(false)}
            >
              ตั้งค่าการแจ้งเตือน
            </Link>

            <div className={styles.menuDivider} />

            {/*
              Signing out ends BOTH sessions: the prototype viewer in browser
              storage, which the client forgets, and the staff session, which
              is an httpOnly cookie only the server can clear. Dropping the
              visible identity while leaving privileges live is the failure
              this call exists to prevent.
            */}
            <button
              type="button"
              role="menuitem"
              className={styles.menuSignOut}
              onClick={async () => {
                setMenuOpen(false);
                signOut();
                // Awaited, not fired and forgotten: navigating first cancels
                // the request, and the staff cookie survives a sign-out that
                // looked like it worked.
                await endStaffSessionAction();
                router.replace("/");
                router.refresh();
              }}
            >
              ออกจากระบบ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
